import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Miniflare, Response as UpstreamResponse } from 'miniflare';
import type { Request as UpstreamRequest } from 'miniflare';
import { unstable_readConfig as readConfig } from 'wrangler';
import { LoginFlow } from '../web/login.ts';
import { loginContext } from './login-context.ts';

const origin = 'https://gateway.example';
const clientId = 'https://chatgpt.com/oauth/client.json';
const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
const localhost = 'http://localhost:61847';
const upstream = 'https://mcp.strava.com/mcp';
const tokenEndpoint = 'https://www.strava.com/oauth/mcp/token';

test(
  'workerd uses the configured MCP path for routing and resource discovery',
  { timeout: 30_000 },
  async (t) => {
    const config = readConfig({ config: 'wrangler.jsonc' });
    assert.ok(config.compatibility_date);
    const bundle = await readFile(new URL('../dist/cloudflare/worker.js', import.meta.url), 'utf8');
    const runtime = new Miniflare({
      telemetry: { enabled: false },
      workers: [
        {
          config: {
            name: 'configured-mcp-path',
            type: 'worker',
            compatibilityDate: config.compatibility_date,
            compatibilityFlags: config.compatibility_flags,
            env: { MCP_PATH: { type: 'text', value: '/api/mcp' } },
            manifest: {
              mainModule: 'worker.js',
              modules: { 'worker.js': { type: 'esm', contents: bundle } },
            },
          },
        },
      ],
    });
    t.after(() => runtime.dispose());
    const response = await runtime.dispatchFetch(origin + '/api/mcp', { method: 'POST' });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('WWW-Authenticate') ?? '', /resource_metadata=/);
    for (const suffix of ['', '/api/mcp']) {
      const metadata = await runtime.dispatchFetch(
        origin + '/.well-known/oauth-protected-resource' + suffix,
      );
      assert.equal(metadata.status, 200);
      const data: unknown = await metadata.json();
      assert.ok(data && typeof data === 'object' && 'resource' in data);
      assert.equal(data.resource, origin + '/api/mcp');
    }
    assert.equal((await runtime.dispatchFetch(origin + '/mcp')).status, 404);
  },
);

