# [Strava](https://support.strava.com/en-us/articles/15401531-strava-mcp-connector) MCP gateway

Connect ChatGPT to [Strava](https://support.strava.com/en-us/articles/15401531-strava-mcp-connector) with a stateless TypeScript gateway. No application secrets, database, or local server required.

> [!WARNING]
> **Unofficial.** Not affiliated with or endorsed by Strava, ChatGPT (OpenAI), Cloudflare, or Vercel. Strictly a workaround for Strava users who do not use Claude.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fleecjohnny%2Fstrava-mcp-gateway)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fleecjohnny%2Fstrava-mcp-gateway&project-name=strava-mcp-gateway&repository-name=strava-mcp-gateway)
[Deploy to ChatGPT Sites](prompts/deploy-sites.md)

## Get started

Enable [developer mode](https://developers.openai.com/api/docs/guides/developer-mode) in ChatGPT before connecting.

1. Choose a deployment option above.
2. Open your deployment's homepage and follow the instructions to connect Strava. It displays the correct MCP URL automatically.

For ChatGPT Sites, paste the [deployment prompt](prompts/deploy-sites.md) into ChatGPT. Requires a ChatGPT subscription with Sites enabled; see the [Sites docs](https://learn.chatgpt.com/docs/sites).

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
