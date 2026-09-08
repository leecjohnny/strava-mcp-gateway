import { Button } from '@base-ui/react/button';
import { CSPProvider } from '@base-ui/react/csp-provider';
import { Field } from '@base-ui/react/field';
import { Form } from '@base-ui/react/form';
import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { STRAVA_REDIRECT } from '../strava.ts';
import { LoginFlow } from './login.ts';

const card = 'my-5 space-y-4 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6';
const hint = 'text-sm leading-6 text-stone-600';
const primary =
  'inline-flex cursor-pointer items-center justify-center rounded-lg bg-emerald-900 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40';
type Phase = 'ready' | 'waiting' | 'returning' | 'expired' | 'ended';
const messages: Record<Phase, string> = {
  ready: 'Keep this page open while you sign in to Strava.',
  waiting: 'After approval, copy the full address from the Strava tab and paste it here.',
  returning: 'Returning to ChatGPT…',
  expired: 'This login expired. Start linking again from ChatGPT.',
  ended: 'This login has ended. Start linking again from ChatGPT.',
};

function Guide({ flow }: { flow: LoginFlow }) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const ended = phase !== 'ready' && phase !== 'waiting';

  useEffect(() => {
    const end = (reason: 'expired' | 'ended') => {
      flow.invalidate();
      setValue('');
      setError('');
      setPhase(reason);
    };
    const pageHidden = () => end('ended');
    window.addEventListener('pagehide', pageHidden);
    const timeout = window.setTimeout(
      () => end('expired'),
      Math.max(0, flow.deadline - performance.now()),
    );
    return () => {
      window.removeEventListener('pagehide', pageHidden);
      window.clearTimeout(timeout);
    };
  }, [flow]);

  function report(cause: unknown) {
    setError(
      cause instanceof Error
        ? cause.message
        : 'Unable to finish linking. Start again from ChatGPT.',
    );
    if (!flow.active) {
      setPhase('ended');
      setValue('');
    }
  }

  function openStrava(event: MouseEvent<HTMLAnchorElement>) {
    try {
      flow.begin();
      setPhase('waiting');
      setError('');
      // Keep href intact for this click's native new-tab navigation.
    } catch (cause) {
      event.preventDefault();
      report(cause);
    }
  }

  function finish(target: string) {
    setValue('');
    setError('');
    setPhase('returning');
    window.location.replace(target);
  }

  return (
    <CSPProvider disableStyleElements>
      <section className={card}>
        <h2 className="text-lg font-semibold">1. Sign in and approve access</h2>
        <p>
          Continue only if you just started linking in ChatGPT. This connects your Strava profile
          and activities, including private activities.
        </p>
        <a
          id="open-strava"
          className={primary}
          href={ended ? undefined : flow.context.authorization_url}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={phase !== 'ready'}
          tabIndex={phase === 'ready' ? 0 : -1}
          onClick={openStrava}
          onAuxClick={(event) => {
            if (event.button === 1) openStrava(event);
          }}
        >
          Open Strava ↗
        </a>
        <p className={hint}>
          The next steps take place on Strava. This page never asks for your Strava password.
        </p>
      </section>
      <section className={card}>
        <h2 className="text-lg font-semibold">2. Copy the address after approval</h2>
        <p>
          The Strava tab will reach a page that says it can’t connect. That is expected. Copy the{' '}
          <strong>entire address from the address bar</strong>, starting with:
        </p>
        <code className="block rounded-lg bg-stone-100 p-3 text-sm wrap-anywhere">
          {STRAVA_REDIRECT}?code=…&amp;state=…
        </code>
        <p className={hint}>
          Use the address from this login. Return here without closing or reloading this guide. The
          guide expires after 10 minutes.
        </p>
      </section>
      <section className={card}>
        <h2 className="text-lg font-semibold">3. Finish connecting</h2>
        <Form
          id="complete-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            try {
              finish(flow.complete(value));
            } catch (cause) {
              report(cause);
            }
          }}
        >
          <Field.Root disabled={phase !== 'waiting'} invalid={Boolean(error)} className="space-y-3">
            <Field.Label className="block text-sm font-semibold">
              Full localhost return address
            </Field.Label>
            <Field.Control
              id="callback-url"
              render={<textarea rows={3} />}
              value={value}
              onValueChange={(next) => {
                setValue(next);
                setError('');
              }}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={24_000}
              placeholder={`${STRAVA_REDIRECT}?…`}
              className="block w-full resize-y rounded-lg border border-stone-300 bg-white p-3 text-sm leading-6 wrap-anywhere disabled:bg-stone-50 disabled:opacity-60 data-invalid:border-red-600"
            />
            <Field.Description className={hint}>
              This address contains a one-time authorization code. Paste it only here. ChatGPT
              receives the tokens after completing the connection.
            </Field.Description>
          </Field.Root>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button id="complete" type="submit" disabled={phase !== 'waiting'} className={primary}>
              Finish in ChatGPT
            </Button>
            <Button
              id="cancel"
              type="button"
              disabled={ended}
              className="cursor-pointer rounded-lg bg-stone-100 px-5 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-200 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => {
                try {
                  finish(flow.cancel());
                } catch (cause) {
                  report(cause);
                }
              }}
            >
              Cancel
            </Button>
          </div>
        </Form>
        <p
          id="status"
          role="status"
          aria-live="polite"
          className={error ? 'text-sm leading-6 text-red-700' : hint}
        >
          {error || messages[phase]}
        </p>
      </section>
    </CSPProvider>
  );
}

function mount() {
  const page = document.querySelector<HTMLElement>('main[data-login]');
  const root = document.getElementById('login-guide');
  if (!page || !root) return;
  try {
    const data: unknown = JSON.parse(page.dataset.login ?? '');
    if (
      !data ||
      typeof data !== 'object' ||
      !('authorization_url' in data) ||
      typeof data.authorization_url !== 'string' ||
      !('redirect_uri' in data) ||
      typeof data.redirect_uri !== 'string' ||
      !('state' in data) ||
      typeof data.state !== 'string' ||
      !('issuer' in data) ||
      data.issuer !== window.location.origin
    )
      throw new Error('Invalid login page. Start linking again from ChatGPT.');
    const flow = new LoginFlow({
      authorization_url: data.authorization_url,
      redirect_uri: data.redirect_uri,
      state: data.state,
      issuer: data.issuer,
    });
    page.removeAttribute('data-login');
    // The transaction now lives only in page memory; reload requires a new login.
    window.history.replaceState(null, '', '/authorize');
    createRoot(root).render(<Guide flow={flow} />);
  } catch {
    root.textContent = 'Unable to load this login. Start linking again from ChatGPT.';
  }
}

mount();
