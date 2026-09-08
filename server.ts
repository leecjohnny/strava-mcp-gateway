import gateway from './worker.ts';

// Vercel supplies Web Requests and streams Web Responses in its Node.js runtime.
export default {
  fetch(request: Request) {
    const env = process.env;
    const origin =
      env.PUBLIC_ORIGIN ||
      (env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`);
    // Keep OAuth discovery on the production domain rather than a deployment alias.
    if (!origin)
      return Response.json(
        { error: 'invalid_configuration' },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    return gateway.fetch(request, { ...env, PUBLIC_ORIGIN: origin });
  },
};
