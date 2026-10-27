# No-Card Hosting for OGII

## What this option provides

This route requires no Oracle account, payment card, DNS account, or custom
domain. It runs the existing production Docker image on your Windows PC and
publishes it through a Cloudflare Quick Tunnel:

```text
Browser -> https://random-name.trycloudflare.com -> cloudflared -> Docker -> SQLite
```

The SQLite database stays on a persistent Docker volume on the PC. The URL is
temporary, changes after the tunnel restarts, and stops working when the PC,
Docker, or `cloudflared` stops. Cloudflare documents Quick Tunnels as testing
and development infrastructure, not guaranteed production hosting.

## 1. Build the image

Open PowerShell in:

```powershell
Set-Location D:\OGII\REPO\Swayanshu
```

Create a production environment file without committing it:

```powershell
Copy-Item deploy\production.env.example .env
```

Edit `.env` and set real values. For this single-origin tunnel, use a valid
HTTPS placeholder origin such as:

```dotenv
DOMAIN=portal.localhost
CORS_ORIGIN=https://portal.localhost
TRUST_PROXY=1
OTP_DELIVERY_PROVIDER=brevo-smtp
```

Set the real admin values, three distinct production passwords, OTP provider
credentials, and a strong `JWT_SECRET`. The S3 backup values can remain
configured if you want off-machine backups; the standalone portal container
does not use them.

Build the same image used by the VPS deployment:

```powershell
docker compose --env-file .env build --pull portal
```

## 2. Create a persistent SQLite volume

Use a named Docker volume so recreating the container does not remove SQLite:

```powershell
docker volume create ogii-portal-data
```

For a new production database, seed the volume once:

```powershell
docker run --rm --env-file .env `
  --mount source=ogii-portal-data,target=/app/data `
  smart-college-portal:production npm run seed
```

The production seed creates the configured administrator and academic catalog
options needed for registration; it does not add development demo accounts.
The existing local database currently contains
five demo accounts, so do not copy it into this production volume unchanged.

## 3. Run the portal locally

Only bind the application to loopback. It does not need to be directly
reachable from the internet:

```powershell
docker run --name ogii-portal `
  --restart unless-stopped `
  --env-file .env `
  --publish 127.0.0.1:5000:5000 `
  --mount source=ogii-portal-data,target=/app/data `
  smart-college-portal:production
```

Check it locally in another PowerShell window:

```powershell
Invoke-WebRequest http://127.0.0.1:5000/health
Invoke-WebRequest http://127.0.0.1:5000/api/health
```

Open `http://127.0.0.1:5000/` to confirm the portal works before exposing it.

## 4. Install and start Cloudflare Quick Tunnel

Install `cloudflared` from
[Cloudflare's official downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
No Cloudflare account is required for a Quick Tunnel.

Open a second PowerShell window and run:

```powershell
cloudflared tunnel --url http://127.0.0.1:5000
```

Copy the HTTPS URL printed by the command, for example:

```text
https://quiet-moon-example.trycloudflare.com
```

That is the temporary free public URL for the portal. Anyone who has the URL
can access it. For a private demo, use Cloudflare's email restriction:

```powershell
cloudflared tunnel --url http://127.0.0.1:5000 --allowed-mail your@email.com
```

Visitors then receive an email PIN before entering the portal. The URL still
changes when the Quick Tunnel is restarted.

## 5. SQLite backup

Create a consistent backup while the portal is running:

```powershell
docker run --rm --env-file .env `
  --mount source=ogii-portal-data,target=/app/data `
  --mount source=ogii-portal-backups,target=/app/backups `
  -e DATABASE_BACKUP_DIR=/app/backups `
  smart-college-portal:production npm run backup
```

Copy the generated `.sqlite` backup to a separate disk or private storage. Do
not delete the SQLite `-wal` or `-shm` files while the portal is running. The
database remains compatible with the application's WAL-mode `better-sqlite3`
driver.

## Optional: stable free hostname with Tailscale Funnel

If you want a more stable free subdomain than a Quick Tunnel, install
[Tailscale](https://tailscale.com/download), sign in on the PC with a personal
free plan, and enable MagicDNS, HTTPS certificates, and Funnel for the tailnet.
Then run:

```powershell
tailscale funnel 5000
```

Tailscale prints a URL similar to:
`https://your-pc-name.your-tailnet.ts.net/`. This is a free Tailscale
subdomain, not a domain you own. The PC and Docker container still need to stay
online, and Funnel has bandwidth limitations.

## 6. Stop and restart

Stop the tunnel with `Ctrl+C`, then stop the portal when needed:

```powershell
docker stop ogii-portal
```

Restart it with the same `docker run` command. The named volume preserves the
database. Do not run `docker volume rm ogii-portal-data` unless you intentionally
want to destroy this deployment's SQLite data.

## Limitations

- The PC must remain powered on and connected to the internet.
- Quick Tunnel URLs are temporary and have no uptime guarantee.
- There is no custom owned domain in this no-card route.
- The current Docker volume is local; maintain separate backups.
- Do not expose the existing development database containing demo accounts.

Sources: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
and [Cloudflare Quick Tunnel limits](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/).
