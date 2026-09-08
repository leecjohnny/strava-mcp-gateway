# Setup and reference

Start with the [quick start](../README.md). This guide covers configuration, deployment details, and the relay's boundaries.

## Deployment

Cloudflare and Vercel deploy the same hosted implementation without application secrets or storage bindings. Use a stable public HTTPS URL that is accessible without a hosting login.

| Target             | Entrypoint                     | Public URL                                                           |
| ------------------ | ------------------------------ | -------------------------------------------------------------------- |
| Cloudflare Workers | `worker.ts`                    | Derived from the incoming request URL                                |
| Vercel             | `server.ts` → `worker.ts`      | `https://` + `VERCEL_PROJECT_PRODUCTION_URL`                         |
| ChatGPT Sites      | Compiled `worker.ts` candidate | Verify the external request URL; provisioning returns `expected_url` |

Keep Vercel's [system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_project_production_url) enabled, or set `PUBLIC_ORIGIN` explicitly. Its function streams responses with a configured 300-second duration. For alternate or custom domains, pin `PUBLIC_ORIGIN` before account linking. Neither adapter uses forwarded-host headers to choose the origin.

Cloudflare also supports CLI deployment with `npx wrangler login`, then `npm run deploy`. Platform account authentication is separate from application secrets. See the official [Cloudflare deploy-button guide](https://developers.cloudflare.com/workers/platform/deploy-buttons/) and [Vercel deploy-button guide](https://vercel.com/docs/deploy-button).

Sites uses the [deployment prompt](../prompts/deploy-sites.md) and **Anyone on the internet** audience. `npm run build:sites` prepares `dist/sites/worker.js` and `.openai/hosting.json`, with no D1 or R2 storage. It does not create a Site, push source, validate the final archive, or publish. When updating, reuse the selected Site and its `project_id`, even if the repository template omits that ID.

On the tested public Site, `/mcp` returned a Sites-generated `404`, while `/api/mcp` reached the Worker. Set the public runtime variable `MCP_PATH=/api/mcp` for Sites before packaging and publication. This candidate is tested locally; it still needs republication and an anonymous public `401` check. Native Sites MCP registration is separate: this change does not declare an MCP server to Sites. After hosted checks pass, use the exact `/api/mcp` URL when manually adding a custom MCP server to ChatGPT.

## ChatGPT OAuth settings

| Field                         | Value                                                   |
| ----------------------------- | ------------------------------------------------------- |
| MCP URL                       | `https://YOUR-DEPLOYMENT/mcp`                           |
| Client registration           | Client ID Metadata Document (CIMD)                      |
| Client metadata / ID          | `https://chatgpt.com/oauth/client.json`                 |
| Token endpoint authentication | `none` — public client with PKCE                        |
| Client secret                 | None                                                    |
| Scope                         | `mcp:read`                                              |
| Authorization endpoint        | `https://YOUR-DEPLOYMENT/authorize`                     |
| Token endpoint                | `https://YOUR-DEPLOYMENT/token`                         |
| ChatGPT callback              | `https://chatgpt.com/connector_platform_oauth_redirect` |

The defaults match ChatGPT's [published metadata](https://chatgpt.com/oauth/client.json). The relay advertises issuer identification and accepts public-client authentication with PKCE. Confirm the callback shown during connector setup. See [OpenAI's client-registration guide](https://developers.openai.com/plugins/build/auth#client-registration).

For Sites, use `https://YOUR-DEPLOYMENT/api/mcp` with `MCP_PATH=/api/mcp`. The landing page displays the configured MCP URL. Discovery and OAuth requests must use that same resource URL.

## Browser sign-in

Start linking from ChatGPT so the gateway receives ChatGPT's OAuth request and PKCE challenge. No local server, command-line tool, or browser extension is needed.

1. On the gateway's authorization page, open Strava in a separate tab and sign in.
2. Strava redirects to `http://localhost:61847/callback?...`. The browser will usually show a connection error because no service is listening locally. That is expected: copy the **entire address from the address bar**, including its query string.
3. Return to the original gateway tab, paste the address, and complete sign-in. Keep that tab open throughout; its in-memory login expires after ten minutes. Reloading or closing it requires restarting from ChatGPT.

The gateway page validates the exact localhost callback and matching state before returning the original authorization code, state, and issuer to ChatGPT. Cancelling returns an OAuth error to ChatGPT. The pasted URL contains a temporary authorization code, not an access or refresh token.

ChatGPT exchanges the code through the gateway with its original PKCE verifier. The gateway sends Strava exactly `http://localhost:61847/callback` as the redirect URI, both during authorization and code exchange. The hosted app cannot read another tab's localhost address automatically, so the copy-and-paste step is part of this flow.

ChatGPT stores the Strava-issued access and refresh tokens and requests refresh through the gateway's `/token` endpoint. Each refresh makes one request directly to Strava with the supplied refresh token and Strava's fixed public client ID; no client secret or metadata lookup is needed. The gateway returns the replacement tokens without storing them or refreshing them in the background. The manual step is needed for each new authorization; ordinary refresh and Worker restarts do not require it.

## Optional configuration

No environment file is needed with the defaults. These values are public configuration:

| Variable        | Default / purpose                                                                   |
| --------------- | ----------------------------------------------------------------------------------- |
| `CLIENT_ID`     | `https://chatgpt.com/oauth/client.json` — public OAuth client metadata URL          |
| `REDIRECT_URI`  | `https://chatgpt.com/connector_platform_oauth_redirect` — one exact HTTPS callback  |
| `PUBLIC_ORIGIN` | Automatically derived; override with an exact HTTPS origin without a trailing slash |
| `MCP_PATH`      | `/mcp`; use `/api/mcp` for the Sites candidate                                      |

Each deployment accepts one client and one exact callback. Wildcards and callback lists are unsupported. The old `REDIRECT_URIS` setting is rejected.

`MCP_PATH` selects one endpoint and its OAuth resource; it does not create an alias. For `/api/mcp`, path-specific discovery is `/.well-known/oauth-protected-resource/api/mcp`. Update the MCP URL and relink existing clients after changing this setting; requests with the old resource are rejected.

For a URL client ID, the relay fetches only that configured metadata URL and checks its identity, callback, and support for authentication method `none`. A static ID can be configured for a pre-registered public client without CIMD.

## Runtime and local checks

`worker.ts` owns OAuth and MCP behavior using standard Fetch APIs and serves the browser authorization page. `server.ts` adapts Vercel configuration. The same page and relay are used on every deployment target. No local login helper or hosted token store is needed.

The browser UI uses React, Base UI, and Tailwind CSS, with assets compiled by esbuild and Tailwind at build time. The server remains a standard Fetch handler with the same one-click deployment configuration.

Development requires Node.js 22.18+ (22.x) or 24.x. `npm ci` builds the browser assets through the package's `prepare` script; Wrangler's custom build step also rebuilds them for development and deployment.

Cloudflare's `2026-09-08` compatibility date already enables Node compatibility. The [current guidance](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) enables it by default from `2026-08-04` and recommends omitting redundant flags. Workers supports a subset of Node APIs. Vercel supports the shared [Fetch handler and TypeScript entrypoint](https://vercel.com/docs/functions/runtimes/node-js).

The public [Sites guide](https://learn.chatgpt.com/docs/sites) does not specify configurable Node compatibility flags. Confirm supported settings through its hosting instructions; do not invent fields in `.openai/hosting.json`.

| Command                     | Purpose                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `npm run check`             | Type checks, ESLint, Prettier, unit tests, and runtime tests             |
| `npm run typecheck:workers` | Generate declarations from Wrangler configuration and check Worker types |
| `npm run test:runtime`      | Build and execute local workerd with mocked upstream responses           |
| `npm run check:cloudflare`  | Build the Worker without publishing                                      |
| `npm run build:sites`       | Prepare a local Sites candidate without publishing                       |

Runtime checks open local sockets and require no hosting account or real Strava credentials. Generated declarations and build output are ignored. There are no GitHub Actions or CI workflows.

Unit and Worker runtime tests use simulated Strava responses. They verify header filtering, unchanged request bodies and bearer tokens, browser authorization, the exact localhost callback, and incremental streaming. Passing these checks does not verify live account linking, authenticated tool discovery, or token refresh.

For optional local browser checks, install Chromium once and run:

```sh
npx playwright install chromium
npm run test:browser
```

Browser checks run separately from `npm run check`, which covers unit and workerd tests without requiring a browser installation.

## Troubleshooting and limitations

- **`503 client_metadata_unavailable`:** The runtime could not fetch the configured public metadata. Check outbound access; validation fails closed.
- **Anonymous discovery:** The `/.well-known` endpoints must return JSON, and the configured MCP endpoint must return an anonymous `401` with its resource-metadata challenge, without a hosting login page.
- **OAuth succeeds but MCP discovery returns HTML `403`:** In the reported production failure, `/token` returned `200`, but ChatGPT's authenticated `server/discover` requests returned HTML `403`. The relay stripped `User-Agent`; direct Strava probes with an invalid token returned `403` without it and `401` with `User-Agent: openai-mcp/1.0.0`. The relay now forwards a nonblank incoming User-Agent or uses the honest fallback `strava-mcp-gateway/0.1.0`, and forwards `Mcp-Method` and `Mcp-Name` alongside `MCP-Protocol-Version`. A deployed header fix changed the diagnostic response from HTML `403` to JSON `401`; this does not establish successful authenticated tool discovery, which remains unverified.
- **After deployment:** Refresh the ChatGPT plugin's metadata, then retry authenticated tool discovery. An anonymous or invalid-token `401` only verifies the authentication challenge; it does not verify account linking.
- **Sites routing:** Verify `/api/mcp` after republishing with `MCP_PATH=/api/mcp`. A Sites-generated `404` differs from the Worker's JSON `not_found`. “The published Site does not declare an MCP server” concerns native Sites registration and may remain; do not invent manifest fields to remove it. Manual custom MCP setup requires the public endpoint checks to pass.
- **Local HTTPS:** Accept the development certificate. Actual ChatGPT account linking requires a public HTTPS deployment.
- **Localhost connection error:** Copy the full callback address from the address bar and paste it into the gateway tab. Do not install or start a local server. If the gateway tab expired or was reloaded, restart linking from ChatGPT.
- **Upstream dependency:** Prior probes accepted the project's localhost callback during Strava's initial redirect validation, which does not establish a successful account connection or token exchange. Continued availability of Strava client `248572` is controlled by Strava. A complete live ChatGPT-to-Strava flow remains unverified.
- **Relinking:** A lost response after refresh-token rotation or revoked credentials can require reauthorization. There is no recovery cache, refresh lock, or automatic token-exchange retry.

This is a transparent token relay: ChatGPT receives Strava-issued access and refresh tokens, and Strava enforces token validity, scopes, PKCE, code expiry and single use, and refresh rotation. The relay uses fixed upstream hosts, bounded bodies, disabled redirects, and header allowlists. Keep hosting logs from recording credentials or OAuth query strings.

The relay does not wrap tokens, isolate their audience to the gateway, or restrict use to the deployer's account. Anyone with valid Strava credentials can use it for the account those credentials authorize. Token passthrough does not satisfy [MCP's gateway-specific token-isolation requirements](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#token-handling); this tradeoff is intentional for this personal relay.

## Updating the encrypted prototype

Relink ChatGPT after upgrading; old encrypted token envelopes cannot be used as Strava tokens. Remove `KEYRING`, `CLIENT_SECRET`, and `OWNER_KEY` from hosting settings, switch ChatGPT to public CIMD, and replace `REDIRECT_URIS` with one `REDIRECT_URI`. Retired local secret files are ignored and unused.
