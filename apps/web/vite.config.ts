import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const target = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

// The api serves /api, the public site at / and its extra paths (/terms, /sitemap.xml, /site/*).
// Everything outside the SPA's base (/app) goes to the api (ADR 0016).
const proxy = { '^(?!/app(/|$))/.*': { target, changeOrigin: false } };

// /app (no trailing slash) serves the SPA too, as it does in production.
const appSlashRedirect: Plugin = {
  name: 'app-slash-redirect',
  configureServer(server) {
    server.middlewares.use(redirect);
  },
  configurePreviewServer(server) {
    server.middlewares.use(redirect);
  },
};

function redirect(
  req: { url?: string },
  res: { statusCode: number; setHeader(k: string, v: string): void; end(): void },
  next: () => void,
) {
  if (req.url === '/app') {
    res.statusCode = 302;
    res.setHeader('Location', '/app/');
    res.end();
    return;
  }
  next();
}

export default defineConfig({
  base: '/app/',
  plugins: [react(), tailwindcss(), appSlashRedirect],
  server: { host: '0.0.0.0', port: 5173, proxy },
  preview: { host: '0.0.0.0', port: 4173, proxy, allowedHosts: true },
});
