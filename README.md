# Strava MCP gateway

Connect ChatGPT to Strava with a stateless TypeScript relay and a browser-guided sign-in. Deploy to Cloudflare or Vercel without application secrets or a database.

> [!WARNING]
> **Unofficial.** Not affiliated with or endorsed by Strava, ChatGPT (OpenAI), Cloudflare, or Vercel. Strictly a workaround for Strava users who do not use Claude.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fleecjohnny%2Fstrava-mcp-gateway)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fleecjohnny%2Fstrava-mcp-gateway&project-name=strava-mcp-gateway&repository-name=strava-mcp-gateway)

## Deploy

Click a deploy button and use the assigned public HTTPS URL. The relay detects its URL automatically.

For ChatGPT Sites, use the [deployment prompt](prompts/deploy-sites.md). The `/api/mcp` route configuration still needs a published check; Sites intercepts `/mcp`.

## Connect Strava

1. Add the MCP URL shown on your deployment's homepage to ChatGPT using OAuth with **CIMD**, token authentication **none**, and scope **mcp:read**. It defaults to `https://YOUR-DEPLOYMENT/mcp`.
2. Follow the gateway's sign-in page to Strava. After signing in, copy the full `http://localhost:61847/callback?...` address from the browser's address bar, even though the page cannot load.
3. Paste that address into the original gateway page to finish linking.

No local installation is required. This copy-and-paste step is required for each new authorization; ChatGPT refreshes tokens through the gateway afterward. Strava always receives the localhost redirect URI during authorization and code exchange.

See [OAuth settings, configuration, and limitations](docs/setup.md). Live ChatGPT-to-Strava linking remains unverified.

## Develop

Requires Node.js 22.18+ (22.x) or 24.x.

```sh
npm ci
npm run dev
```

Open [https://127.0.0.1:8787](https://127.0.0.1:8787) and accept the development certificate.

```sh
npm run check       # Types, ESLint, Prettier, and unit/runtime tests
npm run format      # Format files
npm run lint:fix    # Apply lint fixes
```

Checks run locally. Deployment uses the buttons above or the Sites prompt.

## License

[MIT](LICENSE) © 2026 Johnny Lee.
