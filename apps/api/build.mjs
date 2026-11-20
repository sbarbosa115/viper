// Bundles the api, the worker, the scripts and the migrations into dist/ (everything bundled,
// contracts included), so the production image runs without the monorepo.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const list = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.includes('.test.'))
    .map((f) => [`${dir.replace(/^src\//, '')}/${f.replace(/\.ts$/, '')}`, `${dir}/${f}`]);

const entryPoints = Object.fromEntries([
  ['main', 'src/main.ts'],
  ['worker', 'src/worker.ts'],
  ['scripts/staff', 'src/modules/identity/scripts/staff.ts'],
  ...list('src/scripts'),
  ...list('migrations'),
]);

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/migrations', { recursive: true });

await build({
  entryPoints,
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  banner: {
    js: "import { createRequire as __bannerCreateRequire } from 'module'; const require = __bannerCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});

// The public site's legal Markdown, read at runtime from dist/content/legal (site/legal-content.ts).
cpSync('../web/src/content/legal', 'dist/content/legal', { recursive: true });
