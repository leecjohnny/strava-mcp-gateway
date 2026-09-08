import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { createGateway } from '../worker.ts';

const origin = 'https://gateway.example';
const callback = 'https://client.example/callback?app=strava';
const localhost = 'http://localhost:61847/callback';
const state = 'client-state+a/b?c=d&e="\'<>☃';
const challenge = 'p'.repeat(43);
const authorize =
  origin +
  '/authorize?' +
  new URLSearchParams({
    client_id: 'personal-strava',
    redirect_uri: callback,
    response_type: 'code',
    code_challenge_method: 'S256',
    code_challenge: challenge,
    resource: origin + '/mcp',
    scope: 'mcp:read',
    state,
  });

async function fixture(t: TestContext, browser: Browser, javaScriptEnabled = true) {
  const context = await browser.newContext({ javaScriptEnabled, serviceWorkers: 'block' });
  t.after(() => context.close());
  const requests: string[] = [];
  const errors: string[] = [];
  context.on('page', (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (/content.security.policy|violates.+directive/i.test(message.text()))
        errors.push(message.text());
    });
  });
  const gateway = createGateway(
    { PUBLIC_ORIGIN: origin, CLIENT_ID: 'personal-strava', REDIRECT_URI: callback },
    async () => {
      throw new Error('Browser linking must not make token or metadata requests');
    },
  );
  await context.route('**/*', async (route) => {
    const request = route.request();
    requests.push(request.url());
    const url = new URL(request.url());
    if (url.origin === origin) {
      const response = await gateway.fetch(
        new Request(request.url(), { method: request.method(), headers: request.headers() }),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
    } else if (
      url.origin + url.pathname === 'https://www.strava.com/oauth/mcp/authorize' ||
      url.origin + url.pathname === localhost ||
      url.origin + url.pathname === 'https://client.example/callback'
    ) {
      await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><title>Simulated OAuth endpoint</title><p>Simulated endpoint; no live authentication.</p></html>',
      });
    } else {
      errors.push('Unexpected request: ' + request.url());
      await route.abort();
    }
  });
  const page = await context.newPage();
  const response = await page.goto(authorize);
  assert.equal(response?.status(), 200);
  return { context, page, requests, errors };
}

async function waitForGuide(page: Page) {
  await page.locator('#open-strava[href]').waitFor();
  assert.equal(await page.locator('#callback-url').isDisabled(), true);
  assert.equal(await page.locator('#complete').isDisabled(), true);
  assert.equal(await page.locator('#cancel').isEnabled(), true);
}

test(
  'the rendered browser guide completes OAuth without a local service',
  { timeout: 60_000 },
  async (t) => {
    const browser = await chromium.launch();
    t.after(() => browser.close());

    await t.test(
      'opens Strava in a separate tab, validates a pasted address, and returns to the client',
      async (t) => {
        const f = await fixture(t, browser);
        await waitForGuide(f.page);
        const popupPromise = f.page.waitForEvent('popup');
        await f.page.locator('#open-strava').click();
        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');
        const strava = new URL(popup.url());
        assert.equal(strava.origin + strava.pathname, 'https://www.strava.com/oauth/mcp/authorize');
        assert.equal(strava.searchParams.get('client_id'), '248572');
        assert.equal(strava.searchParams.get('redirect_uri'), localhost);
        assert.equal(strava.searchParams.get('resource'), 'https://mcp.strava.com/mcp');
        assert.equal(strava.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(strava.searchParams.get('code_challenge'), challenge);
        assert.match(strava.searchParams.get('state') ?? '', /^[A-Za-z0-9_-]{43}$/);
        assert.notEqual(strava.searchParams.get('state'), state);
        assert.equal(await popup.evaluate(() => window.opener === null), true);
        assert.equal(f.page.isClosed(), false);
        assert.equal(f.page.url(), origin + '/authorize');
        const gatewayRequests = f.requests.filter((url) => new URL(url).origin === origin);

        const input = f.page.locator('#callback-url');
        await input.fill(localhost + '?code=wrong-session-code&state=wrong');
        await f.page.locator('#complete').click();
        await f.page
          .locator('#status')
          .filter({ hasText: /different login/ })
          .waitFor();
        assert.equal(await input.isEnabled(), true);
        assert.equal(f.page.url(), origin + '/authorize');

        const code = 'strava-code+/with=symbols';
        const result =
          localhost +
          '?' +
          new URLSearchParams({
            code,
            state: strava.searchParams.get('state') ?? '',
            iss: 'https://www.strava.com',
          });
        await popup.goto(result);
        await input.fill(popup.url().slice('http://'.length));
        const returned = f.page.waitForURL((url) => url.origin === 'https://client.example');
        await f.page.locator('#complete').click();
        await returned;
        assert.deepEqual(Object.fromEntries(new URL(f.page.url()).searchParams), {
          app: 'strava',
          code,
          state,
          iss: origin,
        });
        assert.deepEqual(await f.context.cookies(), []);
        assert.deepEqual(
          f.requests.filter((url) => new URL(url).origin === origin),
          gatewayRequests,
          'Pasted callback data must stay in the page until navigation to the OAuth client',
        );
        assert.equal(
          f.requests.some((value) => {
            const url = new URL(value);
            return (
              url.origin === origin &&
              ['code', 'access_token', 'refresh_token'].some((key) => url.searchParams.has(key))
            );
          }),
          false,
        );
        await f.page.goto(origin);
        assert.deepEqual(
          await f.page.evaluate(() => ({
            local: localStorage.length,
            session: sessionStorage.length,
          })),
          { local: 0, session: 0 },
        );
        assert.deepEqual(f.errors, []);
      },
    );

    await t.test(
      'cancels before opening Strava without sending an authorization code',
      async (t) => {
        const f = await fixture(t, browser);
        await waitForGuide(f.page);
        const returned = f.page.waitForURL((url) => url.origin === 'https://client.example');
        await f.page.locator('#cancel').click();
        await returned;
        assert.deepEqual(Object.fromEntries(new URL(f.page.url()).searchParams), {
          app: 'strava',
          error: 'access_denied',
          state,
          iss: origin,
        });
        assert.equal(
          f.requests.some((url) => new URL(url).hostname === 'www.strava.com'),
          false,
        );
        assert.deepEqual(f.errors, []);
      },
    );

    await t.test(
      'JavaScript-disabled browsers receive a fallback without a callback form',
      async (t) => {
        const f = await fixture(t, browser, false);
        assert.match(await f.page.locator('noscript').innerText(), /JavaScript/i);
        assert.equal(await f.page.locator('#open-strava[href]').count(), 0);
        assert.equal(await f.page.locator('form input[name], form textarea[name]').count(), 0);
        for (const control of await f.page.locator('input, textarea, button').all())
          assert.equal(await control.isDisabled(), true);
        assert.equal(
          f.requests.some((url) => new URL(url).hostname === 'www.strava.com'),
          false,
        );
        assert.deepEqual(f.errors, []);
      },
    );
  },
);
