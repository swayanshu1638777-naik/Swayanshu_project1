# Free Hosting Plan with SQLite

If Oracle Cloud card verification is not acceptable, use
[NO_CARD_HOSTING.md](NO_CARD_HOSTING.md) instead. The Oracle plan below is for
an always-on cloud VM; the no-card plan runs on your own computer.

## Result of the project audit

The project is a single-origin Node.js application:

- **Frontend:** plain HTML, CSS, and browser JavaScript, including admin,
  teacher, and student pages.
- **Backend:** Node.js 22+, Express, JWT authentication, role-based routes,
  rate limits, Swagger/OpenAPI, and OTP delivery.
- **Database:** `better-sqlite3` at
  `backend/data/college_portal.sqlite`, using WAL mode and foreign keys.
- **Production serving:** the Docker image serves the frontend and API from one
  origin; Caddy reverse-proxies HTTPS traffic to the private Express container.
- **Backups:** the backup service uses SQLite's online backup API and uploads
  timestamped files to S3-compatible object storage.

The D: copy was checked before this guide was written:

- SQLite `PRAGMA integrity_check`: `ok`.
- Database tables: 11 application tables.
- Current local database: 9 users, 5 assessments, 33 attendance rows, and 16
  marks.
- Backend tests: 44 passed, 0 failed.
- The current database contains 5 development demo accounts. Production startup
  deliberately rejects those accounts, so do not upload the current database to
  the public server unchanged.

## Recommended free architecture

Use these services:

1. **Oracle Cloud Always Free VM** for Docker, Express, Caddy, and the SQLite
   volume. Choose an Always Free eligible Ubuntu VM in the account's home
   region. The AMD micro shape is the safest architecture match for the current
   image; the free Ampere ARM shape is also possible after verifying the native
   `better-sqlite3` install.
2. **DuckDNS** for a free hostname such as
   `your-name.duckdns.org`. This is a free subdomain, not a free owned
   top-level domain. If you already own a domain, use its DNS `A` record instead.
3. **Caddy** for automatic HTTPS. The checked-in `Caddyfile` already obtains
   and renews a public certificate when the hostname resolves to the VM and
   ports 80/443 are reachable.
4. **Oracle Object Storage** for off-host SQLite backups. Its S3-compatible
   endpoint works with the existing backup service and is included within the
   Always Free allowance in the home region. Cloudflare R2 is an alternative,
   but it requires its own account and billing setup.
5. **Brevo SMTP** for registration OTP email. Verify one sender address in
   Brevo and use the free SMTP allowance. Resend remains supported if you have
   a verified sending domain.

This keeps SQLite on one persistent disk and runs exactly one portal process.
Do not deploy this application to a free platform with an ephemeral filesystem.
For example, Render documents that free web services lose local SQLite files on
restart, redeploy, or spin-down.

## 1. Create the free VM

Create an Oracle Cloud Free Tier account, select the home region carefully, and
launch an Always Free eligible Ubuntu instance with a public IPv4 address. A
credit/debit card may be required for identity verification; do not upgrade the
account or select paid resources.

In the VM's cloud security list, allow inbound:

| Port | Protocol | Purpose |
| --- | --- | --- |
| 22 | TCP | SSH administration |
| 80 | TCP | HTTP and ACME certificate challenge |
| 443 | TCP | HTTPS |
| 443 | UDP | Optional HTTP/3 |

Do not expose port 5000. Express stays on the private Docker network.

## 2. Point a free hostname at the VM

1. Sign in at [DuckDNS](https://www.duckdns.org/), create a short subdomain,
   and copy the DuckDNS token.
2. Set the subdomain's IPv4 address to the Oracle VM's public IPv4 address.
3. If the VM address changes, update it from the VM with:

```sh
curl "https://www.duckdns.org/update?domains=YOUR_SUBDOMAIN&token=YOUR_DUCKDNS_TOKEN&ip="
```

Use the resulting name as `DOMAIN`, for example
`portal-your-name.duckdns.org`. Confirm it resolves before starting Caddy:

```sh
getent hosts portal-your-name.duckdns.org
```

## 3. Install Docker on Ubuntu

SSH into the VM and run:

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo ${UBUNTU_CODENAME:-$VERSION_CODENAME}) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
```

Log out and back in once so the Docker group is active, then verify:

```sh
docker version
docker compose version
```

## 4. Prepare the project and secrets

```sh
sudo install -d -m 0750 /opt/ogii
sudo chown "$USER":"$USER" /opt/ogii
git clone https://github.com/sbrstark7028416017-source/Swayanshu.git /opt/ogii
cd /opt/ogii
cp deploy/production.env.example .env
chmod 600 .env
```

Edit `/opt/ogii/.env` and replace all placeholders. The important values are:

```dotenv
DOMAIN=YOUR_SUBDOMAIN.duckdns.org
TRUST_PROXY=1
CORS_ORIGIN=https://YOUR_SUBDOMAIN.duckdns.org
JWT_SECRET=GENERATE_A_UNIQUE_RANDOM_VALUE

