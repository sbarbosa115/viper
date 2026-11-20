import type { FastifyInstance } from 'fastify';

const placeholder = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Llyner Leads</title>
  </head>
  <body>
    <main>
      <h1>Llyner Leads</h1>
      <p>Llyner Leads — coming soon</p>
      <p><a href="/app/">Open the app</a></p>
    </main>
  </body>
</html>
`;

/** Placeholder public site. The real server-rendered site is WP-17 (ADR 0016). */
export async function siteRoutes(app: FastifyInstance): Promise<void> {
  await Promise.resolve();
  app.get('/', { config: { rateLimit: false } }, (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(placeholder),
  );
}
