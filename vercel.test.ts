import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import gateway from './server.ts';
import { loginContext } from './tests/login-context.ts';

const origin = 'https://gateway.example',
  callback = 'https://client.example/callback';
function configure(t: TestContext, extra: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    PUBLIC_ORIGIN: origin,
    MCP_PATH: undefined,
    VERCEL_PROJECT_PRODUCTION_URL: undefined,
    VERCEL_URL: undefined,
    CLIENT_ID: 'personal-strava',
    REDIRECT_URI: callback,
    CLIENT_SECRET: undefined,
    OWNER_KEY: undefined,
    KEYRING: undefined,
    REDIRECT_URIS: undefined,
    ...extra,
  };
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  const apply = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  apply(values);
  t.after(() => apply(previous));
}
const request = (path: string, init?: RequestInit) =>
  gateway.fetch(new Request(origin + path, init));

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

test('Vercel serves discovery at every well-known gateway path', async (t) => {
  configure(t);
  for (const path of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.equal((await jsonObject(response)).resource, origin + '/mcp');
  }
  const metadata = await jsonObject(await request('/.well-known/oauth-authorization-server'));
  assert.equal(metadata.issuer, origin);
  assert.equal(metadata.token_endpoint, origin + '/token');
});

test('Vercel uses the production domain and rejects deployment aliases', async (t) => {
  configure(t, {
    PUBLIC_ORIGIN: undefined,
    VERCEL_PROJECT_PRODUCTION_URL: 'gateway.example',
    VERCEL_URL: 'preview.example',
  });
  assert.equal((await request('/.well-known/oauth-authorization-server')).status, 200);
  const wrongHost = await gateway.fetch(
    new Request('https://preview.example/.well-known/oauth-authorization-server'),
  );
  assert.equal(wrongHost.status, 400);
});

test('Vercel forwards the same public MCP path configuration as Workers', async (t) => {
  configure(t, { MCP_PATH: '/api/mcp' });
  const response = await request('/.well-known/oauth-protected-resource/api/mcp');
  assert.equal(response.status, 200);
  assert.equal((await jsonObject(response)).resource, origin + '/api/mcp');
  assert.equal((await request('/api/mcp')).status, 401);
  assert.equal((await request('/mcp')).status, 404);
});

test('an explicit origin takes priority over the Vercel production domain', async (t) => {
  configure(t, { VERCEL_PROJECT_PRODUCTION_URL: 'other.example' });
  assert.equal((await request('/.well-known/oauth-authorization-server')).status, 200);
});

test('Vercel fails closed without a stable origin even when a deployment URL exists', async (t) => {
  configure(t, { PUBLIC_ORIGIN: undefined, VERCEL_URL: 'gateway.example' });
  const response = await request('/.well-known/oauth-authorization-server');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'invalid_configuration' });
});

test('Vercel preserves OAuth queries and duplicate-parameter rejection', async (t) => {
  configure(t);
  const query = new URLSearchParams({
    client_id: 'personal-strava',
    redirect_uri: callback,
    response_type: 'code',
    code_challenge_method: 'S256',
    code_challenge: 'p'.repeat(43),
    resource: origin + '/mcp',
    state: 'a+b/c?d=e&f',
  });
  const response = await request('/authorize?' + query);
  assert.equal(response.status, 200);
  const login = await loginContext(response);
  assert.equal(login.state, query.get('state'));
  assert.equal(login.redirect_uri, callback);
  assert.equal(login.issuer, origin);
  assert.equal(
    new URL(login.authorization_url).searchParams.get('redirect_uri'),
    'http://localhost:61847/callback',
  );
  query.append('state', 'replacement');
  assert.equal((await request('/authorize?' + query)).status, 400);
});

test('Vercel keeps GET, POST, and DELETE MCP authentication challenges', async (t) => {
  configure(t);
  for (const method of ['GET', 'POST', 'DELETE']) {
    const response = await request('/mcp', { method });
    assert.equal(response.status, 401);
    assert.match(
      response.headers.get('WWW-Authenticate') ?? '',
      /resource_metadata="https:\/\/gateway.example\/.well-known\/oauth-protected-resource"/,
    );
  }
});

test('Vercel preserves MCP request data, cancellation, and incremental SSE responses', async (t) => {
  configure(t);
  const encoder = new TextEncoder(),
    token = 'raw-strava-access';
  const controller = new AbortController();
  const incoming = new Request(origin + '/mcp', {
    method: 'POST',
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Mcp-Session-Id': 'session',
    },
    body: '{"method":"tools/list"}',
  });
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    assert.equal(url, 'https://mcp.strava.com/mcp');
    assert.equal(init.method, 'POST');
    assert.equal(headers.get('Authorization'), `Bearer ${token}`);
    assert.ok(init.body instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(init.body), '{"method":"tools/list"}');
    assert.equal(headers.get('Mcp-Session-Id'), 'session');
    assert.equal(init.signal, incoming.signal);
    return new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          stream = value;
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  });
  const response = await gateway.fetch(incoming);
  assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
  assert.ok(response.body !== null);
  const reader = response.body.getReader();
  assert.ok(stream !== undefined);
  stream.enqueue(encoder.encode('data: first\n\n'));
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  stream.enqueue(encoder.encode('data: second\n\n'));
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: second\n\n');
  controller.abort();
  assert.equal(incoming.signal.aborted, true);
  stream.close();
  assert.equal((await reader.read()).done, true);
});
