# Production Deployment Runbook

This runbook deploys the portal to one Ubuntu Linux VPS. Express serves the site and API privately inside Docker Compose; Caddy is the only public web service and terminates HTTPS. SQLite remains on a named Docker volume. Do not run multiple portal replicas.

## 1. Prepare the VPS

Create a supported Ubuntu VPS with a static public IP and SSH access. Point the domain's `A` record to that address. Add an `AAAA` record only if the VPS has working public IPv6. Wait for DNS to resolve before starting Caddy.

Install Docker Engine and the Compose plugin from Docker's official Ubuntu repository:

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git awscli
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo ${UBUNTU_CODENAME:-$VERSION_CODENAME}) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

Allow SSH before enabling the firewall, then permit HTTP/HTTPS and HTTP/3:

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
sudo ufw status
```

Do not publish port 5000 or expose the Docker daemon publicly.

## 2. Prepare Providers and Secrets

In Resend, add and verify the sending domain. Publish the DNS records Resend requires and wait until the dashboard reports the domain as verified. The `OTP_FROM_EMAIL` address must use that verified domain.

Create a private S3-compatible backup bucket. For Backblaze B2, create an application key restricted to that bucket with list, upload, and delete permissions. Record the bucket's S3 endpoint and region. Retention needs delete permission. Configure the AWS CLI outside the repository for backup verification and restore downloads, then restrict its credentials file:

```sh
aws configure --profile portal-backups
chmod 600 "$HOME/.aws/credentials"
```

Enter the restricted S3-compatible access key and secret at the CLI prompts. Keep this credentials file and the project `.env` out of source control.

Clone the repository onto the VPS, then create the untracked deployment environment file:

```sh
sudo install -d -m 0750 /opt/smart-college
sudo chown "$USER":"$USER" /opt/smart-college
cd /opt/smart-college
git clone "YOUR_REPOSITORY_URL" .
cp deploy/production.env.example .env
chmod 600 .env
```

Edit `.env` using a secure editor or secret manager. Replace every `CHANGE_ME` value and set:

- `DOMAIN` to the DNS name, and `CORS_ORIGIN` to exactly `https://<DOMAIN>`.
- `TRUST_PROXY=1`; the Compose topology has one trusted proxy, Caddy.
- A unique random `JWT_SECRET` of at least 32 characters. Generate one with `openssl rand -base64 48`; do not paste it into chat, source files, or shell history.
- Three distinct `DEFAULT_*_PASSWORD` values, each 12 to 72 UTF-8 bytes. Keep bootstrap passwords in a secret manager and change any bootstrap account password before use.
- `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_EMAIL`, and `INITIAL_ADMIN_NAME` for the first production administrator.
- The verified `OTP_FROM_EMAIL` and Resend `RESEND_API_KEY`.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`; keep the bucket private.
- `BACKUP_INTERVAL_HOURS` and `BACKUP_RETENTION_DAYS` if the defaults (24 hours and 30 days) are not appropriate.

Compose rejects missing or empty required variables. Application startup also rejects placeholder JWT/admin/OTP values, insecure CORS origins, non-distinct seed passwords, and invalid proxy configuration. Never commit `.env`.

## 3. Validate, Build, and Seed

Before deploying, confirm the approved revision has passed the project's CI tests (`npm ci` followed by `npm test` in `backend/`). The VPS does not need Node installed: the Dockerfile performs a lockfile-based `npm ci` while building. Then validate Compose and build the image:

```sh
cd /opt/smart-college
docker compose config -q
docker compose build --pull
```

For a **fresh deployment only**, initialize the persistent SQLite volume with the configured production administrator:

```sh
docker compose run --rm --no-deps portal npm run seed
```

Production seeding creates the initial administrator and Administration department only. It does not seed demo students, teachers, attendance, or marks. Do not use the local demo database for production; startup rejects known demo accounts. Seeding is insert-only and does not rotate existing passwords.

## 4. Start and Check HTTPS

```sh
docker compose up -d
docker compose ps
curl --fail --show-error "https://YOUR_DOMAIN/health"
curl --fail --show-error "https://YOUR_DOMAIN/api/health"
docker compose logs --tail=100 portal caddy backup-service
```

The portal has a container health check against `/health`. Caddy obtains and renews the certificate automatically after DNS and firewall checks pass. Only Caddy publishes ports 80/443; the Express API is reachable publicly through Caddy at `https://<DOMAIN>/api` and has no host port mapping. The named volumes `portal-data`, `portal-backups`, `caddy-data`, and `caddy-config` persist independently across container recreation.

## 5. Verify the First Backup