test(
  'workerd serves the same secretless browser OAuth and streaming relay',
  { timeout: 30_000 },
  async (t) => {
    const config = readConfig({ config: 'wrangler.jsonc' });
    assert.ok(config.compatibility_date);
    const bundle = await readFile(new URL('../dist/cloudflare/worker.js', import.meta.url), 'utf8');
    const calls: { url: string; headers: Headers; body: string }[] = [];
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const runtime = new Miniflare({
      telemetry: { enabled: false },
      workers: [
        {
          config: {
            name: config.name ?? 'strava-stateless',
            type: 'worker',
            compatibilityDate: config.compatibility_date,
            compatibilityFlags: config.compatibility_flags,
            manifest: {
              mainModule: 'worker.js',
              modules: { 'worker.js': { type: 'esm', contents: bundle } },
            },
          },
          dev: {
            outboundService: {
              type: 'fetcher',
              async handler(request: UpstreamRequest) {
                calls.push({
                  url: request.url,
                  headers: new Headers(request.headers),
                  body: await request.text(),
                });
                if (request.url === clientId)
                  return UpstreamResponse.json({
                    client_id: clientId,
                    redirect_uris: [callback],
                    token_endpoint_auth_method: 'private_key_jwt',
                    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
                  });
                if (request.url === tokenEndpoint)
                  return UpstreamResponse.json({
                    access_token: 'strava-access',
                    refresh_token: 'strava-refresh',
                    expires_in: 3600,
                  });
                assert.equal(
                  request.url,
                  upstream,
                  'No live or unexpected upstream requests are allowed',
                );
                return new UpstreamResponse(
                  new ReadableStream<Uint8Array>({
                    start(controller) {
                      stream = controller;
                      controller.enqueue(new TextEncoder().encode('data: first\n\n'));
                    },
                  }),
                  {
                    headers: {
                      'Content-Type': 'text/event-stream',
                      'Mcp-Session-Id': 'session',
                      'Set-Cookie': 'private',
                    },
                  },
                );
              },
            },
          },
        },
      ],
    });
    t.after(() => runtime.dispose());
    const get = (path: string) => runtime.dispatchFetch(origin + path, { redirect: 'manual' });
    const post = (path: string, values: Record<string, string>) =>
      runtime.dispatchFetch(origin + path, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(values),
      });

    await t.test(
      'public discovery and authentication challenges work without configuration',
      async () => {
        assert.equal((await get('/')).status, 200);
        for (const [path, contentType] of [
          ['/assets/login.js', /javascript/],
          ['/assets/styles.css', /text\/css/],
        ] as const) {
          const asset = await get(path);
          assert.equal(asset.status, 200);
          assert.match(asset.headers.get('Content-Type') ?? '', contentType);
          assert.ok((await asset.text()).length > 0);
        }
        for (const path of [
          '/.well-known/oauth-authorization-server',
          '/.well-known/oauth-protected-resource',
          '/.well-known/oauth-protected-resource/mcp',
        ]) {
          const response = await get(path);
          assert.equal(response.status, 200);
          const metadata: unknown = await response.json();
          assert.ok(metadata && typeof metadata === 'object');
          if ('issuer' in metadata) assert.equal(metadata.issuer, origin);
          else {
            assert.ok('resource' in metadata);
            assert.equal(metadata.resource, origin + '/mcp');
          }
        }
        const unauthenticated = await get('/mcp');
        assert.equal(unauthenticated.status, 401);
        assert.match(unauthenticated.headers.get('WWW-Authenticate') ?? '', /resource_metadata=/);
        assert.equal(calls.length, 0);
      },
    );

    await t.test(
      'browser handoff and code exchange preserve PKCE and only send localhost to Strava',
      async () => {
        const verifier = 'v'.repeat(43);
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const state = 'chatgpt-state+a/b?c=d&e';
        const response = await get(
          '/authorize?' +
            new URLSearchParams({
              client_id: clientId,
              redirect_uri: callback,
              response_type: 'code',
              code_challenge_method: 'S256',
              code_challenge: challenge,
              resource: origin + '/mcp',
              state,
            }),
        );
        assert.equal(response.status, 200);
        const flow = new LoginFlow(await loginContext(response));
        const strava = new URL(flow.begin());
        assert.equal(strava.origin + strava.pathname, 'https://www.strava.com/oauth/mcp/authorize');
        assert.equal(strava.searchParams.get('redirect_uri'), localhost + '/callback');
        assert.equal(strava.searchParams.get('code_challenge'), challenge);
        const completed = flow.complete(
          localhost +
            '/callback?' +
            new URLSearchParams({
              code: 'strava-code',
              state: strava.searchParams.get('state') ?? '',
            }),
        );
        assert.equal(flow.active, false);
        const destination = new URL(completed);
        assert.equal(destination.origin + destination.pathname, callback);
        assert.equal(destination.searchParams.get('state'), state);
        assert.equal(destination.searchParams.get('iss'), origin);
        const tokens = await post('/token', {
          client_id: clientId,
          redirect_uri: callback,
          resource: origin + '/mcp',
          grant_type: 'authorization_code',
          code: destination.searchParams.get('code') ?? '',
          code_verifier: verifier,
        });
        assert.equal(tokens.status, 200);
        assert.deepEqual(await tokens.json(), {
          access_token: 'strava-access',
          refresh_token: 'strava-refresh',
          token_type: 'Bearer',
          scope: 'mcp:read',
          expires_in: 3570,
        });
        const exchanged = calls.find((call) => call.url === tokenEndpoint);
        assert.ok(exchanged);
        assert.deepEqual(Object.fromEntries(new URLSearchParams(exchanged.body)), {
          grant_type: 'authorization_code',
          code: 'strava-code',
          code_verifier: verifier,
          redirect_uri: localhost + '/callback',
          client_id: '248572',
          resource: upstream,
        });
        assert.equal(exchanged.headers.has('Authorization'), false);
        assert.equal(calls.filter((call) => call.url === clientId).length, 2);
      },
    );

    await t.test(
      'authenticated MCP preserves allowed headers and streams without buffering',
      async () => {
        const body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
        const response = await runtime.dispatchFetch(origin + '/mcp', {
          method: 'POST',
          body,
          headers: {
            Authorization: 'Bearer strava-access',
            'Content-Type': 'application/json',
            'User-Agent': 'openai-mcp/1.0.0',
            'Mcp-Method': 'tools/list',
            'Mcp-Name': 'strava-tools',
            'Mcp-Session-Id': 'session',
            'MCP-Protocol-Version': '2025-11-25',
            Cookie: 'private',
            'Proxy-Authorization': 'Basic private',
            'X-Api-Key': 'private',
            'X-Private': 'private',
          },
        });
        const forwarded = calls.find((call) => call.url === upstream);
        assert.ok(forwarded);
        assert.equal(forwarded.body, body);
        assert.equal(forwarded.headers.get('Authorization'), 'Bearer strava-access');
        assert.equal(forwarded.headers.get('User-Agent'), 'openai-mcp/1.0.0');
        assert.equal(forwarded.headers.get('Mcp-Method'), 'tools/list');
        assert.equal(forwarded.headers.get('Mcp-Name'), 'strava-tools');
        assert.equal(forwarded.headers.get('Mcp-Session-Id'), 'session');
        assert.equal(forwarded.headers.get('MCP-Protocol-Version'), '2025-11-25');
        assert.equal(forwarded.headers.has('Cookie'), false);
        assert.equal(forwarded.headers.has('Proxy-Authorization'), false);
        assert.equal(forwarded.headers.has('X-Api-Key'), false);
        assert.equal(forwarded.headers.has('X-Private'), false);
        assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
        assert.equal(response.headers.get('Mcp-Session-Id'), 'session');
        assert.equal(response.headers.has('Set-Cookie'), false);
        assert.ok(response.body && stream);
        const reader = response.body.getReader();
        assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
        stream.enqueue(new TextEncoder().encode('data: second\n\n'));
        assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: second\n\n');
        stream.close();
        assert.equal((await reader.read()).done, true);
      },
    );
  },
);
