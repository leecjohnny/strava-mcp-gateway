# Setup

Deploy from the [README](../README.md) and use a public HTTPS URL.

## Connect Strava

Enable [developer mode](https://developers.openai.com/api/docs/guides/developer-mode) in ChatGPT. Open your deployment's homepage, copy its MCP URL into ChatGPT's custom plugin setup, choose **OAuth**, and follow the sign-in guide.

After approving Strava, copy the entire localhost callback address into the gateway tab. Addresses copied without `http://` are also accepted. No local server is needed.

## Deployment settings

Cloudflare and Vercel detect the deployment URL automatically. Keep Vercel's [system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_project_production_url) enabled.

| Variable        | When to use it                                                                  |
| --------------- | ------------------------------------------------------------------------------- |
| `PUBLIC_ORIGIN` | Override the detected URL with an exact HTTPS origin, without a trailing slash. |
| `MCP_PATH`      | Defaults to `/mcp`. Use `/api/mcp` for ChatGPT Sites.                           |

For Sites, follow the [deployment prompt](../prompts/deploy-sites.md) and publish for **Anyone on the internet**. After changing the origin or MCP path, reconnect using the URL shown on the homepage.

## Troubleshooting

- **Localhost connection error:** Expected. Copy the full address, including its query string, and paste it into the original gateway tab.
- **Login expired or tab reloaded:** Restart linking from ChatGPT. Keep the gateway tab open; each login lasts ten minutes.
- **Tools missing after an update:** Refresh the ChatGPT plugin's metadata and retry. Reconnect if authorization has expired or been revoked.
- **Deployment inaccessible:** Check that the homepage opens publicly and the displayed MCP endpoint returns JSON `401` without credentials, rather than a hosting login page.

## Relay behavior

The server stores no tokens or sessions. ChatGPT holds Strava-issued tokens and refreshes them through the gateway. Strava always receives exactly `http://localhost:61847/callback` during authorization and code exchange. Tokens pass through directly, without gateway-specific audience isolation.
