import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.ts';

const origin = 'https://gateway.example';

test('Cloudflare infers its HTTPS origin with no bindings and ignores forwarded headers', async () => {
  const response = await worker.fetch(
    new Request(origin + '/.well-known/oauth-authorization-server', {
      headers: { 'X-Forwarded-Host': 'attacker.example', 'X-Forwarded-Proto': 'http' },
    }),
  );
  assert.equal(response.status, 200);
  const metadata: unknown = await response.json();
  assert.ok(metadata !== null && typeof metadata === 'object');
  assert.ok('issuer' in metadata && 'token_endpoint_auth_methods_supported' in metadata);
  assert.equal(metadata.issuer, origin);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none']);
});

test('configured origin is enforced and unsafe public configuration fails closed', async () => {
  const wrongHost = await worker.fetch(new Request('https://alias.example/mcp'), {
    PUBLIC_ORIGIN: origin,
  });
  assert.equal(wrongHost.status, 400);
  for (const values of [
    { PUBLIC_ORIGIN: 'http://gateway.example' },
    { PUBLIC_ORIGIN: origin + '/' },
    { PUBLIC_ORIGIN: 'https://user:password@gateway.example' },
    { REDIRECT_URI: 'http://client.example/callback' },
    { REDIRECT_URI: 'https://client.example/callback#fragment' },
    { REDIRECT_URI: 'https://user:password@client.example/callback' },
    { REDIRECT_URI: 'javascript:alert(1)' },
    ...[
      '',
      '/',
      'api/mcp',
      '//api/mcp',
      '/api/mcp/',
      '/api/../mcp',
      '/api/mcp?x=1',
      '/api/mcp#x',
      '/token',
      'https://other.example/mcp',
    ].map((MCP_PATH) => ({ MCP_PATH })),
  ]) {
    const response = await worker.fetch(new Request(origin), values);
    assert.equal(response.status, 503, JSON.stringify(values));
    assert.deepEqual(await response.json(), { error: 'invalid_configuration' });
  }
});

test('a fresh deployment serves a public landing page without any secrets or client metadata fetch', async (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Landing page must not fetch client metadata');
  });
  const response = await worker.fetch(new Request(origin), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(await response.text(), /https:\/\/gateway.example\/mcp/);
  const anonymous = await worker.fetch(new Request(origin + '/mcp'), {});
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get('WWW-Authenticate') ?? '', /resource_metadata=/);
});
