# BTC Regime dashboard - project authority

Read this file before changing or operating the project. `CLAUDE.md` imports it so Claude Code
and Codex share one continuity source.

## Runtime contract

- The Windows production process is launched by `../dashboards-control` with
  `node --import tsx server/index.ts`.
- The API and built frontend listen only on `127.0.0.1:3002`. Never widen this to `0.0.0.0` or
  `::`; public access is exclusively `https://btc.raulantonio.xyz` through Cloudflare Tunnel.
- The daily sync is `06:30 UTC` and must keep an explicit `timezone: "UTC"` option.
- A successful process or HTTP 200 is insufficient. `/api/stats` must report a recent successful
  full sync and a plausible latest data date.

## Public security boundary

- All external HTTP requests redirect permanently to the fixed HTTPS origin.
- Keep the headers and `no-transform` cache policy in `server/security.ts`. `no-transform`
  prevents Cloudflare Web Analytics from injecting third-party JavaScript.
- Keep the browser API same-origin; do not restore unrestricted CORS.
- `POST /api/sync` is an operator action, not a public API. It requires a direct loopback socket,
  no proxy headers, and `X-Local-Admin: 1`. Do not put a secret in source.
- Do not add remote fonts, scripts, analytics, credentials, or a permissive CSP.

## Change and verification workflow

1. Preserve unrelated working-tree changes, especially the dashboard visual work.
2. Run `npm run test:security`, `npm run build`, and `npm run lint`.
   On this PC, run the Vite build from the physical target
   `C:\Users\radr1\OneDrive\Documents\Coding\btcRegimeDashboard`; Vite 7 can miscompute its
   HTML asset path when the working directory is the `Systems\btc-regime` junction.
3. Restart only `btc-regime` through the dashboard supervisor.
4. Verify localhost 200, LAN refusal, public HTTPS 200, public HTTP 308, security headers, no
   Cloudflare beacon, public sync 404, current data, and a clean browser console.
5. Never commit `.env`, SQLite runtime files, logs, safety backups, or `node_modules`.

Manual sync, when deliberately needed from this host:

```powershell
Invoke-WebRequest -Method Post -Uri http://127.0.0.1:3002/api/sync `
  -Headers @{ 'X-Local-Admin' = '1' }
```
