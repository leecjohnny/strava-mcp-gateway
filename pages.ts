import { STRAVA_REDIRECT } from './strava.ts';
import type { LoginContext } from './strava.ts';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
const repository = 'https://github.com/leecjohnny/strava-mcp-gateway';
const disclaimer = `<aside class="my-7 rounded-lg border-l-4 border-amber-500 bg-amber-100 px-4 py-3 text-sm leading-6 text-amber-950"><strong class="block">Unofficial workaround for Strava users who do not use Claude.</strong>Not affiliated with or endorsed by Strava, ChatGPT (OpenAI), Cloudflare, or Vercel.</aside>`;
const heading = 'mb-3 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl';
const section = 'my-5 space-y-4 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6';

function page(body: string, context?: LoginContext): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect Strava · Strava MCP gateway</title><link rel="stylesheet" href="/assets/styles.css">${context ? '<script type="module" src="/assets/login.js"></script>' : ''}</head><body class="min-h-screen bg-stone-50 px-4 py-8 font-sans leading-7 text-stone-900 antialiased sm:px-6 sm:py-14"><main${context ? ` data-login="${escape(JSON.stringify(context))}"` : ''} class="mx-auto max-w-2xl"><p class="mb-5 text-xs font-semibold tracking-widest text-stone-500 uppercase">Strava MCP gateway</p>${body}<footer class="mt-8 text-sm text-stone-500"><a class="underline underline-offset-4" href="${repository}">Source &amp; setup</a> · <a class="underline underline-offset-4" href="${repository}/blob/main/LICENSE">MIT licensed</a></footer></main></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy':
          "default-src 'none'; script-src 'self'; style-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
      },
    },
  );
}

export function landingPage(resource: string): Response {
  return page(
    `<h1 class="${heading}">Your Strava, in ChatGPT.</h1><p class="text-lg text-stone-600">Link your account with one guided copy-and-paste step. Then ChatGPT keeps the connection refreshed for you.</p>${disclaimer}<section class="${section}"><h2 class="text-lg font-semibold">1. Add this MCP server to ChatGPT</h2><code class="block rounded-lg bg-stone-100 p-3 text-sm wrap-anywhere">${escape(resource)}</code><p>Copy this URL into ChatGPT’s custom plugin setup and choose <strong>OAuth</strong>.</p></section><section class="${section}"><h2 class="text-lg font-semibold">2. Follow the linking guide</h2><ol class="list-decimal space-y-3 pl-5"><li>Start connecting in ChatGPT. It opens a guide on this site.</li><li>Open Strava from the guide and approve access in its tab.</li><li>Strava sends you to a localhost page that will not load. Copy its full address, return to the guide, and paste it there.</li></ol><p class="text-sm leading-6 text-stone-600">No local server or installation needed. Each new authorization needs this manual step; routine refresh happens automatically through the gateway.</p></section>`,
  );
}

export function loginPage(context: LoginContext): Response {
  return page(
    `<h1 class="${heading}">Connect your Strava account.</h1><p class="text-lg text-stone-600">Keep this page open. You’ll sign in to Strava in a second tab, then bring its return address back here.</p>${disclaimer}<div id="login-guide"><section class="${section}"><p id="status" role="status">Loading the linking guide…</p><p class="text-sm text-stone-600">After approval, Strava sends you to <code class="wrap-anywhere">${STRAVA_REDIRECT}</code>. You’ll copy that entire localhost return address back here.</p><noscript><p>Enable JavaScript to complete linking safely in this page.</p></noscript></section></div>`,
    context,
  );
}
