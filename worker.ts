// Transparent Strava relay: no deployment secrets, persistent state, or token wrappers.
import { loginScript, stylesheet } from './.generated/web.ts';
import { landingPage, loginPage } from './pages.ts';
import {
  STRAVA_CLIENT_ID,
  STRAVA_ISSUER,
  STRAVA_REDIRECT as REDIRECT,
  STRAVA_RESOURCE as UP,
  STRAVA_SCOPES as SCOPES,
} from './strava.ts';

export interface GatewayEnv {
  readonly PUBLIC_ORIGIN?: string;
  readonly MCP_PATH?: string;
  readonly CLIENT_ID?: string;
  readonly REDIRECT_URI?: string;
  readonly REDIRECT_URIS?: string;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Parameters = Record<string, string | undefined>;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const TOKEN = STRAVA_ISSUER + '/oauth/mcp/token';
const dec = new TextDecoder();
class Fault extends Error {
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.status = status;
  }
}
function requireThat(ok: unknown, code = 'invalid_request', status = 400): asserts ok {
  if (!ok) throw new Fault(code, status);
}
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
async function bounded(
  request: Request | Response,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Fault('request_too_large', 413);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
function params(value: URLSearchParams): Parameters {
  for (const key of value.keys()) requireThat(value.getAll(key).length === 1);
  return Object.fromEntries(value);
}

// Factory permits isolated tests; production uses only immutable environment configuration.
export function createGateway(
  env: GatewayEnv & { PUBLIC_ORIGIN: string },
  fetcher: Fetcher = fetch,
  clock = () => Math.floor(Date.now() / 1000),
) {
  const origin = new URL(env.PUBLIC_ORIGIN).origin;
  requireThat(
    origin === env.PUBLIC_ORIGIN && origin.startsWith('https://'),
    'invalid_configuration',
    503,
  );
  const mcpPath = env.MCP_PATH ?? '/mcp';
  requireThat(/^\/(?:[A-Za-z0-9_-]+\/)*mcp$/.test(mcpPath), 'invalid_configuration', 503);
  const resource = origin + mcpPath,
    cid = env.CLIENT_ID || 'https://chatgpt.com/oauth/client.json';
  const callback = env.REDIRECT_URI || 'https://chatgpt.com/connector_platform_oauth_redirect';
  requireThat(typeof callback === 'string', 'invalid_configuration', 503);
  const u = new URL(callback);
  requireThat(
    u.protocol === 'https:' && !u.hash && !u.username && !u.password && !env.REDIRECT_URIS,
    'invalid_configuration',
    503,
  );
  requireThat(typeof cid === 'string' && cid.length <= 2048, 'invalid_configuration', 503);
  const cimd = cid.startsWith('https://');
  if (cimd) {
    const client = new URL(cid);
    requireThat(
      client.pathname !== '/' && !client.hash && !client.username && !client.password,
      'invalid_configuration',
      503,
    );
  }
  async function validateClient() {
    if (!cimd) return;
    // Only the deployment's fixed client URL is fetched, never an arbitrary caller URL.
    let metadata: unknown;
    try {
      const response = await fetcher(cid, {
        redirect: 'manual',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('metadata_unavailable');
      }
      metadata = JSON.parse(dec.decode(await bounded(response, 65536)));
    } catch {
      throw new Fault('client_metadata_unavailable', 503);
    }
    requireThat(isObject(metadata), 'invalid_configuration', 503);
    const methods = metadata.token_endpoint_auth_methods_supported ?? [
      metadata.token_endpoint_auth_method,
    ];
    requireThat(
      metadata.client_id === cid &&
        Array.isArray(metadata.redirect_uris) &&
        metadata.redirect_uris.includes(callback) &&
        Array.isArray(methods) &&
        methods.includes('none'),
      'invalid_configuration',
      503,
    );
  }
  async function form(request: Request) {
    requireThat(
      (request.headers.get('Content-Type') || '').split(';')[0] ===
        'application/x-www-form-urlencoded',
      'invalid_request',
      415,
    );
    return params(new URLSearchParams(dec.decode(await bounded(request, 32768))));
  }
  async function upstreamToken(body: Record<string, string>): Promise<unknown> {
    let response;
    try {
      response = await fetcher(TOKEN, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ ...body, client_id: STRAVA_CLIENT_ID, resource: UP }),
      });
    } catch {
      throw new Fault('temporarily_unavailable', 503);
    }
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel();
      throw new Fault(
        status === 400 || status === 401 ? 'invalid_grant' : 'temporarily_unavailable',
        status === 400 || status === 401 ? 400 : 503,
      );
    }
    try {
      return JSON.parse(dec.decode(await bounded(response, 65536)));
    } catch {
      throw new Fault('server_error', 502);
    }
  }
  async function tokens(up: unknown, previousRefresh?: string) {
    requireThat(isObject(up), 'server_error', 502);
    requireThat(
      typeof up.access_token === 'string' && up.access_token.length > 0,
      'server_error',
      502,
    );
    const refresh = up.refresh_token ?? previousRefresh;
    requireThat(typeof refresh === 'string' && refresh.length > 0, 'server_error', 502);
    const expiration =
      typeof up.expires_at === 'number' && Number.isFinite(up.expires_at)
        ? up.expires_at
        : clock() + Number(up.expires_in || 0);
    const ttl = Math.floor(expiration - clock() - 30);
    requireThat(Number.isFinite(ttl) && ttl > 0, 'server_error', 502);
    return json({
      token_type: 'Bearer',
      expires_in: ttl,
      scope: 'mcp:read',
      access_token: up.access_token,
      refresh_token: refresh,
    });
  }
  async function validateAuth(p: Parameters) {
    requireThat(p.client_id === cid && p.redirect_uri === callback);
    requireThat(p.response_type === 'code' && p.code_challenge_method === 'S256');
    requireThat(
      typeof p.code_challenge === 'string' && /^[A-Za-z0-9_-]{43}$/.test(p.code_challenge),
    );
    requireThat(typeof p.state === 'string' && p.state.length > 0 && p.state.length <= 2048);
    requireThat(p.resource === resource, 'invalid_target');
    requireThat(!p.scope || p.scope === 'mcp:read', 'invalid_scope');
    await validateClient();
    return {
      client_id: cid,
      redirect_uri: callback,
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: p.code_challenge,
      state: p.state,
      resource,
      scope: 'mcp:read',
    };
  }
  return {
    async fetch(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url);
        requireThat(url.origin === origin, 'invalid_request', 400);
        if (request.method === 'GET' && url.pathname === '/') {
          return landingPage(resource);
        }
        if (
          request.method === 'GET' &&
          ['/assets/login.js', '/assets/styles.css'].includes(url.pathname)
        ) {
          const script = url.pathname.endsWith('.js');
          return new Response(script ? loginScript : stylesheet, {
            headers: {
              'Content-Type': script ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        }
        if (
          request.method === 'GET' &&
          [
            '/.well-known/oauth-protected-resource',
            '/.well-known/oauth-protected-resource' + mcpPath,
          ].includes(url.pathname)
        ) {
          return json({
            resource,
            authorization_servers: [origin],
            scopes_supported: ['mcp:read'],
            bearer_methods_supported: ['header'],
          });
        }
        if (
          request.method === 'GET' &&
          url.pathname === '/.well-known/oauth-authorization-server'
        ) {
          return json({
            issuer: origin,
            authorization_endpoint: origin + '/authorize',
            token_endpoint: origin + '/token',
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: ['none'],
            code_challenge_methods_supported: ['S256'],
            client_id_metadata_document_supported: cimd,
            scopes_supported: ['mcp:read'],
            authorization_response_iss_parameter_supported: true,
          });
        }
        if (url.pathname === '/authorize' && request.method === 'GET') {
          const downstream = await validateAuth(params(url.searchParams));
          // Only this response carries the state; the server retains no transaction.
          const state = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
          const auth = new URL(STRAVA_ISSUER + '/oauth/mcp/authorize');
          auth.search = new URLSearchParams({
            response_type: 'code',
            client_id: STRAVA_CLIENT_ID,
            redirect_uri: REDIRECT,
            code_challenge: downstream.code_challenge,
            code_challenge_method: 'S256',
            state,
            scope: SCOPES,
            resource: UP,
          }).toString();
          return loginPage({
            authorization_url: auth.href,
            redirect_uri: callback,
            state: downstream.state,
            issuer: origin,
          });
        }
        if (url.pathname === '/token' && request.method === 'POST') {
          const p = await form(request);
          requireThat(
            p.client_id === cid &&
              p.client_secret === undefined &&
              !request.headers.has('Authorization'),
            'invalid_client',
            401,
          );
          requireThat(p.resource === resource, 'invalid_target');
          if (p.grant_type === 'authorization_code') {
            requireThat(
              p.redirect_uri === callback &&
                typeof p.code === 'string' &&
                p.code.length > 0 &&
                p.code.length < 8192 &&
                typeof p.code_verifier === 'string' &&
                /^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier),
              'invalid_grant',
            );
            await validateClient();
            // The same PKCE challenge/verifier crosses both legs. Strava consumes its code once.
            return await tokens(
              await upstreamToken({
                grant_type: 'authorization_code',
                code: p.code,
                code_verifier: p.code_verifier,
                redirect_uri: REDIRECT,
              }),
            );
          }
          if (p.grant_type === 'refresh_token') {
            requireThat(!p.scope || p.scope === 'mcp:read', 'invalid_scope');
            requireThat(
              typeof p.refresh_token === 'string' &&
                p.refresh_token.length > 0 &&
                p.refresh_token.length < 16000,
              'invalid_grant',
            );
            // Refresh only needs the supplied Strava credential and fixed public client ID.
            return await tokens(
              await upstreamToken({ grant_type: 'refresh_token', refresh_token: p.refresh_token }),
              p.refresh_token,
            );
          }
          throw new Fault('unsupported_grant_type');
        }
        if (url.pathname === mcpPath) {
          requireThat(
            ['POST', 'GET', 'DELETE'].includes(request.method),
            'method_not_allowed',
            405,
          );
          const requestOrigin = request.headers.get('Origin');
          requireThat(!requestOrigin || requestOrigin === origin, 'access_denied', 403);
          const authorization = request.headers.get('Authorization') || '';
          const access = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(authorization);
          if (!access || authorization.length > 16000)
            return json({ error: 'invalid_token' }, 401, {
              'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", error="invalid_token"`,
            });
          const userAgent = request.headers.get('User-Agent');
          const headers = new Headers({
            Authorization: `Bearer ${access[1]}`,
            Accept: 'application/json, text/event-stream',
            'User-Agent': userAgent?.trim() ? userAgent : 'strava-mcp-gateway/0.1.0',
          });
          for (const name of [
            'Accept',
            'Content-Type',
            'MCP-Protocol-Version',
            'Mcp-Method',
            'Mcp-Name',
            'Mcp-Session-Id',
            'Last-Event-ID',
          ]) {
            const value = request.headers.get(name);
            if (value !== null) headers.set(name, value);
          }
          const body = request.method === 'POST' ? await bounded(request, 1048576) : undefined;
          if (request.method === 'POST')
            requireThat(
              (headers.get('Content-Type') || '').split(';')[0] === 'application/json',
              'invalid_request',
              415,
            );
          const up = await fetcher(UP, {
            method: request.method,
            headers,
            body,
            redirect: 'manual',
            signal: request.signal,
          });
          if (up.status === 401) {
            await up.body?.cancel();
            return json({ error: 'invalid_token' }, 401, {
              'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", error="invalid_token"`,
            });
          }
          if (up.status >= 300 && up.status < 400) {
            await up.body?.cancel();
            throw new Fault('upstream_redirect_rejected', 502);
          }
          const out = new Headers({ 'Cache-Control': 'no-store' });
          for (const name of [
            'Content-Type',
            'Mcp-Session-Id',
            'MCP-Protocol-Version',
            'Retry-After',
            'Allow',
          ]) {
            const value = up.headers.get(name);
            if (value !== null) out.set(name, value);
          }
          return new Response(up.body, { status: up.status, headers: out });
        }
        throw new Fault('not_found', 404);
      } catch (error) {
        return json(
          { error: error instanceof Fault ? error.message : 'server_error' },
          error instanceof Fault ? error.status : 502,
        );
      }
    },
  };
}
export default {
  async fetch(request: Request, env: GatewayEnv = {}): Promise<Response> {
    // Workers supplies the request URL. Never derive the issuer from forwarded headers.
    try {
      return await createGateway({
        ...env,
        PUBLIC_ORIGIN: env.PUBLIC_ORIGIN || new URL(request.url).origin,
      }).fetch(request);
    } catch {
      return json({ error: 'invalid_configuration' }, 503);
    }
  },
};
