# Smart College Portal

The SSIPMT campus portal is a static frontend backed by the Express/SQLite API
in `backend/`. Use Node.js 22 or newer. In a PowerShell terminal at the project
root, initialize the development environment without replacing an existing
`.env` file, then start the API:

```powershell
Set-Location backend
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm install
npm run seed
npm run dev
```

`npm run seed` is insert-only: it adds missing development reference/demo data
but does not overwrite existing users or other records. It is optional if you
already have the college's data in the database. The default SQLite file is
`backend/data/college_portal.sqlite`; never delete it or its WAL/SHM sidecars as
a troubleshooting step.

In a second terminal, serve the frontend on loopback:

```powershell
Set-Location backend
npm run frontend
```

Open `http://127.0.0.1:5501`. The development frontend uses the API at
`http://localhost:5000`; configure `COLLEGE_PORTAL_API_BASE` in the browser
console or `collegePortalApiBase` in local storage only if your API uses a
different URL. The frontend server exposes only portal pages and the `css/`,
`js/`, and `assets/` directories, not the backend or database files.
Requests for paths outside that allowlist (including SQLite database paths)
return 404 by design. The browser must use the authenticated REST API for all
database operations.

The backend test suite runs with `npm test` from `backend/`. GitHub Actions
runs this suite for backend changes and pull requests.

## Production image

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full Linux VPS setup, first backup,
restore rehearsal, and update procedure.

For a free SQLite-compatible deployment, follow
[FREE_HOSTING_SQLITE.md](FREE_HOSTING_SQLITE.md). It uses an Oracle Cloud
Always Free VM, a free DuckDNS subdomain, persistent Docker volumes, and Caddy
HTTPS. A free Render web service is not suitable for this project because its
local filesystem is ephemeral and would erase SQLite data on restart.

If you cannot provide a cloud-card verification method, use
[NO_CARD_HOSTING.md](NO_CARD_HOSTING.md) for a Cloudflare Quick Tunnel from
this Windows machine. It keeps SQLite local and gives a temporary free
`trycloudflare.com` URL.

The production image serves the portal and API from one origin. Caddy is the
only public service; it obtains and renews HTTPS certificates and reverse
proxies to Express on the private Compose network. SQLite remains at
`/app/data/college_portal.sqlite` on the persistent `portal-data` volume. Do not
scale the portal service to multiple instances; SQLite is local storage.

```powershell
if (-not (Test-Path .env)) { Copy-Item deploy/production.env.example .env }
# Edit .env locally; do not commit it. Set every CHANGE_ME value and the actual domain.
docker compose config -q
docker compose build --pull
docker compose run --rm --no-deps portal npm run seed
docker compose up -d
```

