# PlacementHub

MERN placement-management application with authentication, initial-admin provisioning, profiles, company approval, and Phase 3C profile/review screens. Phase 4B adds opportunity management and student browsing on the Phase 4A APIs. Phase 5B adds student applications and recruiter applicant management. Final dashboards are not implemented.

## Requirements

- Node.js 22.12+ (Node.js 24 recommended) and npm.
- A running local MongoDB instance or a MongoDB Atlas connection string.

## Setup

From the repository root:

```powershell
npm install
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

Set `MONGODB_URI` in `backend/.env` to your database connection string. Set `JWT_SECRET` to a randomly generated value of at least 32 characters; generate one locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Never share or commit the value. The example targets local MongoDB on port 27017. Environment files are ignored by Git. Never place secrets in frontend variables.

## Development

```sh
npm run dev
```

Frontend: http://127.0.0.1:5173. Backend: http://localhost:5000.

Or run in separate terminals:

```sh
npm run dev -w backend
npm run dev -w frontend
```

Vite proxies `/api` requests to the backend. If you change backend `PORT`, update frontend `API_PROXY_TARGET` too. The backend connects to MongoDB before listening and exits on initial connection failure. Node watch mode waits for a file change after an error; restart it after fixing external configuration.

## Checks and builds

- `npm test`: all backend tests, then all frontend tests. Backend tests use disposable MongoDB instances/replica sets; the first run may download a MongoDB binary. Tests never connect to Atlas.
- `npm run lint`: ESLint checks JavaScript and JSX.
- `npm run format:check`: verify Prettier formatting.
- `npm run format`: apply formatting.
- `npm run build`: produce the frontend bundle in `frontend/dist/`.
- `npm run preview -w frontend`: preview that bundle; the development API proxy is not a production deployment configuration.
- `npm start -w backend`: run the backend without file watching.

## Health endpoint

`GET /api/v1/health` returns HTTP 200 with `status: "ok"` and `database: "connected"` when connected. It returns HTTP 503 if the running backend loses its database connection. Initial database connection failure prevents HTTP startup.

## Structure

- `frontend/src/app/`: React application entry component.
- `frontend/src/styles/`: shared styling.
- `backend/src/config/`: environment validation and MongoDB connection.
- `backend/src/app.js`: HTTP application and health endpoint.
- `backend/src/server.js`: startup and graceful shutdown.
- `backend/tests/`: foundation tests.

## Backend authentication

- `POST /api/v1/auth/register`: JSON `name`, `email`, `password`, and optional `role` (`student` by default or `recruiter`). Public admin registration is rejected.
- `POST /api/v1/auth/login`: JSON `email` and `password`.
- Both return a safe `user` object, `accessToken`, `tokenType: "Bearer"`, and `expiresIn: 900`.
- Emails are trimmed and lowercased. Passwords require at least 8 characters and at most 72 UTF-8 bytes; passwords are never trimmed.
- Responses: 400 for invalid input, 409 for duplicate registration, 401 for incorrect credentials. Passwords and hashes are never returned.
- JWTs expire after 15 minutes and are verified with a fixed algorithm, issuer, and audience. Configure `JWT_SECRET` before starting the backend.
- Future protected routes can use `authenticate(tokens)` followed by `authorize('admin')`. Authentication reads the current user role from MongoDB; role middleware returns 403 for insufficient permission.
- The User model supports student, recruiter, and admin. No admin creation endpoint is included.

Authentication code lives in `backend/src/modules/auth/`, the User model in `backend/src/modules/users/`, and reusable middleware in `backend/src/middleware/`.

## Authentication sessions

Registration and login set a `placementhub_refresh` cookie. Refresh tokens are random opaque values; only SHA-256 hashes are stored in MongoDB. The cookie is HTTP-only, host-only, scoped to `/api/v1/auth`, and `SameSite=Strict` by default (configurable for cross-site HTTPS frontends). Set `NODE_ENV=production` for the `Secure` flag and serve over HTTPS. Local development permits HTTP.

- `POST /api/v1/auth/refresh`: send the refresh cookie and `X-CSRF-Protection: 1`. Returns the same JSON shape as login and replaces the refresh cookie. Missing, malformed, expired, revoked, or replayed refresh tokens return 401 and clear the cookie.
- `POST /api/v1/auth/logout`: send the refresh cookie and `X-CSRF-Protection: 1`. Revokes that login session and clears its cookie; returns 204, including when the cookie is missing or already invalid. Other login sessions remain valid. The cookie, not a bearer header, identifies the session to log out.
- `GET /api/v1/auth/me`: send `Authorization: Bearer <accessToken>`. Returns `{ user: { id, name, email, role } }`; missing or invalid credentials return 401.
- Refresh/logout require the protection header. Cross-site requests must also originate from an explicitly configured trusted frontend; other origins return 403. Use the same-origin Vite proxy locally. See [production security configuration](docs/production-security.md).
- Sessions expire 30 days after login; rotation never extends that deadline. A limit of 4,096 rotations bounds stored replay history, after which login is required.
- Each rotation atomically replaces the current hash and retains spent hashes. Reuse of any spent token revokes the whole session, including successor refresh tokens and all associated access tokens. This follows the replay-detection approach in [RFC 9700 §4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2).
- Clients must serialize refresh requests. Concurrent refreshes with the same cookie trigger replay revocation, so do not blindly retry a spent cookie after a lost response; sign in again.
- Authentication checks both the current user and the unexpired, unrevoked session in MongoDB. Logout/replay therefore invalidate access tokens immediately on subsequent requests, despite their remaining 15-minute JWT lifetime. Database failures fail closed.
- Expired session records are removed by a MongoDB TTL index; authorization checks expiry directly without waiting for cleanup. Changing `JWT_SECRET` invalidates access JWTs but does not revoke stored refresh sessions.
- Existing Phase 2A access tokens lack a session identifier and must be replaced by signing in again.

Initial admins are provisioned only through the operator CLI. See [Admin provisioning](docs/admin-provisioning.md) for local PowerShell and production secret-manager workflows. No public admin signup endpoint exists.

## Frontend authentication

- `/login` and `/register` provide sign-in and student/recruiter registration.
- `/account` shows the signed-in user and logout control. `/student/account`, `/recruiter/account`, and `/admin/account` additionally require the matching role; these are account confirmation pages, not dashboards.
- `AuthProvider` in `frontend/src/features/auth/` restores sessions once, including under React Strict Mode, and exposes loading, user, error, and pending-action state.
- `frontend/src/lib/api.js` keeps access tokens only in memory. No tokens are placed in localStorage or sessionStorage; the HTTP-only refresh cookie is managed by the browser.
- Reload restoration and successful login/registration load the current user through `GET /api/v1/auth/me`. Protected requests use `authClient.request('/path')`, refresh on 401, and retry once. A 403 does not trigger refresh.
- Refresh requests are coalesced per tab. Cookie-changing requests are serialized with Web Locks across tabs where supported; browsers without Web Locks should use a single active tab. BroadcastChannel clears other tabs after login or logout where supported.
- Failed or uncertain refreshes require sign-in instead of automatic repeated attempts. A failed logout remains visible as unconfirmed and can be retried.
- Use the frontend origin for all auth requests through the Vite `/api` proxy. Production hosting must route `/api` to the backend and return `index.html` for frontend deep links; serve over HTTPS.
- Frontend route guards are a navigation aid; backend authentication and role checks remain authoritative.

Run `npm run lint -w frontend`, `npm test -w frontend`, and `npm run build -w frontend`. Use `npm run test:watch -w frontend` during development. The frontend suite uses Vitest, React Testing Library, and mocked HTTP responses to cover routes, form validation, session restoration, refresh races, and logout failures.

## Profile APIs

Authenticated students and recruiters can read and update their own profile drafts. See [Profile API documentation](docs/profiles.md) for endpoints, field limits, ownership rules, and examples. The frontend uses these APIs for role-protected profile viewing and editing.

## Company approval

Admins can review pending recruiter/company profiles and approve or reject a specific profile version. Recruiters can view status and rejection reasons; edits trigger re-review. See [Company approval](docs/company-approval.md) for endpoints, concurrency rules, and audit behavior.

## Profile and company review screens

- Students: open **My profile** at `/student/profile` to create, view, edit, or clear profile fields.
- Recruiters: open **Company profile** at `/recruiter/profile` to manage company details and see approval status and review notes. Saving changed details returns the company to pending review.
- Admins: open **Company reviews** at `/admin/companies`. The paginated pending list links to `/admin/companies/:id`, with company details, review history, and approve/reject actions. Rejection requires a reason visible to the recruiter.
- Failed review decisions require reloading details before retrying; submissions include the reviewed profile version to detect concurrent changes.
- Empty profiles, empty review queues, loading, validation, save success, and retry states are included. Backend authorization remains authoritative. No dashboards or opportunity features are included.

Frontend components live in `frontend/src/features/profiles/` and `frontend/src/features/companies/`. Run `npm test -w frontend`, `npm run lint -w frontend`, and `npm run build -w frontend`. Tests cover editable-field payloads, role restrictions, review decisions, pagination, and stale review recovery.

## Opportunities / jobs

Recruiters can create and manage their own company’s drafts and publish opportunities after company approval. Students can list and read current published opportunities; expired records and publications for unapproved or changed company profiles are hidden. See [Opportunities API](docs/opportunities.md) for routes, fields, pagination, and publishing rules. No application endpoints are included.

## Opportunity screens (Phase 4B)

- Recruiters: `/recruiter/opportunities` lists owned records. Create at `/recruiter/opportunities/new` or edit at `/recruiter/opportunities/:id/edit`. Publishing and unpublishing are separate controls on the edit page.
- Students: `/student/opportunities` lists current opportunities with pagination; `/student/opportunities/:id` shows company, compensation, deadline, description, and eligibility.
- The Opportunities navigation link is shown only for students and recruiters. Backend ownership and authorization remain authoritative.
- Deadlines are entered and displayed in local time, sent to the API as UTC timestamps. Draft, published, expired, and hidden publication states are distinguished. Company edits require reapproval and explicit republication.
- Save or discard edits before changing publication state. Failed or uncertain publish actions require a reload; check the owned list before retrying an uncertain create request. Saving content returns a publication to draft.
- Tests cover payload types, date conversion, role guards, pagination, validation, approval restrictions, and recovery. Run `npm test -w frontend`, `npm run lint -w frontend`, and `npm run build -w frontend`. Browser verification uses an isolated temporary database.

No applications, apply actions, or final dashboards are included.

## Eligibility and opportunity filters (Phase 4C)

Student opportunity cards and details show eligible, not eligible, or incomplete profile, with field-specific reasons. Browse by job type, location, eligibility, and search text. Evaluation uses the current authenticated student profile and is reusable for future application checks. See [Eligibility and filters](docs/eligibility.md) for rules, API parameters, pagination behavior, and availability handling. No application functionality is included.

## Backend applications (Phase 5A)

Students can apply once to a visible, unexpired opportunity when their current profile is eligible. Recruiters can list their company’s applications and move them through audited, forward-only statuses. See [Applications API](docs/applications.md) for endpoints, transitions, errors, snapshot behavior, and the MongoDB replica-set requirement. No application frontend or dashboards are included.

## Applications UI (Phase 5B)

- Eligible students can apply from opportunity details. Submission is disabled while checking existing applications, for ineligible/incomplete profiles, and after an application is found. Expired or unavailable details offer no apply control. The backend remains authoritative at submission time.
- `/student/applications` lists submitted titles, companies, dates, current statuses, and history from immutable submission snapshots.
- `/recruiter/applications` lists company applicants with student snapshot data. Use **View applicants** on an owned opportunity to filter by `opportunityId`.
- Recruiter controls expose only legal next states, send `expectedVersion`, and require refreshing the list after conflicts or unconfirmed updates. Terminal selected/rejected applications have no status controls.
- Failed or uncertain submissions link to My Applications; check the list before retrying. Existing-application checks traverse the paginated student API without adding backend endpoints.
- Role-aware navigation, pagination, loading, empty, error, success and responsive states are included. Run `npm test -w frontend`, `npm run lint -w frontend`, and `npm run build -w frontend`. Browser checks use a disposable replica set.

No Phase 5C hardening or final dashboards are included.

## Application hardening (Phase 5C)

Apply recovery refreshes availability, eligibility, and existing applications together. Recruiter conflicts offer an explicit reload, and late update responses cannot overwrite reloaded cards. See [Application verification](docs/applications-verification.md) for regression coverage and disposable-database end-to-end checks.
