# Smart College Portal API

The backend is an Express REST API backed by SQLite. In development it serves
APIs and Swagger documentation; the static pages are served separately. The
production container serves the frontend and APIs from one origin.

## Run locally

Use Node.js 22 or newer.

```powershell
Copy-Item .env.example .env
npm install
npm run seed
npm run dev
```

The API listens on port `5000` by default. Swagger UI is at
`http://localhost:5000/api/docs`; OpenAPI JSON is at
`http://localhost:5000/api/openapi.json`. The SQLite file is created at
`data/college_portal.sqlite` by default. Set `DATABASE_PATH` to change it.

For a production container build, see the repository-root `Dockerfile` and
`compose.yaml`; use the root `deploy/production.env.example` as a starting
point for the untracked deployment `.env` file.

Seed users (passwords can be overridden with the corresponding `DEFAULT_*`
variables before running `npm run seed`):

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
`POST /api/auth/verify-otp`. Registration requires an `@ssipmt.com` email and
a six-digit code. In development, the code is written to the backend console.
In production, configure `OTP_DELIVERY_URL` to a trusted HTTPS delivery
webhook. It receives a JSON body with `email`, `phone`, `code`, and
`expiresInMinutes`; optionally configure `OTP_DELIVERY_TOKEN` for bearer
authentication. Registration is disabled in production without a delivery
webhook. OTP values are stored hashed, expire, and are limited to five attempts.

## API areas

- `/api/admin`: department, branch, student, teacher, subject and teaching
  assignment management; `/catalog` returns form lookup data.
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

The default SQLite location is relative to the backend folder. Run tests with:

```powershell
npm test
```
