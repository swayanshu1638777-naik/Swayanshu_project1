# Smart College Portal API

The backend is an Express REST API backed by SQLite. In development it serves
APIs and Swagger documentation; run `npm run frontend` in a second terminal to
serve the portal pages separately. The production container serves the
frontend and APIs from one origin.

## Run locally

Use Node.js 22 or newer.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm install
npm run seed
npm run dev
```

The API listens on port `5000` by default. Swagger UI is at
`http://localhost:5000/api/docs`; OpenAPI JSON is at
`http://localhost:5000/api/openapi.json`. The SQLite file is created at
`data/college_portal.sqlite` by default. Set `DATABASE_PATH` to change it.
In a second terminal from `backend/`, run `npm run frontend` and open
`http://127.0.0.1:5501`. The frontend server is loopback-only and serves portal
HTML, CSS, JavaScript, and local assets, not backend files or database data.

`npm run seed` is optional for an existing college database. It is insert-only:
it adds missing development/demo data and never overwrites or deletes existing
accounts or records. Do not delete the SQLite file or its `-wal`/`-shm`
sidecars to troubleshoot the database.

For a production container build, see the repository-root `Dockerfile` and
`compose.yaml`; use the root `deploy/production.env.example` as a starting
point for the untracked deployment `.env` file.

Seed users (passwords can be overridden with the corresponding `DEFAULT_*`
variables before running `npm run seed`; seed passwords must be at least 8
characters and no more than 72 UTF-8 bytes):

| Role | Login | Default password |
| --- | --- | --- |
| Admin | `admin@ssipmt.com` | `admin123` |
| Teacher | `prof.sharma@ssipmt.com` | `teacher123` |
| Student | `101` or `rahul@ssipmt.com` | `student123` |

These are development/demo credentials. Do not expose them in production.
Seeding is explicit and idempotent; it does not overwrite existing records.

## Authentication

Sign in with `POST /api/auth/login` and send the returned JWT on protected
requests as `Authorization: Bearer <token>`. The `identity` field accepts a
username, email, or student roll number. `GET /api/auth/me` returns the signed-in
profile. Roles are `Admin`, `Teacher`, and `Student`; APIs enforce role and class
assignment boundaries. Authenticated users can change their password through
`POST /api/auth/change-password` by providing `current_password` and
`new_password`.

Student signup uses `POST /api/auth/register` followed by
`POST /api/auth/verify-otp`. Registration accepts any valid email address and
requires a six-digit code. `GET /api/catalog` is public and returns the academic
department, branch, semester, and section lookup lists used by registration;
it does not expose user records. In development, the code is written to the backend console.
Public signup creates student accounts only. Administrators create teacher
accounts from the authenticated Admin → Teachers page (`POST /api/admin/teachers`);
there is no public teacher or administrator signup. The initial production
administrator is provisioned during setup with `INITIAL_ADMIN_USERNAME`,
`INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_NAME`, and `DEFAULT_ADMIN_PASSWORD`, then
created by running `npm run seed` as described in the deployment guide.
Production Compose supports Resend using `OTP_DELIVERY_PROVIDER=resend`,
`RESEND_API_KEY`, and `OTP_FROM_EMAIL` on a verified sending domain, or Brevo
SMTP using `OTP_DELIVERY_PROVIDER=brevo-smtp`, `BREVO_SMTP_USER`,
`BREVO_SMTP_KEY`, and `OTP_FROM_EMAIL` configured for a verified sender. The
existing custom HTTPS webhook remains available with
`OTP_DELIVERY_PROVIDER=webhook`, `OTP_DELIVERY_URL`, and optional
`OTP_DELIVERY_TOKEN`. OTP values are stored
hashed, expire, and are limited to five attempts. Login, registration, and OTP
verification requests are additionally rate-limited by client IP. When running
behind the Compose Caddy service set `TRUST_PROXY=1`; only do this when exactly
one trusted proxy is in front of Express.
Set `OTP_EXPIRY_MINUTES` to an integer from 1 to 60; it defaults to 10. In
development, leaving the provider unset logs codes to the
backend console; configuring a provider sends real email.

