# First-party README examples

Reviewed on 2026-09-08: **14 example projects across 10 repositories** owned by Cloudflare, Vercel, or Vercel Labs. Each linked README contains a deploy button or a clone-and-deploy link. This review inspected documentation and links without deploying anything.

| Owner       | Example                                                                                                                         | README structure                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Cloudflare  | [Agents starter](https://github.com/cloudflare/agents-starter/blob/main/README.md)                                              | Deploy button near the title, brief introduction, quick start, customization, documentation |
| Cloudflare  | [Durable chat](https://github.com/cloudflare/durable-chat-template/blob/main/README.md)                                         | Deploy button, demo, explanation, three setup steps                                         |
| Cloudflare  | [VibeSDK](https://github.com/cloudflare/vibesdk/blob/main/README.md)                                                            | Short introduction, demo and deploy button, capabilities, links to detailed setup           |
| Cloudflare  | [Claude managed agents](https://github.com/cloudflare/claude-managed-agents/blob/main/README.md)                                | Longer reference application with onboarding, deploy button, configuration, and tests       |
| Cloudflare  | [React starter](https://github.com/cloudflare/templates/blob/main/react-starter-template/README.md)                             | Deploy button, one-sentence description, features, local commands, resources                |
| Cloudflare  | [Hello World Durable Object](https://github.com/cloudflare/templates/blob/main/hello-world-do-template/README.md)               | Deploy button, brief purpose, install and development commands, deployment                  |
| Cloudflare  | [Chanfana OpenAPI](https://github.com/cloudflare/templates/blob/main/chanfana-openapi-template/README.md)                       | Deploy button, overview, setup steps, local testing, short file map                         |
| Cloudflare  | [Node.js HTTP server](https://github.com/cloudflare/templates/blob/main/nodejs-http-server-template/README.md)                  | Deploy button, short description, quick start, code example, configuration, docs            |
| Cloudflare  | [Multiplayer globe](https://github.com/cloudflare/templates/blob/main/multiplayer-globe-template/README.md)                     | Deploy button, screenshot and description, short explanation, three setup commands          |
| Vercel      | [Next.js portfolio starter](https://github.com/vercel/nextjs-portfolio-starter/blob/main/README.md)                             | Purpose and features, short configuration steps, deploy button, local commands              |
| Vercel      | [Next.js Postgres admin dashboard](https://github.com/vercel/nextjs-postgres-nextauth-tailwindcss-template/blob/main/README.md) | Demo and clone-and-deploy links near the title, stack overview, getting started             |
| Vercel      | [Chatbot](https://github.com/vercel/chatbot/blob/main/README.md)                                                                | Introduction and documentation links, features, deploy button, running locally              |
| Vercel Labs | [Lead agent](https://github.com/vercel-labs/lead-agent/blob/main/README.md)                                                     | Overview, deploy button before architecture and advanced setup                              |
| Vercel Labs | [AI SDK Python streaming preview](https://github.com/vercel-labs/ai-sdk-preview-python-streaming/blob/main/README.md)           | Brief purpose, deploy button, local commands, further reading                               |

The five examples in `cloudflare/templates` count as one repository. The Chatbot repository's former `ai-chatbot` name is not counted separately. Vercel Commerce and Platforms were excluded because their current READMEs did not contain a one-click deploy button or link.

The compact starters prioritize purpose, a visible deploy button, minimum setup, and local commands. Larger reference applications have longer READMEs, so brevity is a useful starter convention rather than a universal provider rule.

The [rewritten README](../README.md) follows the compact structure. It keeps the localhost callback requirement visible and links to [setup and reference](setup.md) for OAuth settings, runtime configuration, and limitations. These examples informed documentation structure only; their dependencies, CI workflows, and deployment requirements were not copied.
