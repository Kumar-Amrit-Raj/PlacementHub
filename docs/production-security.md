# Production security configuration

Phase 6A prepares configuration; it does not deploy the application.

## Origins and refresh cookies

Set backend `CORS_ALLOWED_ORIGINS` to comma-separated exact frontend origins, without trailing slashes, paths, credentials, or wildcards. Production origins must use HTTPS. The default empty list permits same-origin requests only; requests without an Origin header remain available to API clients. The Vite proxy preserves the browser host for same-origin development.

For a separately hosted frontend, set public build-time `VITE_API_BASE_URL` to the backend origin (without `/api/v1`) and rebuild. Credentials remain included in requests; access tokens stay in memory. Neither example environment file contains secrets.

Refresh cookies remain HTTP-only and host-only. Production enables Secure. Keep `REFRESH_COOKIE_SAME_SITE=strict` for same-site hosting, or use `none` for cross-site HTTPS hosting with an explicit allowed-origin list. Browsers may still block third-party cookies; same-site frontend/API domains avoid that limitation. Refresh/logout require `X-CSRF-Protection: 1`; trusted cross-site requests are supported through credentialed preflights.

## Request protection and errors

Helmet supplies default security headers. Per-process IP limits are 300 API requests/minute, 60 auth requests/15 minutes, and a shared 10 login/register attempts/15 minutes. Responses use 429 with Retry-After. Counters reset on process restart and are not shared across replicas; no distributed store is introduced here.

Leave `TRUST_PROXY_HOPS=0` for direct connections. Set the exact hop count only behind trusted proxies that overwrite forwarding headers and prevent direct backend access. Different-length ingress paths need a reviewed proxy configuration before deployment.

Unexpected errors return a generic 500. Server logs include method, route template and stack frames, excluding error messages, raw URLs/query parameters, bodies, cookies and headers. Expected validation/authentication errors retain their existing responses.

## Startup and application checks

The server awaits User, AuthSession, StudentProfile, RecruiterProfile, Opportunity and Application index initialization before listening. Index failure aborts startup; existing unique student/opportunity constraints are preserved. Resolve pre-existing duplicate data separately before startup; initialization does not delete or repair records.

Authenticated student `GET /api/v1/opportunities/:id` now includes `opportunity.hasApplied`, scoped to the current student using the compound index. Unavailable opportunities still return 404. The UI uses this flag without listing application history. POST submission remains the authoritative eligibility, availability and duplicate enforcement; transactions/version writes are unchanged.

Admin company detail history includes `actorLabel` from the reviewer's current name, falling back to “Administrator” for missing users. Stored actor IDs and audit records remain unchanged.

## Verification

Run `npm test`, `npm run lint`, changed-file Prettier checks, and `npm run build`. Automated database and browser verification must use disposable MongoDB instances/replica sets, never Atlas.
