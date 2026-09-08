import assert from 'node:assert/strict';
import test from 'node:test';
import { LoginFlow, type LoginContext } from './web/login.ts';

const origin = 'https://gateway.example';
const callback = 'https://chatgpt.com/connector_platform_oauth_redirect?app=strava';
const localhost = 'http://localhost:61847/callback';

function fixture(overrides: Partial<LoginContext> = {}) {
  let now = 0;
  const upstreamState = crypto.randomUUID().replaceAll('-', '') + 'a'.repeat(11);
  const context: LoginContext = {
    authorization_url:
      'https://www.strava.com/oauth/mcp/authorize?' +
      new URLSearchParams({
        client_id: '248572',
        response_type: 'code',
        redirect_uri: localhost,
        code_challenge: 'p'.repeat(43),
        code_challenge_method: 'S256',
        resource: 'https://mcp.strava.com/mcp',
        scope: 'read read_all activity:read activity:read_all profile:read_all',
        state: upstreamState,
      }),
    redirect_uri: callback,
    state: 'ChatGPT state+a/b?c=d&e="\'<>☃',
    issuer: origin,
    ...overrides,
  };
  const flow = new LoginFlow(context, () => now);
  return {
    flow,
    context,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    result: (values: Record<string, string> = { code: 'strava-code' }) =>
      localhost + '?' + new URLSearchParams({ state: upstreamState, ...values }),
  };
}

test('browser login requires approval and returns the original code, client state, and gateway issuer', () => {
  const f = fixture();
  const code = 'raw-Strava-code+/with=symbols';
  assert.equal(f.flow.active, true);
  assert.throws(() => f.flow.complete(f.result({ code })));
  assert.equal(f.flow.begin(), f.context.authorization_url);
  assert.throws(() => f.flow.begin());
  const destination = new URL(
    f.flow.complete(f.result({ code, iss: 'https://www.strava.com', scope: 'read' })),
  );
  assert.equal(destination.origin + destination.pathname, callback.split('?')[0]);
  assert.deepEqual(Object.fromEntries(destination.searchParams), {
    app: 'strava',
    code,
    state: f.context.state,
    iss: origin,
  });
  assert.equal(f.flow.active, false);
});

test('a callback from another browser login cannot complete the current login', () => {
  const first = fixture();
  const second = fixture();
  first.flow.begin();
  second.flow.begin();
  assert.throws(() => second.flow.complete(first.result()));
  assert.equal(second.flow.active, true);
  assert.equal(
    new URL(second.flow.complete(second.result())).searchParams.get('code'),
    'strava-code',
  );
});

test('browser login accepts a copied localhost address without the http prefix', () => {
  const f = fixture();
  f.flow.begin();
  const code = 'raw-Strava-code+/with=symbols';
  const pasted = f.result({ code }).slice('http://'.length);
  const destination = new URL(f.flow.complete(' \n' + pasted + '\n '));
  assert.deepEqual(Object.fromEntries(destination.searchParams), {
    app: 'strava',
    code,
    state: f.context.state,
    iss: origin,
  });
});

