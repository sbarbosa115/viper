# cPanel deployment details

## Layout on the server
```
~/apps/<app>/                     # Node.js app root (outside public_html)
  releases/<git-sha>/             # each deploy: contents of apps/api/dist (main.js, scripts/, migrations/, app.cjs, package.json)
  current -> releases/<git-sha>   # symlink; the Node app's "Application root" points here
  shared/.env                     # production env, chmod 600, never in git
  backups/                        # mysqldump files, newest 10 kept
~/public_html/ (or the domain's document root)
  index.html, assets/, .htaccess  # contents of apps/web/dist
```
Staging uses the same structure under `~/apps/<app>-staging/`, with its own database and subdomain.

## Node.js App setup (one time, per environment)
In cPanel → **Setup Node.js App** → Create:
- Node version: the one in `stack.md`
- Application mode: Production
- Application root: `apps/<app>/current`
- Application URL: the domain, with path `api` (so Passenger serves `/api/*`, and Apache serves the SPA for everything else)
- Startup file: `app.cjs`
- Environment variables: set them in the UI, or load `shared/.env` from `main.ts` when `ENV_FILE` is set

If the host's Passenger can't be mounted on a subpath, use the URL root and let the API serve the built SPA with `@fastify/static` for non-`/api` paths. Record which option you chose in an ADR.

## Passenger startup shim (`app.cjs`, generated into dist by the build)
```js
// Passenger loads startup files with require(); this loads the ESM bundle.
import('./main.js').catch((err) => { console.error(err); process.exit(1); });
```
`main.ts` listens on `process.env.PORT`; Passenger intercepts the listen call.

## Dependencies on the server
The API bundle includes every dependency that can be bundled, so usually **nothing needs installing**. If `dist/package.json` lists external packages, run `npm install --omit=dev` from the Node app's virtualenv. cPanel shows the exact `source …/activate` command at the top of the app page. Don't delete the `node_modules` symlink that CloudLinux manages.

## SPA fallback `.htaccess`
```apache
RewriteEngine On
RewriteBase /
RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
RewriteRule ^api/ - [L]
RewriteRule ^index\.html$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
<FilesMatch "\.(js|css|woff2|svg|png|jpg|webp)$">
  Header set Cache-Control "public, max-age=31536000, immutable"
</FilesMatch>
<FilesMatch "index\.html$">
  Header set Cache-Control "no-cache"
</FilesMatch>
```

## Cron jobs
cPanel → Cron Jobs, for example every minute:
`cd ~/apps/<app>/current && /home/<user>/nodevenv/apps/<app>/current/<ver>/bin/node scripts/process-outbox.js >> ~/logs/outbox.log 2>&1`
Every job must be safe to rerun and safe to run twice at the same time. Use a DB lock (`GET_LOCK`).

## Restart and logs
- Restart: the button in the Node.js App UI, or `mkdir -p tmp && touch tmp/restart.txt` in the app root.
- Logs: Passenger's stderr log (path shown in the app settings), plus Sentry.

## Deploying over SSH
Prefer `rsync -az --delete` over SSH. If the host has no SSH, use cPanel Git Version Control with a `.cpanel.yml` that copies the built artifacts. That needs the build committed to a deploy branch; record it in an ADR.