The backup service waits for portal health, makes a consistent SQLite backup immediately, uploads it to the configured S3-compatible bucket, then repeats on its schedule. Check the service log for `Database backup uploaded` and list the remote prefix with an S3-compatible client configured from the secret manager:

```sh
docker compose logs --since=30m backup-service
aws --profile portal-backups s3 ls "s3://YOUR_BUCKET/YOUR_PREFIX/" \
  --endpoint-url "https://s3.YOUR_REGION.backblazeb2.com" --region "YOUR_REGION"
```

Confirm a recent `college_portal-<UTC timestamp>.sqlite` object exists. The backup service uses SQLite's online backup API, retains local copies on the `portal-backups` volume, and prunes generated local and remote backups older than `BACKUP_RETENTION_DAYS`. If upload fails, it logs the failure and retains the new local backup; configure monitoring for backup-service errors. Copy backups off-host by keeping the S3 bucket outside the VPS.

## 6. Rehearse a Restore Without Touching Live Data

Download a recent backup from the private bucket to the VPS using the configured S3-compatible client:

```sh
aws --profile portal-backups s3 cp "s3://YOUR_BUCKET/YOUR_PREFIX/YOUR_BACKUP_FILE.sqlite" /tmp/restore-test.sqlite \
  --endpoint-url "https://s3.YOUR_REGION.backblazeb2.com" --region "YOUR_REGION"
```

Create a disposable Docker volume and use the production image's SQLite driver to restore and verify the copy in isolation:

```sh
docker volume create portal-restore-test
docker run --rm --network none \
  --mount source=portal-restore-test,target=/restore \
  --mount type=bind,src=/tmp/restore-test.sqlite,dst=/tmp/restore.sqlite,readonly \
  smart-college-portal:production node -e "const fs=require('node:fs');const D=require('better-sqlite3');fs.copyFileSync('/tmp/restore.sqlite','/restore/college_portal.sqlite');const db=new D('/restore/college_portal.sqlite',{readonly:true});const result=db.pragma('integrity_check',{simple:true});const users=db.prepare('SELECT count(*) AS count FROM users').get().count;db.close();console.log({integrity:result,users});if(result!=='ok')process.exit(1)"
docker volume rm portal-restore-test
rm /tmp/restore-test.sqlite
```

Confirm `integrity: 'ok'` and a plausible user count. This rehearsal does not mount or modify the live `portal-data` volume. For an actual recovery, use the WAL-safe steps in the next section.

## Actual Restore

Download the selected remote object to `./restore.sqlite`, then stop both services that access SQLite. Preserve the current database and validate the restored backup before replacing the live file:

```sh
aws --profile portal-backups s3 cp "s3://YOUR_BUCKET/YOUR_PREFIX/YOUR_BACKUP_FILE.sqlite" ./restore.sqlite \
  --endpoint-url "https://s3.YOUR_REGION.backblazeb2.com" --region "YOUR_REGION"
```

```sh
docker compose stop backup-service portal
docker compose run --rm --no-deps portal npm run backup
docker compose cp portal:/app/backups ./pre-restore-backups
docker compose cp ./restore.sqlite portal:/app/backups/restore.sqlite
docker compose run --rm --no-deps --entrypoint node portal -e "const fs=require('node:fs');const D=require('better-sqlite3');const source='/app/backups/restore.sqlite';const check=new D(source,{readonly:true});const result=check.pragma('integrity_check',{simple:true});check.close();if(result!=='ok')throw new Error('Backup failed SQLite integrity check');fs.rmSync('/app/data/college_portal.sqlite-wal',{force:true});fs.rmSync('/app/data/college_portal.sqlite-shm',{force:true});fs.copyFileSync(source,'/app/data/college_portal.sqlite')"
docker compose up -d
curl --fail --show-error "https://YOUR_DOMAIN/health"
curl --fail --show-error "https://YOUR_DOMAIN/api/health"
```

Keep `./pre-restore-backups` until data checks pass. The pre-restore snapshot uses SQLite's backup API and includes committed WAL data. Remove SQLite `-wal` and `-shm` sidecars only while both portal and backup service are stopped. After restart, sign in and verify representative records.

## 7. Update Without Data Loss

Before each update, confirm a recent remote backup exists. Fetch the approved revision and run tests, then rebuild and recreate services in place:

```sh
cd /opt/smart-college
git fetch --all
git checkout "YOUR_APPROVED_REVISION"
docker compose config -q
docker compose build --pull
docker compose up -d --remove-orphans
docker compose ps
curl --fail --show-error "https://YOUR_DOMAIN/health"
```

Ordinary `docker compose up -d` preserves named volumes. **Never run `docker compose down -v` for an update or routine restart.** The `-v` option deletes SQLite data, local backups, and Caddy certificate state. Keep off-host backups and test restores regularly.