test('only the exact localhost callback URL is accepted', () => {
  const f = fixture();
  f.flow.begin();
  const good = f.result();
  const query = new URL(good).search;
  for (const value of [
    'https://localhost:61847/callback' + query,
    'http://127.0.0.1:61847/callback' + query,
    'http://localhost:3000/callback' + query,
    'http://localhost:61847/another-path' + query,
    'http://localhost:61847/callback/' + query,
    'http://localhost.evil.example:61847/callback' + query,
    'http://localhost:61847@evil.example/callback' + query,
    'http://user:password@localhost:61847/callback' + query,
    'http://LOCALHOST:61847/callback' + query,
    'http://localhost:61847/other/../callback' + query,
    'http://localhost:61847/call%62ack' + query,
    'http://localhost:61847\\callback' + query,
    good + '#fragment',
    good + '#',
    good.replace('localhost', 'local\thost'),
  ]) {
    for (const pasted of [value, value.replace(/^http:\/\//u, '')])
      assert.throws(() => f.flow.complete(pasted), pasted);
    assert.equal(f.flow.active, true);
  }
  assert.equal(
    new URL(f.flow.complete(' \n' + good + '\n ')).searchParams.get('code'),
    'strava-code',
  );
});

test('callback state and optional issuer must match the pending authorization', () => {
  const f = fixture();
  f.flow.begin();
  const invalid: Record<string, string>[] = [
    { state: 'wrong' },
    { state: '' },
    { state: '☃' },
    { iss: '' },
    { iss: 'https://attacker.example' },
    { iss: 'https://www.strava.com/' },
  ];
  for (const values of invalid)
    assert.throws(() => f.flow.complete(f.result({ code: 'code', ...values })));
  assert.equal(f.flow.active, true);
  assert.ok(f.flow.complete(f.result({ code: 'code', iss: 'https://www.strava.com' })));
});

test('callback rejects duplicate, unknown, missing, oversized, and ambiguous parameters', () => {
  const f = fixture();
  f.flow.begin();
  const invalid: Record<string, string>[] = [
    {},
    { code: '' },
    { error: '' },
    { code: 'ok', error: 'denied' },
    { code: 'ok', error: '' },
    { code: 'x'.repeat(8192) },
    { code: 'x'.repeat(8193) },
    { access_token: 'not-an-authorization-code' },
    { code: 'ok', redirect_uri: 'https://evil.example' },
  ];
  for (const values of invalid) assert.throws(() => f.flow.complete(f.result(values)));
  const good = f.result();
  for (const extra of [
    '&code=other',
    '&state=other',
    '&iss=https%3A%2F%2Fwww.strava.com&iss=https%3A%2F%2Fwww.strava.com',
    '&scope=read&scope=read',
    '&padding=' + 'p'.repeat(24_000),
  ])
    assert.throws(() => f.flow.complete(good + extra));
  assert.equal(f.flow.active, true);
  assert.ok(f.flow.complete(good));
});

test('cancellation and upstream errors return a clean access_denied response', () => {
  for (const cancel of [true, false]) {
    const f = fixture();
    if (!cancel) f.flow.begin();
    const result = cancel
      ? f.flow.cancel()
      : f.flow.complete(
          f.result({
            error: 'upstream_private_error',
            error_description: 'private upstream details',
            error_uri: 'https://attacker.example',
          }),
        );
    assert.deepEqual(Object.fromEntries(new URL(result).searchParams), {
      app: 'strava',
      error: 'access_denied',
      state: f.context.state,
      iss: origin,
    });
    assert.equal(f.flow.active, false);
    assert.throws(() => f.flow.cancel());
    assert.throws(() => f.flow.begin());
    assert.throws(() => f.flow.complete(f.result()));
  }
});

test('existing OAuth response fields are replaced without discarding configured callback data', () => {
  for (const cancel of [true, false]) {
    const f = fixture({
      redirect_uri:
        callback +
        '&code=old&code=duplicate&state=old&iss=old&error=old&error_description=old&error_uri=old&scope=old',
    });
    if (!cancel) f.flow.begin();
    const destination = new URL(cancel ? f.flow.cancel() : f.flow.complete(f.result()));
    assert.deepEqual(Object.fromEntries(destination.searchParams), {
      app: 'strava',
      ...(cancel ? { error: 'access_denied' } : { code: 'strava-code' }),
      state: f.context.state,
      iss: origin,
    });
    assert.equal(destination.searchParams.getAll('code').length, cancel ? 0 : 1);
  }
});

test('a completed callback cannot be replayed', () => {
  const f = fixture();
  f.flow.begin();
  const result = f.result();
  assert.ok(f.flow.complete(result));
  assert.throws(() => f.flow.complete(result));
  assert.throws(() => f.flow.cancel());
  assert.throws(() => f.flow.begin());
  assert.equal(f.flow.active, false);
});

test('pending and approved logins expire after ten minutes', () => {
  for (const approve of [true, false]) {
    const f = fixture();
    if (approve) f.flow.begin();
    f.advance(10 * 60 * 1000 - 1);
    assert.equal(f.flow.active, true);
    f.advance(1);
    assert.equal(f.flow.active, false);
    assert.throws(() => f.flow.begin());
    assert.throws(() => f.flow.complete(f.result()));
    assert.throws(() => f.flow.cancel());
  }
});

test('leaving the page invalidates the login even before its deadline', () => {
  const f = fixture();
  f.flow.begin();
  f.flow.invalidate();
  assert.equal(f.flow.active, false);
  assert.throws(() => f.flow.complete(f.result()));
  assert.throws(() => f.flow.begin());
  assert.throws(() => f.flow.cancel());
});
