import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway, type Fetcher } from './worker.ts';
import { loginContext } from './tests/login-context.ts';

const origin = 'https://gateway.example',
  callback = 'https://chatgpt.com/connector/oauth/test';
const upstream = 'https://mcp.strava.com/mcp',
  tokenEndpoint = 'https://www.strava.com/oauth/mcp/token';
const env = () => ({ PUBLIC_ORIGIN: origin, CLIENT_ID: 'personal-strava', REDIRECT_URI: callback });
const hash = async (value: string) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString(
    'base64url',
  );
const form = (
  path: string,
  values: Record<string, string> | URLSearchParams,
  headers: Record<string, string> = {},
) =>
  new Request(origin + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(values),
  });
const jsonRequest = (token: string, extra: Record<string, string> = {}) =>
  new Request(origin + '/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra },
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
  });
const authParams = (extra: Record<string, string> = {}) => ({
  client_id: 'personal-strava',
  redirect_uri: callback,
  response_type: 'code',
  code_challenge_method: 'S256',
  code_challenge: 'p'.repeat(43),
  resource: origin + '/mcp',
  state: 'chatgpt-state',
  scope: 'mcp:read',
  ...extra,
});

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function tokenResponse(
  response: Response,
): Promise<Record<string, unknown> & { access_token: string; refresh_token: string }> {
  const value = await jsonObject(response);
  assert.ok(typeof value.access_token === 'string');
  assert.ok(typeof value.refresh_token === 'string');
  return { ...value, access_token: value.access_token, refresh_token: value.refresh_token };
}

function header(response: Response, name: string): string {
  const value = response.headers.get(name);
  assert.ok(value !== null, `Missing response header: ${name}`);
  return value;
}

