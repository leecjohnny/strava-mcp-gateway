import { STRAVA_ISSUER, STRAVA_REDIRECT } from '../strava.ts';
import type { LoginContext } from '../strava.ts';
export type { LoginContext } from '../strava.ts';

export const LOGIN_LIFETIME_MS = 10 * 60 * 1000;

/** One pending authorization in this page's memory. No tokens or browser storage. */
export class LoginFlow {
  readonly context: LoginContext;
  readonly deadline: number;
  private readonly clock: () => number;
  private readonly upstreamState: string;
  private started = false;
  private done = false;

  constructor(context: LoginContext, clock = () => performance.now()) {
    this.context = Object.freeze({ ...context });
    this.clock = clock;
    this.deadline = clock() + LOGIN_LIFETIME_MS;
    this.upstreamState = new URL(context.authorization_url).searchParams.get('state') ?? '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(this.upstreamState))
      throw new Error('Invalid login. Start linking again from ChatGPT.');
  }

  get active(): boolean {
    return !this.done && this.clock() < this.deadline;
  }

  begin(): string {
    this.requireActive();
    if (this.started) throw new Error('Strava is already open. Continue in its tab.');
    this.started = true;
    return this.context.authorization_url;
  }

  complete(value: string): string {
    this.requireActive();
    if (!this.started) throw new Error('Open Strava and approve access first.');
    const pasted = value.trim();
    const input = pasted.startsWith('localhost:') ? `http://${pasted}` : pasted;
    if (
      input.length > 24_000 ||
      !input.startsWith(STRAVA_REDIRECT + '?') ||
      /[\s\\]/u.test(input) ||
      [...input].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new Error('Paste the full localhost address from the Strava tab.');
    const url = new URL(input);
    if (
      url.origin + url.pathname !== STRAVA_REDIRECT ||
      url.username ||
      url.password ||
      url.hash ||
      input.includes('#')
    )
      throw new Error('The return address must be the localhost callback shown below.');
    const p = url.searchParams;
    const allowed = ['code', 'error', 'state', 'scope', 'iss', 'error_description', 'error_uri'];
    for (const key of p.keys()) {
      if (!allowed.includes(key) || p.getAll(key).length !== 1)
        throw new Error('This return address contains unexpected or repeated parameters.');
    }
    if (p.get('state') !== this.upstreamState)
      throw new Error(
        'This return address belongs to a different login. Use the current Strava tab.',
      );
    if (p.has('iss') && p.get('iss') !== STRAVA_ISSUER)
      throw new Error('The return address has an unexpected issuer.');
    if (p.has('code') === p.has('error') || !(p.get('code') || p.get('error')))
      throw new Error('The return address must contain an authorization code or a cancellation.');
    if (p.has('error')) return this.finish({ error: 'access_denied' });
    const code = p.get('code') ?? '';
    if (code.length >= 8192) throw new Error('The authorization code is too long.');
    return this.finish({ code });
  }

  cancel(): string {
    this.requireActive();
    return this.finish({ error: 'access_denied' });
  }

  invalidate(): void {
    this.done = true;
  }

  private requireActive(): void {
    if (!this.active)
      throw new Error('This login has ended or expired. Start linking again from ChatGPT.');
  }

  private finish(result: { code: string } | { error: string }): string {
    const target = new URL(this.context.redirect_uri);
    for (const key of ['state', 'iss', 'code', 'error', 'error_description', 'error_uri', 'scope'])
      target.searchParams.delete(key);
    for (const [key, value] of Object.entries({
      ...result,
      state: this.context.state,
      iss: this.context.issuer,
    }))
      target.searchParams.set(key, value);
    this.done = true;
    return target.href;
  }
}
