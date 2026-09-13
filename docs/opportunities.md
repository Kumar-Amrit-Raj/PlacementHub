# Opportunities API (Phase 4A)

All routes are under `/api/v1/opportunities` and require a current Bearer session. Responses use `Cache-Control: no-store`. Applications, opportunity screens, and dashboards are outside this phase.

## Recruiter management

| Method | Path             | Behavior                                                              |
| ------ | ---------------- | --------------------------------------------------------------------- |
| POST   | `/`              | Create an owned draft; returns 201 and `{ opportunity }`.             |
| GET    | `/mine`          | List your company's records, including drafts and expired records.    |
| GET    | `/mine/:id`      | Read one owned opportunity.                                           |
| PATCH  | `/:id`           | Update supplied content fields; returns the opportunity to draft.     |
| POST   | `/:id/publish`   | Publish while the company is approved and the deadline is future.     |
| POST   | `/:id/unpublish` | Return the opportunity to draft, even if company approval has lapsed. |

The company is resolved from the authenticated recruiter's profile; clients cannot supply or transfer ownership. A missing company profile returns 409. Pending/rejected companies may prepare drafts. Other companies' records return 404. Controls accept an empty JSON object (or no body), never a client-supplied status.

## Student reads

`GET /` returns `{ opportunities, nextCursor }`; `GET /:id` returns `{ opportunity }`. Both require the student role. Hidden, expired, or absent details return 404.

Only published opportunities with a deadline strictly later than the request's visibility check are returned. The company must still be approved at the profile version used for publication. Editing company details immediately hides old publications; after reapproval the recruiter must explicitly republish. Removed companies also disappear. Student responses include only company ID, name, and website, excluding private contact and approval audit data.

Both lists accept `?limit=20&after=<opportunityId>`, sorted by ascending ID. Limit is 1–100; default 20. Use the returned cursor for the next page; null indicates the end. Visibility filters apply before pagination. Lists reflect current state and are not frozen snapshots.

## Fields and validation

Create requires `title` (1–200), `description` (1–10,000), `location` (1–200), `compensation` (1–500), `jobType`, and `deadline`. Text is trimmed. Compensation is descriptive text: include currency, amount/range, and pay period, or explicitly state unpaid.

- `jobType`: `full-time`, `part-time`, `internship`, or `contract`.
- `deadline`: future ISO 8601 timestamp with UTC Z or an explicit offset.
- `minimumCgpa`: number 0–10 or null (no minimum).
- `allowedBranches`: up to 50 unique, case-insensitive branch names, each 1–100 characters; [] means unrestricted.
- `graduationYear`: integer 1950–2100 or null (unrestricted).

Eligibility fields default to null/[]; they describe requirements without restricting browsing. Application eligibility enforcement is not part of this phase. PATCH preserves omitted fields and requires at least one recognized field. Unknown fields, ownership/status injection, invalid numbers, duplicate branches, and past deadlines return 400 with validation details.

Every accepted content update returns to draft, including same-value updates. Internal opportunity versions make concurrent writes conditional; conflicts return 409 and require reloading before retrying. Company approval/version is checked again in student queries so concurrent company edits cannot expose an unapproved profile. This does not require multi-document transactions.

Example create body (replace the deadline with a future timestamp):

```json
{
  "title": "Graduate Software Engineer",
  "description": "Build and maintain web services.",
  "jobType": "full-time",
  "location": "Bengaluru / hybrid",
  "compensation": "INR 8–12 lakh annually",
  "deadline": "2030-06-30T18:30:00Z",
  "minimumCgpa": 7,
  "allowedBranches": ["CSE", "ECE"],
  "graduationYear": 2030
}
```

## Verification

Run `npm test -w backend` and `npm run lint` from the project root. The integration tests use an isolated temporary MongoDB, never Atlas, and cover roles, ownership, validation, publication, company reapproval, expiry, pagination, and concurrent edits.
