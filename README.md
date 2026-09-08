# Strava MCP gateway

Connect ChatGPT to Strava with a stateless TypeScript gateway. No application secrets, database, or local server required.

> [!WARNING]
> **Unofficial.** Not affiliated with or endorsed by Strava, ChatGPT (OpenAI), Cloudflare, or Vercel. Strictly a workaround for Strava users who do not use Claude.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fleecjohnny%2Fstrava-mcp-gateway)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fleecjohnny%2Fstrava-mcp-gateway&project-name=strava-mcp-gateway&repository-name=strava-mcp-gateway)

## Get started

1. Deploy with either button above.
2. Open your deployment's homepage and follow the instructions to connect Strava. It displays the correct MCP URL automatically.

For ChatGPT Sites, use the [deployment prompt](prompts/deploy-sites.md).

See [setup and troubleshooting](docs/setup.md) for details.

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
