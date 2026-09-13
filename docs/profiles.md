# Profile API (Phase 3A)

All endpoints require `Authorization: Bearer <accessToken>`. Profiles are private and owned by the authenticated user.

| Method      | Endpoint                        | Allowed role |
| ----------- | ------------------------------- | ------------ |
| GET / PATCH | `/api/v1/profiles/student/me`   | student      |
| GET / PATCH | `/api/v1/profiles/recruiter/me` | recruiter    |

Administrators cannot use these self-service endpoints. Self-service endpoints offer no listing, cross-user lookup, or admin editing. Admin company review uses separate endpoints.

## Read and update behavior

GET returns HTTP 200 with `{ "profile": null }` until the first save and does not create a record. PATCH creates a draft on the first save and returns HTTP 200 with `{ "profile": { ... } }`. Later patches preserve omitted fields. Send at least one supported field; unknown fields and empty patches return 400.

Each profile includes its `_id`, owning `user` ID, and timestamps. These are server-controlled. Never send ownership IDs, roles, credentials, or approval fields. The owner always comes from the authenticated session, even if a query parameter supplies another user ID. Unique owner indexes guarantee one profile of each type per user and protect concurrent first saves.

Profiles can be incomplete drafts. Strings are trimmed and can be cleared with `""`; nullable numbers and company size can be cleared with `null`; skills can be cleared with `[]`. Omitted fields are preserved. Missing/invalid/revoked authentication returns 401; the wrong role returns 403; invalid fields return 400 with validation details.

## Student fields

| Field                                | Validation                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| institution, location                | Up to 200 characters                                                                           |
| degree, branch                       | Up to 100 characters                                                                           |
| graduationYear                       | Integer from 1950 through 2100, or null                                                        |
| cgpa                                 | Number from 0 through 10, or null; this API uses a 10-point scale                              |
| skills                               | At most 30 nonempty strings, up to 50 characters each; unique ignoring case                    |
| bio                                  | Up to 2,000 characters                                                                         |
| phone                                | Up to 30 characters, 5–15 digits, optional leading +, spaces, parentheses, periods, or hyphens |
| portfolioUrl, linkedinUrl, githubUrl | HTTP/HTTPS URLs without embedded credentials, up to 2,048 characters, or empty                 |

Example PATCH body:

```json
{
  "institution": "Example University",
  "degree": "B.Tech",
  "branch": "Computer Science",
  "graduationYear": 2027,
  "cgpa": 8.5,
  "skills": ["JavaScript", "React"]
}
```

## Recruiter/company fields

| Field                     | Validation                                                          |
| ------------------------- | ------------------------------------------------------------------- |
| companyName, headquarters | Up to 200 characters                                                |
| industry, recruiterTitle  | Up to 100 characters                                                |
| companySize               | 1-10, 11-50, 51-200, 201-500, 501-1000, 1001+, or null              |
| description               | Up to 4,000 characters                                              |
| website                   | Same URL rules as student links                                     |
| phone                     | Same phone rules as students                                        |
| contactEmail              | Valid email up to 254 characters, normalized to lowercase, or empty |

A recruiter owns one company draft in this phase. Recruiters cannot claim an existing profile or share ownership by submitting a company/user ID. Company names are not unique; entering a name does not automatically grant approval. Shared company membership, jobs, opportunities, and dashboards remain out of scope. Company approval is documented in [Company approval](company-approval.md).

Profile data does not change the User account's name, login email, password, or role. URLs are stored only; the server does not fetch them.

Run `npm test -w backend` and `npm run lint`. Profile tests use isolated temporary MongoDB and cover ownership, cross-role denial, validation, field preservation, concurrent saves, and session invalidation.