Administrators must provide a password when creating a student or teacher;
the API does not assign shared fallback credentials. New password input is used
verbatim, including leading or trailing spaces, requires at least 8 characters,
and is limited to 72 UTF-8 bytes to avoid bcrypt truncation. Login continues to
verify legacy accounts created before that byte limit was enforced.

## API areas

- `/api/admin`: department, branch, student, teacher, subject and teaching
  assignment management; `/catalog` returns form lookup data.
- `/api/admin/data`: administrator-only database record counts, searchable and
  filterable paginated lists, individual record details, validated updates,
  appropriate academic-record deletion, and filtered CSV export. Available
  resources are students, teachers, departments, branches, semesters, sections,
  subjects, assignments, attendance, assessments, and marks. The public
  `/api/catalog` endpoint exposes only academic lookup fields needed by student
  registration.
- `/api/assignments`: role-scoped class assignments and student rosters.
- `/api/attendance`: attendance queries and bulk upsert for a class/date.
- `/api/assessments` and `/api/marks`: create assessments, enter marks, and
  retrieve role-scoped academic records.
- `/api/profile`: student profile read/update.
- `/api/dashboard`: role-specific dashboard data; admin-only
  `/reports/attendance` and `/reports/performance` support thresholds and
  optional `branch_id`.
- `/health` and `/api/health`: liveness checks.

All list endpoints return JSON. Admin student listing supports `q`, `branch_id`,
`semester_id`, `page`, and `limit`; page size is capped at 100. Mutations return
validation errors with a 4xx status, and uniqueness/foreign-key conflicts return
409.

## Configuration and checks

Before production, set a unique, random `JWT_SECRET` of at least 32 characters
and a comma-separated `CORS_ORIGIN` list containing only trusted HTTPS origins
(no wildcard or URL paths). Production seeding also requires distinct
`DEFAULT_ADMIN_PASSWORD`, `DEFAULT_TEACHER_PASSWORD`, and
`DEFAULT_STUDENT_PASSWORD` values of 12 to 72 UTF-8 bytes each. Startup and
seeding fail before opening the database if these requirements are not met.

The seed is still insert-only: it does not rotate or replace passwords on
accounts already present in an existing database. Rotate existing accounts
through the application’s password-change flow before production use. Do not
commit `.env` or production secrets; configure them in the deployment platform.

The default SQLite location is relative to the backend folder. Production
Compose mounts `/app/data` on `portal-data`; this volume survives container
recreation and must not be removed during routine updates. Run tests with:

```powershell
npm test
```

Create a consistent online SQLite backup using SQLite's backup API:

```powershell
npm run backup
```

By default this creates a timestamped file in `data/backups/` under the backend
directory. The production Compose backup service uses the same SQLite backup
API, writes to persistent `/app/backups`, uploads to the configured S3-compatible
bucket, and applies `BACKUP_RETENTION_DAYS` to local and remote copies. It runs
immediately and repeats every `BACKUP_INTERVAL_HOURS`. Use a private bucket and
restricted credentials with list/upload/delete access. Download an object with
an S3-compatible client, stop both `portal` and `backup-service`, verify
`PRAGMA integrity_check`, then replace `/app/data/college_portal.sqlite` and
restart. The project README documents the full Compose restore command. Store
off-host copies and periodically rehearse restoring to a test volume. Never
serve or expose the SQLite file itself.

For local recovery, first stop the backend cleanly and make a separate copy of
the database directory. Prefer `npm run backup` while the backend is running
for a consistent backup. Do not manually remove or replace the database or
WAL/SHM files while SQLite may be using them; follow the documented restore
procedure only after verifying a backup and stopping all database clients.
