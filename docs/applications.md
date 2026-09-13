# Applications API (Phase 5A)

All routes are under `/api/v1/applications` and require a current Bearer session. Responses use `Cache-Control: no-store`. No application frontend or dashboard is included.

## Endpoints

| Method | Path          | Role and behavior                                                                                |
| ------ | ------------- | ------------------------------------------------------------------------------------------------ |
| POST   | `/`           | Student submits `{ "opportunityId": "<id>" }`; returns 201 and `{ application }`.                |
| GET    | `/mine`       | Student lists only their own applications.                                                       |
| GET    | `/company`    | Recruiter lists applications for their company; optionally filter by `opportunityId`.            |
| PATCH  | `/:id/status` | Recruiter updates an owned application with `{ "status": "shortlisted", "expectedVersion": 0 }`. |

Lists return `{ applications, nextCursor }`, accept `limit` (1–100, default 20) and `after` (application ID), and sort by ascending ID. Unknown query/body fields are rejected. Ownership, student identity, initial status, and history cannot be supplied by clients.

## Submission

The service reads the current opportunity, approved company/version, and student profile in a transaction. It uses the existing pure `evaluateEligibility` function. Ineligible or incomplete profiles return 422 with `{ error, eligibility: { status, reasons } }`. Missing, draft, unpublished, expired, or hidden opportunities return the same 404. Duplicate student/opportunity pairs return 409, including concurrent submissions, backed by a unique database index.

Transactions perform internal version writes on the opportunity, company, and existing student profile. These establish write conflicts with concurrent edits; automatic transaction retries re-read and reevaluate the data. Application creation and those writes commit together or roll back together. Availability is checked immediately before insertion; a submission accepted before closure remains historical after closure.

**MongoDB Atlas or a replica set is required for submission.** A standalone MongoDB server returns 503 with a setup message; there is no nontransactional fallback. For local development, start MongoDB with `mongod --replSet rs0 --dbpath <local-data-directory>`, initialize once in mongosh with `rs.initiate()`, and use `mongodb://127.0.0.1:27017/placementhub?replicaSet=rs0`. Keep the URI in ignored backend configuration. Existing Atlas deployments support transactions.

Ensure the unique `{ student: 1, opportunity: 1 }` index exists before accepting production submissions. Default Mongoose model initialization creates it; deployments disabling automatic indexing must create it through their migration process.

## Status transitions and audit

- `applied → shortlisted → interview → selected`
- `applied`, `shortlisted`, or `interview` may transition to `rejected`.
- `selected` and `rejected` are terminal. Skipping stages, moving backwards, and repeated statuses return 409.
- Status writes require the current application version. Concurrent/stale requests return 409; reload the list before retrying.
- Status, version increment, and appended history event are one atomic write. Events contain previous status, next status, actor ID, and timestamp. The initial applied event records the student actor. The forward-only graph bounds history to at most four events.

Applications preserve submission snapshots: student name/email, academic eligibility fields, opportunity title/requirements/version, company name/version, and the eligibility decision. Later profile edits do not rewrite these records. Both scoped lists include status and history; no passwords, session tokens, or unrelated profile/contact fields are populated. Recruiters can manage existing applications after a role closes or company approval lapses, but cannot create new submissions or edit snapshots/history directly. Other companies' records return 404 or an empty scoped list. Students cannot update statuses; admins receive no implicit bypass.

## Verification

Run `npm test -w backend` and `npm run lint`. Application integration tests use an isolated single-node `MongoMemoryReplSet`, never Atlas. Coverage includes concurrent duplicates, transactional rollback and edit races, eligibility and visibility, role/ownership checks, pagination, transitions, and audit integrity.