Configure DNS to point `DOMAIN` at the host and allow inbound TCP 80/443 and
UDP 443. Caddy stores certificates and state in `caddy-data` and `caddy-config`.
Replace `portal.example.com` in the template with your domain and make
`CORS_ORIGIN` exactly `https://<DOMAIN>`. `TRUST_PROXY=1` is required for, and
must only be used with, this single Caddy proxy topology. Compose fails early
when required deployment values are missing. Keep `.env` on the host with
restricted permissions and provide credentials through a secrets manager when
available. Generate the JWT secret with
`node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.

The container does not seed data at startup. For a new deployment, seed once
after setting production environment values. Production seeding creates only
the configured initial admin, academic catalog options, and Administration
department; it does not seed demo data. Use a clean production volume: startup rejects the known development
demo accounts. Existing accounts are not overwritten by later seed runs. All
three `DEFAULT_*_PASSWORD` values must be distinct, 12–72 UTF-8 bytes; set the
admin password securely and change any remaining bootstrap credentials before
creating those accounts.

### OTP Email

Production Compose supports Resend or Brevo SMTP. For Resend, verify the
sending domain and set `OTP_DELIVERY_PROVIDER=resend`, `RESEND_API_KEY`, and
`OTP_FROM_EMAIL` in the untracked root `.env`. For Brevo, verify a sender and
set `OTP_DELIVERY_PROVIDER=brevo-smtp`, `BREVO_SMTP_USER`, `BREVO_SMTP_KEY`,
and `OTP_FROM_EMAIL`. The backend sends the one-time code by email; SMS is not
configured. For non-Compose integrations, the backend also retains its HTTPS
webhook adapter using `OTP_DELIVERY_PROVIDER=webhook`, `OTP_DELIVERY_URL`, and
optional `OTP_DELIVERY_TOKEN`.

Student self-registration requires positive department, branch, semester, and
section IDs from the college catalog. The read-only `/api/catalog` endpoint
provides only those academic lookup fields without requiring sign-in. OTP
delivery follows the backend configuration: development codes are written to
the backend console when no provider is selected; email providers (Resend,
Brevo SMTP, or the HTTPS webhook) send real messages. Production deployments
must configure a supported delivery provider. `OTP_EXPIRY_MINUTES` accepts
integers from 1 to 60 and defaults to 10. SMS delivery is not implemented.

Administrators can manage departments, branches, semesters, sections, and
subjects from the reference-data pages. Signed-in users can change their
password from the expandable Account security panel on portal pages. Admins
must set an initial password when creating a student or teacher account; blank
passwords are not replaced with a shared default. Newly created or changed
passwords must be at least 8 characters and are limited to bcrypt's 72-byte
UTF-8 input to prevent silent truncation. Login continues to verify existing
accounts created with longer passwords.

Administrators can also open **Data Management** from the admin sidebar to
browse students, teachers, academic reference data, assignments, attendance,
assessments, and marks. Lists support search/filtering and pagination, with
record details and controlled editing. CSV export is available for selected
rows on the current page or all records matching the current filters. Student
and teacher records are deactivated rather than hard-deleted; deleting an
assessment also deletes its marks, while attendance and individual marks may
be deleted after confirmation. All data stays behind the authenticated API.

Create a consistent SQLite backup while the backend is running with
`cd backend; npm run backup`. Backups are written to `backend/data/backups` by
default; set `DATABASE_BACKUP_DIR` to choose another directory. Store copies
outside the host/container and periodically test restoring one. Compose runs a
dedicated backup service: it makes an online-consistent SQLite backup on start
and every `BACKUP_INTERVAL_HOURS` (default 24), saves it on the persistent
`portal-backups` volume, uploads it to an S3-compatible bucket, and removes
local and remote generated backups older than `BACKUP_RETENTION_DAYS` (default
30). For Backblaze B2, set its S3 endpoint, region, bucket, and a restricted
application key in `.env`. The key needs list, upload, and delete permission for
the configured bucket/prefix. Keep the bucket private. The off-host copy
protects against host loss; the local backup volume is not an off-host backup.

### Restore

Use AWS CLI or an S3-compatible client configured with the backup credentials
to download the chosen object from the bucket to the deployment host. For
example:

```sh
aws --profile portal-backups s3 cp "s3://<bucket>/<prefix>/<backup-file>.sqlite" ./restore.sqlite \
	--endpoint-url "https://s3.<region>.backblazeb2.com" --region "<region>"
docker compose stop portal backup-service
docker compose run --rm --no-deps portal npm run backup
docker compose cp portal:/app/backups ./pre-restore-backups
docker compose cp ./restore.sqlite portal:/app/backups/restore.sqlite
docker compose run --rm --no-deps --entrypoint node portal -e "const D=require('better-sqlite3');const fs=require('node:fs');const db=new D('/app/backups/restore.sqlite',{readonly:true});const result=db.pragma('integrity_check',{simple:true});db.close();if(result!=='ok')process.exit(1);fs.rmSync('/app/data/college_portal.sqlite-wal',{force:true});fs.rmSync('/app/data/college_portal.sqlite-shm',{force:true});fs.copyFileSync('/app/backups/restore.sqlite','/app/data/college_portal.sqlite')"
docker compose up -d
```

Configure the AWS CLI profile outside the repository with the restricted S3
credentials before downloading. Replace the bucket, prefix, object name,
endpoint, and region placeholders. After restart, verify the portal health
endpoint and representative user/data flows. Periodically rehearse restore to a
separate test volume. Keep the pre-restore snapshot until records have been
checked. Never use
`docker compose down -v` for routine deployments; it removes the persistent
database, backup, and Caddy volumes.

The landing page's Living Green scene uses local Three.js and its companion
assets under `assets/inner-green-assets/`.
