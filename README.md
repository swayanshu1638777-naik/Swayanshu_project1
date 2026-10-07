# Smart College Portal

Open `index.html` to explore the SSIPMT campus portal. The static portal pages
connect to the REST API in `backend/`; serve this folder over HTTP and start
the backend at `http://localhost:5000` before signing in.

To start the backend from this repository:

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run seed
npm run dev
```

The backend test suite runs with `npm test` from `backend/`. GitHub Actions
runs this suite for backend changes and pull requests.

## Production image

The production image serves the static portal and API from the same origin and
stores SQLite under the persistent `/app/data` volume. Build and start it with
Docker Compose:

```powershell
Copy-Item deploy/production.env.example .env
# Replace every CHANGE_ME value with unique production values before launch.
docker compose build
docker compose up -d
```

The checked-in environment template is deliberately nonfunctional. Configure
the production frontend's HTTPS origin, a random JWT secret (at least 32
characters), three distinct passwords (12–72 UTF-8 bytes), and an HTTPS OTP
delivery webhook. Generate the JWT secret with
`node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
SQLite backups and HTTPS termination must be handled by the
deployment host or its reverse proxy. `OTP_DELIVERY_TOKEN` is optional if the
provider does not require authentication. Demo seed accounts are development-only;
the seed script refuses default demo passwords in production.

The container does not seed data at startup. For a new deployment, seed once
after setting the production environment with
`docker compose run --rm portal npm run seed`. Production seeding creates only
the configured initial admin and an Administration department—it never inserts
demo students, teachers, marks, or attendance. Configure
`INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_EMAIL`, and `INITIAL_ADMIN_NAME` in
`.env`, then provision remaining accounts through the admin portal. Existing
accounts are not overwritten; production startup refuses a database containing
the known development demo accounts. The container binds to `127.0.0.1` on the
host; put an HTTPS reverse proxy in front of it.

The frontend API base defaults to `http://localhost:5000/api`. Override it by
setting `window.COLLEGE_PORTAL_API_BASE` before `js/portal.js` loads, by saving
`collegePortalApiBase` in local storage. API endpoints are not configurable
through page URLs. Authenticated pages retain the JWT in browser local storage,
verify the current user and role, and redirect to the appropriate dashboard
when the session is missing or invalid.

Student self-registration requires positive department, branch, semester, and
section IDs provided by the college. The backend currently protects its
catalog lookup endpoint for administrators and does not expose public
registration lookup data. OTP delivery follows the backend configuration:
the development code is written to the backend console, while deployments
must configure an OTP delivery provider.

Administrators can manage departments, branches, semesters, sections, and
subjects from the reference-data pages. Signed-in users can change their
password from the expandable Account security panel on portal pages.

The landing page's full-screen temple world is rendered locally from
`assets/temple/temple-world.html` and its companion Three.js assets.