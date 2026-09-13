# Company Approval (Phase 3B)

Company review is separate from recruiter signup. Recruiter/company profiles start as `pending`; only an authenticated admin can approve or reject them. This phase adds backend APIs only.

## Admin endpoints

All routes require an admin access token in `Authorization: Bearer <accessToken>`. Anonymous or invalid sessions receive 401; non-admins receive 403.

| Method | Endpoint                              | Purpose                                      |
| ------ | ------------------------------------- | -------------------------------------------- |
| GET    | `/api/v1/admin/companies/pending`     | List pending profiles                        |
| GET    | `/api/v1/admin/companies/:id`         | Read current details and full review history |
| POST   | `/api/v1/admin/companies/:id/approve` | Approve the reviewed version                 |
| POST   | `/api/v1/admin/companies/:id/reject`  | Reject the reviewed version                  |

IDs are recruiter profile IDs, not User IDs. Invalid IDs return 400; nonexistent profiles return 404.

The pending list returns `{ companies, nextCursor }`, ordered by profile ID. Use `?limit=20&after=<nextCursor>` to advance. Limit defaults to 20 and must be 1–100. A null cursor means there are no more results. Unknown/malformed pagination parameters are rejected. Changes in pending status between pages can change the results.

Approval body:

```json
{ "expectedVersion": 0, "reason": "Company details verified" }
```

Rejection body:

```json
{ "expectedVersion": 0, "reason": "Please correct the company website" }
```

Always use the `profileVersion` from the profile you reviewed. Rejection requires a nonempty reason; approval permits an optional reason. Reasons are trimmed and limited to 1,000 characters. Unknown fields, invalid versions, and approval of a blank company name return 400. A company must still be pending at the reviewed version; stale or duplicate decisions return 409 and do not append an audit record.

## Recruiter behavior

`GET /api/v1/profiles/recruiter/me` includes:

- `approvalStatus`: pending, approved, or rejected.
- `profileVersion`: incremented on each actual profile edit.
- `lastReview`, when present: decision status, actor ID, time, reason, and reviewed version.

Recruiters cannot assign or remove status, version, last-review, or audit fields. Their profile PATCH still accepts only the documented profile fields. Administrators use the separate review routes and cannot edit a recruiter's company content through self-service endpoints.

Any actual profile-field change automatically returns the profile to pending and increments its version. This also allows correction and re-review after rejection. A no-op save leaves status and version unchanged. Previous decisions remain in history; `lastReview` may describe an older version while the current status is pending.

## Audit and concurrency

Status and its review-history entry are written atomically in one MongoDB document. Each decision records the authenticated admin ID, server timestamp, reason, reviewed version, and a snapshot of the reviewed profile fields. History cannot be overwritten through these APIs.

Two admins reviewing the same version cannot both succeed. An edit racing with approval either makes the decision stale or immediately returns the edited profile to pending, so changed details cannot inherit approval of an old version. Reads remain subject to ordinary concurrent updates.

Full history is available only from the admin detail route. History is capped at 100 decisions per profile to bound document size; reaching the cap returns 409 without discarding old entries. A future operator archival workflow is required before further review; this phase does not implement one.

Legacy profiles missing status/version are treated as pending/version 0. Query filters explicitly include missing fields, so defaults do not hide old records from review. No migration command needs to be run.

Tests use isolated temporary MongoDB and cover role isolation, recruiter tampering, stale decisions, simultaneous decisions, profile-edit races, legacy records, validation, and audit preservation. Run `npm test -w backend` and `npm run lint`.

No jobs, opportunities, or dashboards are implemented.
