# PlacementHub

MERN placement-management application with the Phase 1 foundation and Phase 2A backend authentication. Frontend authentication and business features are not implemented.

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

- `npm test`: backend configuration, health, and authentication tests using Node's test runner. Authentication tests start an isolated temporary MongoDB via `mongodb-memory-server`; the first run may download a MongoDB binary. Tests never connect to Atlas.
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
- The User model supports student, recruiter, and admin. No admin creation endpoint, refresh tokens, logout, or frontend authentication is included.

Authentication code lives in `backend/src/modules/auth/`, the User model in `backend/src/modules/users/`, and reusable middleware in `backend/src/middleware/`.