function fixture(mcpPath = '/mcp') {
  const e = { ...env(), MCP_PATH: mcpPath };
  let now = 1800000000,
    calls = 0,
    rotations = 0,
    loseRefresh = false;
  const codes = new Map<string, string>(),
    refreshes = new Set<string>(),
    accessTokens = new Map<string, number>();
  const fetcher: Fetcher = async (url, init) => {
    calls++;
    assert.equal(init.redirect, 'manual');
    if (url === tokenEndpoint) {
      assert.ok(init.body instanceof URLSearchParams);
      const p = new URLSearchParams(init.body);
      assert.equal(p.get('client_id'), '248572');
      assert.equal(p.get('resource'), upstream);
      assert.equal(p.has('client_secret'), false);
      assert.equal(new Headers(init.headers).has('Authorization'), false);
      if (p.get('grant_type') === 'authorization_code') {
        const code = p.get('code') ?? '',
          challenge = codes.get(code);
        if (!challenge || (await hash(p.get('code_verifier') ?? '')) !== challenge)
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        assert.equal(p.get('redirect_uri'), 'http://localhost:61847/callback');
        codes.delete(code);
      } else {
        if (!refreshes.delete(p.get('refresh_token') ?? ''))
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        rotations++;
      }
      const refresh = 'strava-refresh-' + crypto.randomUUID(),
        access = 'strava-access-' + crypto.randomUUID();
      refreshes.add(refresh);
      accessTokens.set(access, now + 3600);
      if (loseRefresh && rotations) throw new Error('Response lost after upstream rotation');
      return Response.json({ access_token: access, refresh_token: refresh, expires_in: 3600 });
    }
    assert.equal(url, upstream);
    const headers = new Headers(init.headers);
    const token = (headers.get('Authorization') ?? '').slice('Bearer '.length);
    if (!((accessTokens.get(token) ?? 0) > now))
      return new Response('Private upstream detail', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer realm="strava"' },
      });
    assert.equal(headers.has('Cookie'), false);
    assert.equal(headers.has('X-Api-Key'), false);
    return new Response('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n', {
      headers: {
        'Content-Type': 'text/event-stream',
        'Mcp-Session-Id': 'session',
        'Set-Cookie': 'private',
      },
    });
  };
  const gateway = () => createGateway(e, fetcher, () => now);
  const request = (path: string, init?: RequestInit) =>
    gateway().fetch(new Request(origin + path, init));
  async function prepare() {
    const verifier = 'p'.repeat(43),
      p = authParams({
        code_challenge: await hash(verifier),
        state: 'chatgpt-state+a/b?c=d&e',
        resource: origin + mcpPath,
      });
    const response = await request('/authorize?' + new URLSearchParams(p));
    assert.equal(response.status, 200);
    assert.equal(response.headers.has('Location'), false);
    const launch = await loginContext(response);
    const up = new URL(launch.authorization_url);
    assert.equal(launch.redirect_uri, callback);
    assert.equal(launch.state, p.state);
    assert.equal(launch.issuer, origin);
    assert.equal(up.origin + up.pathname, 'https://www.strava.com/oauth/mcp/authorize');
    assert.equal(up.searchParams.get('client_id'), '248572');
    assert.equal(up.searchParams.get('redirect_uri'), 'http://localhost:61847/callback');
    assert.equal(up.searchParams.get('resource'), upstream);
    assert.equal(up.searchParams.get('response_type'), 'code');
    assert.equal(
      up.searchParams.get('scope'),
      'read read_all activity:read activity:read_all profile:read_all',
    );
    assert.match(up.searchParams.get('state') ?? '', /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(up.searchParams.get('state'), p.state);
    assert.equal(up.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(up.searchParams.get('code_challenge'), p.code_challenge);
    const code = 'strava-code-' + crypto.randomUUID();
    codes.set(code, p.code_challenge);
    return { verifier, code, params: p };
  }
  const exchange = (code: string, verifier: string) =>
    gateway().fetch(
      form('/token', {
        grant_type: 'authorization_code',
        client_id: e.CLIENT_ID,
        resource: origin + mcpPath,
        redirect_uri: callback,
        code,
        code_verifier: verifier,
      }),
    );
  const refresh = (token: string) =>
    gateway().fetch(
      form('/token', {
        grant_type: 'refresh_token',
        client_id: e.CLIENT_ID,
        resource: origin + mcpPath,
        refresh_token: token,
      }),
    );
  return {
    e,
    gateway,
    request,
    prepare,
    exchange,
    refresh,
    calls: () => calls,
    rotations: () => rotations,
    advance: (n: number) => {
      now += n;
    },
    lose: () => {
      loseRefresh = true;
    },
  };
}

test('discovery advertises a public client and S256 without runtime secrets', async () => {
  const f = fixture(),
    meta = await jsonObject(await f.request('/.well-known/oauth-authorization-server'));
  assert.equal(meta.issuer, origin);
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(meta.token_endpoint_auth_methods_supported, ['none']);
  const resource = await jsonObject(await f.request('/.well-known/oauth-protected-resource/mcp'));
  assert.deepEqual(resource.authorization_servers, [origin]);
  assert.equal(resource.resource, origin + '/mcp');
});

test('a configured MCP path consistently governs discovery, authorization, refresh, and transport', async () => {
  const mcpPath = '/api/mcp';
  const f = fixture(mcpPath);
  assert.ok((await (await f.request('/')).text()).includes(origin + mcpPath));
  for (const path of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource' + mcpPath,
  ]) {
    const response = await f.request(path);
    assert.equal(response.status, 200);
    assert.equal((await jsonObject(response)).resource, origin + mcpPath);
  }
  for (const method of ['GET', 'POST', 'DELETE']) {
    const response = await f.request(mcpPath, { method });
    assert.equal(response.status, 401);
    assert.match(header(response, 'WWW-Authenticate'), /resource_metadata=/);
  }
  assert.equal((await f.request('/mcp')).status, 404);
  assert.equal((await f.request('/.well-known/oauth-protected-resource/mcp')).status, 404);
  const oldAuth = await f.request('/authorize?' + new URLSearchParams(authParams()));
  assert.deepEqual(await jsonObject(oldAuth), { error: 'invalid_target' });
  const p = await f.prepare();
  const wrongResource = await f.gateway().fetch(
    form('/token', {
      client_id: f.e.CLIENT_ID,
      resource: origin + '/mcp',
      grant_type: 'authorization_code',
      redirect_uri: callback,
      code: p.code,
      code_verifier: p.verifier,
    }),
  );
  assert.equal(wrongResource.status, 400);
  assert.equal(f.calls(), 0);
  const first = await tokenResponse(await f.exchange(p.code, p.verifier));
  const renewed = await tokenResponse(await f.refresh(first.refresh_token));
  assert.notEqual(renewed.refresh_token, first.refresh_token);
  const response = await f.request(mcpPath, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${renewed.access_token}`,
      'Content-Type': 'application/json',
    },
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /^data:/);
});

test('code and token flow survives a fresh gateway per request and returns raw upstream tokens', async () => {
  const f = fixture(),
    p = await f.prepare(),
    r = await f.exchange(p.code, p.verifier);
  assert.equal(r.status, 200);
  const tokens = await tokenResponse(r);
  assert.match(tokens.access_token, /^strava-access-/);
  assert.match(tokens.refresh_token, /^strava-refresh-/);
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.scope, 'mcp:read');
  assert.equal(tokens.expires_in, 3570);
  const response = await f.gateway().fetch(
    jsonRequest(tokens.access_token, {
      Cookie: 'must-not-forward',
      'X-Api-Key': 'must-not-forward',
      'Mcp-Session-Id': 'session',
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Mcp-Session-Id'), 'session');
  assert.equal(response.headers.has('Set-Cookie'), false);
  assert.match(await response.text(), /^data:/);
});

test('PKCE is forwarded unchanged and upstream rejects a wrong verifier without consuming the code', async () => {
  const f = fixture(),
    p = await f.prepare();
  assert.equal((await f.exchange(p.code, 'x'.repeat(43))).status, 400);
  assert.equal(f.calls(), 1);
  assert.equal((await f.exchange(p.code, p.verifier)).status, 200);
  assert.equal(f.calls(), 2);
});

test('upstream single-use redemption rejects replay of the raw code', async () => {
  const f = fixture(),
    p = await f.prepare();
  await f.exchange(p.code, p.verifier);
  assert.equal((await f.exchange(p.code, p.verifier)).status, 400);
  assert.equal(f.calls(), 2);
});

test('upstream enforces access expiry while refresh survives isolate replacement and rotates', async () => {
  const f = fixture(),
    p = await f.prepare(),
    old = await tokenResponse(await f.exchange(p.code, p.verifier));
  f.advance(3600);
  const expired = await f.gateway().fetch(jsonRequest(old.access_token));
  assert.equal(expired.status, 401);
  assert.equal(f.calls(), 2);
  assert.match(
    header(expired, 'WWW-Authenticate'),
    /resource_metadata="https:\/\/gateway.example\/.well-known\/oauth-protected-resource"/,
  );
  assert.deepEqual(await expired.json(), { error: 'invalid_token' });
  const r = await f.refresh(old.refresh_token);
  assert.equal(r.status, 200);
  const fresh = await tokenResponse(r);
  assert.notEqual(old.refresh_token, fresh.refresh_token);
  assert.equal(f.rotations(), 1);
  assert.equal((await f.gateway().fetch(jsonRequest(fresh.access_token))).status, 200);
  assert.equal((await f.refresh(old.refresh_token)).status, 400);
});

test('upstream rejects refresh tokens used as access tokens and the reverse', async () => {
  const f = fixture(),
    p = await f.prepare(),
    tokens = await tokenResponse(await f.exchange(p.code, p.verifier));
  assert.equal((await f.gateway().fetch(jsonRequest(tokens.refresh_token))).status, 401);
  assert.equal((await f.refresh(tokens.access_token)).status, 400);
  assert.equal(f.calls(), 3);
});

test('authorization validates exact client, callback, audience, S256, scope, and unique parameters', async () => {
  const f = fixture();
  const changes: Record<string, string>[] = [
    { client_id: 'other' },
    { redirect_uri: 'https://evil.example/callback' },
    { redirect_uri: callback + '/extra' },
    { redirect_uri: callback + '?next=https://evil.example' },
    { resource: 'https://evil.example/mcp' },
    { scope: 'admin' },
    { response_type: 'token' },
    { code_challenge_method: 'plain' },
    { code_challenge: 'short' },
    { state: '' },
    { state: 's'.repeat(2049) },
  ];
  for (const change of changes) {
    const response = await f.request('/authorize?' + new URLSearchParams(authParams(change)));
    assert.equal(response.status, 400, JSON.stringify(change));
    assert.equal(response.headers.has('Location'), false);
  }
  assert.equal(
    (await f.request('/authorize?' + new URLSearchParams(authParams()) + '&state=duplicate'))
      .status,
    400,
  );
  assert.equal(f.calls(), 0);
});

test('authorization pages isolate each login and escape client state as inert HTML data', async () => {
  const f = fixture();
  const state = 'a+b/c?d=e&f="\'><script>alert(1)</script>';
  const path = '/authorize?' + new URLSearchParams(authParams({ state }));
  const response = await f.request(path);
  assert.equal(response.status, 200);
  assert.match(header(response, 'Content-Type'), /text\/html/);
  assert.equal(header(response, 'Cache-Control'), 'no-store');
  assert.equal(header(response, 'Referrer-Policy'), 'no-referrer');
  assert.match(header(response, 'Content-Security-Policy'), /frame-ancestors 'none'/);
  const policy = header(response, 'Content-Security-Policy');
  assert.match(policy, /default-src 'none'/);
  assert.ok(!policy.includes('connect-src') || policy.includes("connect-src 'none'"));
  const html = await response.clone().text();
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /<script\b[^>]*type="module"[^>]*src="\/assets\/login\.js"/);
  const first = await loginContext(response);
  const second = await loginContext(await f.request(path));
  assert.equal(first.state, state);
  assert.equal(first.redirect_uri, callback);
  assert.equal(first.issuer, origin);
  assert.notEqual(
    new URL(first.authorization_url).searchParams.get('state'),
    new URL(second.authorization_url).searchParams.get('state'),
  );
  assert.equal(f.calls(), 0);
});

test('removed approval and callback endpoints do not accept signed-flow requests', async () => {
  const f = fixture();
  assert.equal(
    (await f.gateway().fetch(form('/authorize', { ticket: 'old', owner_key: 'old' }))).status,
    404,
  );
  assert.equal((await f.request('/callback?flow=old&state=old&code=old')).status, 404);
  assert.equal((await f.gateway().fetch(form('/launch', authParams()))).status, 404);
});

test('token validates client, resource, callback, code and verifier before upstream exchange', async () => {
  const f = fixture(),
    valid = {
      grant_type: 'authorization_code',
      client_id: f.e.CLIENT_ID,
      resource: origin + '/mcp',
      redirect_uri: callback,
      code: 'upstream-code',
      code_verifier: 'p'.repeat(43),
    };
  for (const [change, status] of [
    [{ client_id: 'other' }, 401],
    [{ resource: 'https://evil.example/mcp' }, 400],
    [{ redirect_uri: callback + '/extra' }, 400],
    [{ code: '' }, 400],
    [{ code: 'c'.repeat(8193) }, 400],
    [{ code_verifier: 'short' }, 400],
    [{ code_verifier: 'p'.repeat(129) }, 400],
    [{ code_verifier: '!'.repeat(43) }, 400],
    [{ grant_type: 'password' }, 400],
  ] satisfies [Record<string, string>, number][])
    assert.equal(
      (await f.gateway().fetch(form('/token', { ...valid, ...change }))).status,
      status,
      JSON.stringify(change),
    );
  assert.equal((await f.refresh('')).status, 400);
  const duplicate = new URLSearchParams(valid);
  duplicate.append('client_id', 'other');
  assert.equal((await f.gateway().fetch(form('/token', duplicate))).status, 400);
  assert.equal(f.calls(), 0);
});

test('lost refresh responses are never retried after upstream rotation', async () => {
  const f = fixture(),
    p = await f.prepare(),
    old = await tokenResponse(await f.exchange(p.code, p.verifier));
  f.lose();
  assert.equal((await f.refresh(old.refresh_token)).status, 503);
  assert.equal(f.rotations(), 1);
  assert.equal(f.calls(), 2);
  assert.equal((await f.refresh(old.refresh_token)).status, 400);
  assert.equal(f.calls(), 3);
});

test('public token endpoint rejects supplied client secrets and authorization headers', async () => {
  const f = fixture(),
    values = {
      grant_type: 'refresh_token',
      client_id: f.e.CLIENT_ID,
      resource: origin + '/mcp',
      refresh_token: 'raw-refresh',
    };
  for (const client_secret of ['', 'legacy-secret']) {
    assert.equal(
      (await f.gateway().fetch(form('/token', { ...values, client_secret }))).status,
      401,
    );
  }
  for (const Authorization of ['', 'Basic private', 'Bearer private']) {
    assert.equal((await f.gateway().fetch(form('/token', values, { Authorization }))).status, 401);
  }
  assert.equal(f.calls(), 0);
});

test('token errors are bounded and sanitized without retrying or following redirects', async () => {
  for (const [status, expected] of [
    [400, 400],
    [401, 400],
    [429, 503],
    [500, 503],
    [302, 503],
  ] as const) {
    let calls = 0;
    const gateway = createGateway(env(), async (url, init) => {
      calls++;
      assert.equal(url, tokenEndpoint);
      assert.equal(init.redirect, 'manual');
      return new Response('private upstream detail', {
        status,
        headers: { Location: 'https://evil.example' },
      });
    });
    const response = await gateway.fetch(
      form('/token', {
        grant_type: 'refresh_token',
        client_id: 'personal-strava',
        resource: origin + '/mcp',
        refresh_token: 'raw-refresh',
      }),
    );
    assert.equal(response.status, expected);
    assert.equal(calls, 1);
    assert.doesNotMatch(await response.text(), /private upstream detail/);
  }
  for (const payload of [
    'not json',
    JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 0 }),
    'x'.repeat(65537),
  ]) {
    const gateway = createGateway(env(), async () => new Response(payload));
    assert.equal(
      (
        await gateway.fetch(
          form('/token', {
            grant_type: 'refresh_token',
            client_id: 'personal-strava',
            resource: origin + '/mcp',
            refresh_token: 'raw-refresh',
          }),
        )
      ).status,
      502,
    );
  }
});

test('token expiry follows upstream expires_at and nonrotating refresh preserves the raw refresh token', async () => {
  const gateway = createGateway(
    env(),
    async () =>
      Response.json({ access_token: 'raw-access', expires_at: 1800000900, expires_in: 3600 }),
    () => 1800000000,
  );
  const response = await gateway.fetch(
    form('/token', {
      grant_type: 'refresh_token',
      client_id: 'personal-strava',
      resource: origin + '/mcp',
      refresh_token: 'raw-refresh',
    }),
  );
  assert.deepEqual(await response.json(), {
    token_type: 'Bearer',
    scope: 'mcp:read',
    expires_in: 870,
    access_token: 'raw-access',
    refresh_token: 'raw-refresh',
  });
});

test('request body limits and content types reject requests before upstream work', async () => {
  const f = fixture();
  assert.equal(
    (await f.gateway().fetch(form('/token', { padding: 'p'.repeat(32769) }))).status,
    413,
  );
  assert.equal(
    (
      await f.request('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await f.request('/mcp', {
        method: 'POST',
        headers: { Authorization: 'Bearer raw-access', 'Content-Type': 'application/json' },
        body: 'p'.repeat(1048577),
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await f.request('/mcp', {
        method: 'POST',
        headers: { Authorization: 'Bearer raw-access', 'Content-Type': 'text/plain' },
        body: '{}',
      })
    ).status,
    415,
  );
  assert.equal(f.calls(), 0);
});

test('MCP rejects unsupported methods, foreign origins and malformed bearer credentials locally', async () => {
  const f = fixture();
  assert.equal((await f.request('/mcp', { method: 'PUT' })).status, 405);
  assert.equal(
    (await f.gateway().fetch(jsonRequest('raw-access', { Origin: 'https://evil.example' }))).status,
    403,
  );
  for (const Authorization of [
    '',
    'Basic abc',
    'Bearer ',
    'Bearer one two',
    'Bearer token, Bearer other',
  ]) {
    const response = await f.request('/mcp', { headers: { Authorization } });
    assert.equal(response.status, 401, Authorization);
    assert.match(header(response, 'WWW-Authenticate'), /resource_metadata=/);
  }
  assert.equal(f.calls(), 0);
});

test('MCP sends raw bearer only to the fixed upstream and forwards only approved headers', async () => {
  const legacyEnvironment = {
    ...env(),
    CLIENT_SECRET: 'legacy-secret',
    OWNER_KEY: 'legacy-owner',
    KEYRING: 'legacy-keyring',
  };
  const gateway = createGateway(legacyEnvironment, async (url, init) => {
    const headers = new Headers(init.headers);
    assert.equal(url, upstream);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.method, 'DELETE');
    assert.equal(headers.get('Authorization'), 'Bearer raw-upstream-token');
    assert.equal(headers.get('Mcp-Session-Id'), 'session');
    assert.equal(headers.get('Last-Event-ID'), 'last');
    for (const name of ['Cookie', 'X-Api-Key', 'X-Forwarded-Host', 'Origin'])
      assert.equal(headers.has(name), false);
    return new Response(null, {
      status: 204,
      headers: {
        'Set-Cookie': 'private',
        'X-Private': 'private',
        'MCP-Protocol-Version': '2025-03-26',
      },
    });
  });
  const response = await gateway.fetch(
    new Request(origin + '/mcp?url=https://evil.example', {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer raw-upstream-token',
        'Mcp-Session-Id': 'session',
        'Last-Event-ID': 'last',
        Cookie: 'private',
        'X-Api-Key': 'private',
        'X-Forwarded-Host': 'evil.example',
        Origin: origin,
      },
    }),
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('MCP-Protocol-Version'), '2025-03-26');
  assert.equal(response.headers.has('Set-Cookie'), false);
  assert.equal(response.headers.has('X-Private'), false);
});

for (const [description, userAgent, expectedUserAgent] of [
  ['supplied ChatGPT', 'openai-mcp/1.0.0', 'openai-mcp/1.0.0'],
  ['supplied other client', 'example-client/2.0 (MCP)', 'example-client/2.0 (MCP)'],
  ['absent', undefined, 'strava-mcp-gateway/0.1.0'],
  ['empty', '', 'strava-mcp-gateway/0.1.0'],
  ['whitespace-only', ' \t ', 'strava-mcp-gateway/0.1.0'],
] as const) {
  test(`MCP forwards only approved headers and unchanged body with ${description} User-Agent`, async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const gateway = createGateway(env(), async (url, init) => {
      calls.push({ url, init });
      return Response.json({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    });
    const body = new TextEncoder().encode(
      '{\n "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {"cursor": "café"}\n}\n',
    );
    const headers = new Headers({
      Authorization: 'Bearer raw-upstream-token._~+/==',
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json; charset=utf-8',
      'MCP-Protocol-Version': '2025-11-25',
      'Mcp-Method': 'tools/list',
      'Mcp-Name': 'strava-tools',
      'Mcp-Session-Id': 'session',
      'Last-Event-ID': 'last',
      Cookie: 'private',
      'Proxy-Authorization': 'Basic private',
      'X-Api-Key': 'private',
      'X-Private': 'private',
      'X-Forwarded-Host': 'evil.example',
      Origin: origin,
    });
    if (userAgent !== undefined) headers.set('User-Agent', userAgent);
    const response = await gateway.fetch(
      new Request(origin + '/mcp', { method: 'POST', headers, body }),
    );
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    const [{ url, init }] = calls;
    assert.equal(url, upstream);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.deepEqual(init.body, body);
    assert.deepEqual(Object.fromEntries(new Headers(init.headers)), {
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer raw-upstream-token._~+/==',
      'content-type': 'application/json; charset=utf-8',
      'last-event-id': 'last',
      'mcp-method': 'tools/list',
      'mcp-name': 'strava-tools',
      'mcp-protocol-version': '2025-11-25',
      'mcp-session-id': 'session',
      'user-agent': expectedUserAgent,
    });
  });
}

test('MCP rejects upstream redirects without leaking bearer tokens or following Location', async () => {
  let calls = 0;
  const gateway = createGateway(env(), async () => {
    calls++;
    return new Response(null, { status: 307, headers: { Location: 'https://evil.example' } });
  });
  const response = await gateway.fetch(jsonRequest('raw-access'));
  assert.equal(response.status, 502);
  assert.equal(response.headers.has('Location'), false);
  assert.equal(calls, 1);
});

test('refresh proxies the supplied token directly to Strava without metadata or application secrets', async () => {
  const calls: string[] = [];
  const gateway = createGateway({ PUBLIC_ORIGIN: origin }, async (url, init) => {
    calls.push(url);
    assert.equal(url, tokenEndpoint);
    assert.equal(init.redirect, 'manual');
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    assert.ok(init.body instanceof URLSearchParams);
    assert.deepEqual(Object.fromEntries(init.body), {
      grant_type: 'refresh_token',
      refresh_token: 'supplied-strava-refresh',
      client_id: '248572',
      resource: upstream,
    });
    return Response.json({
      access_token: 'replacement-access',
      refresh_token: 'replacement-refresh',
      expires_in: 3600,
    });
  });
  const response = await gateway.fetch(
    form('/token', {
      client_id: 'https://chatgpt.com/oauth/client.json',
      resource: origin + '/mcp',
      grant_type: 'refresh_token',
      refresh_token: 'supplied-strava-refresh',
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    access_token: 'replacement-access',
    refresh_token: 'replacement-refresh',
    token_type: 'Bearer',
    scope: 'mcp:read',
    expires_in: 3570,
  });
  assert.deepEqual(calls, [tokenEndpoint]);
});

test('default URL client fetches only its configured public metadata and verifies exact identity and callback', async () => {
  const clientId = 'https://chatgpt.com/oauth/client.json',
    redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
  let calls = 0;
  const metadata = {
    client_id: clientId,
    client_name: 'ChatGPT',
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
  };
  const gateway = createGateway({ PUBLIC_ORIGIN: origin }, async (url, init) => {
    calls++;
    assert.equal(url, clientId);
    assert.equal(init.redirect, 'manual');
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    return Response.json(metadata);
  });
  const authorize = (extra: Record<string, string>) =>
    gateway.fetch(
      new Request(
        origin +
          '/authorize?' +
          new URLSearchParams(
            authParams({ client_id: clientId, redirect_uri: redirectUri, ...extra }),
          ),
      ),
    );
  assert.equal((await authorize({ client_id: 'https://evil.example/client.json' })).status, 400);
  assert.equal(calls, 0);
  assert.equal((await authorize({})).status, 200);
  assert.equal(calls, 1);
  for (const bad of [
    { ...metadata, client_id: 'https://evil.example/client.json' },
    { ...metadata, redirect_uris: ['https://evil.example/callback'] },
    { ...metadata, token_endpoint_auth_methods_supported: ['private_key_jwt'] },
  ]) {
    const other = createGateway({ PUBLIC_ORIGIN: origin }, async () => Response.json(bad));
    const response = await other.fetch(
      new Request(
        origin +
          '/authorize?' +
          new URLSearchParams(authParams({ client_id: clientId, redirect_uri: redirectUri })),
      ),
    );
    assert.ok(response.status >= 400);
    assert.equal(response.headers.has('Location'), false);
  }
});
