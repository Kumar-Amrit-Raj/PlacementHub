# PlacementHub

Phase 1 foundation for a MERN placement-management application. Authentication and business features are not implemented.

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

Set `MONGODB_URI` in `backend/.env` to your database connection string. The example targets local MongoDB on port 27017. Environment files are ignored by Git. Never place secrets in frontend variables.

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

- `npm test`: backend configuration and HTTP health tests using Node's test runner; these isolate readiness and do not require MongoDB.
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

Feature directories will be added when their implementation begins.