INITIAL_ADMIN_USERNAME=choose-a-new-admin
INITIAL_ADMIN_EMAIL=your-real-admin-email@example.net
INITIAL_ADMIN_NAME=Portal Administrator
DEFAULT_ADMIN_PASSWORD=unique-password-12-or-more
DEFAULT_TEACHER_PASSWORD=another-unique-password
DEFAULT_STUDENT_PASSWORD=third-unique-password

OTP_DELIVERY_PROVIDER=brevo-smtp
OTP_FROM_EMAIL=the-verified-brevo-sender@example.net
BREVO_SMTP_USER=your-brevo-login-email
BREVO_SMTP_KEY=your-brevo-smtp-key
```

Generate the JWT secret on the VM; do not commit or paste it into chat:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

For Oracle Object Storage backups, create a private bucket and an S3
compatibility/HMAC access key. Set these values using your Oracle namespace and
home region:

```dotenv
S3_ENDPOINT=https://YOUR_NAMESPACE.compat.objectstorage.YOUR_REGION.oraclecloud.com
S3_REGION=YOUR_REGION
S3_BUCKET=your-private-backup-bucket
S3_ACCESS_KEY_ID=your-hmac-access-key
S3_SECRET_ACCESS_KEY=your-hmac-secret
S3_PREFIX=ogii-college-portal
BACKUP_INTERVAL_HOURS=24
BACKUP_RETENTION_DAYS=30
```

The backup bucket must remain private. Keep `.env` out of Git and never put
secrets in the frontend or SQLite database.

## 5. Handle the existing SQLite database safely

The local database passed an integrity check, but it has development demo
accounts. Choose one of these paths before starting production:

### Fresh production database (recommended)

Keep the local database as an offline development copy. The production seed
creates the administrator, Administration department, and academic catalog
options needed by registration:

```sh
docker compose config -q
docker compose build --pull
docker compose run --rm --no-deps portal npm run seed
```

Create real students, teachers, subjects, and assignments through the admin
portal after first login.

### Preserve real records

Do not copy `college_portal.sqlite` while the local backend is running. First
create a consistent backup with `cd backend && npm run backup`, review it, and
remove or replace development demo accounts through a deliberate data migration.
Only migrate a database after it contains no known demo accounts, because the
production startup guard will stop the service otherwise. Keep the original
SQLite file and its WAL/SHM sidecars untouched until the migrated database has
been validated.

SQLite compatibility requirements are already implemented:

- `DATABASE_PATH=/app/data/college_portal.sqlite`.
- `portal-data` is a persistent Docker volume.
- Only one portal container writes to SQLite.
- WAL mode and foreign keys remain enabled.
- The backup service uses SQLite's online backup API.
- Never run `docker compose down -v`; it deletes the database volume.

## 6. Start and verify

After choosing the fresh or migrated database path:

```sh
docker compose up -d
docker compose ps
curl --fail --show-error https://YOUR_SUBDOMAIN.duckdns.org/health
curl --fail --show-error https://YOUR_SUBDOMAIN.duckdns.org/api/health
docker compose logs --tail=100 portal caddy backup-service
```

Open:

- `https://YOUR_SUBDOMAIN.duckdns.org/` — portal
- `https://YOUR_SUBDOMAIN.duckdns.org/login.html` — login
- `https://YOUR_SUBDOMAIN.duckdns.org/api/docs` — API documentation

Caddy will redirect HTTP to HTTPS and persist certificate state in
`caddy-data`. If HTTPS fails, check DNS first, then Oracle ingress rules, then
the VM firewall and `docker compose logs caddy`.

## 7. Updates and recovery

Before an update, confirm that the backup service uploaded a recent SQLite
backup:

```sh
docker compose logs --since=30m backup-service
git pull --ff-only
docker compose config -q
docker compose build --pull
docker compose up -d --remove-orphans
```

Never use `docker compose down -v` for an update. Restore only after stopping
both `portal` and `backup-service`, validating the selected backup with
`PRAGMA integrity_check`, and removing SQLite `-wal`/`-shm` sidecars while no
process is using the database. The full restore procedure is in
[DEPLOYMENT.md](DEPLOYMENT.md).

## Free-service limitations

- DuckDNS gives a free subdomain, not ownership of a custom `.com`/`.in`
  domain.
- Oracle capacity can be temporarily unavailable, and idle Always Free VMs may
  be reclaimed under Oracle's published policy.
- The VM is a single instance; downtime or host loss is possible.
- The off-host backup is required for SQLite data safety.
- Brevo/Resend sender verification and provider limits still apply to OTP mail.

Useful provider references:

- [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [DuckDNS](https://www.duckdns.org/)
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [Render free filesystem limitation](https://render.com/docs/free)
