# Eligibility and browsing filters (Phase 4C)

Student list and detail responses include `eligibility: { status, reasons }`. Each reason has `field`, `code` (`missing` or `mismatch`), and a display `message`. Evaluation uses the authenticated student's current stored profile, never caller-provided grades or identity.

## Rules

- CGPA must meet or exceed `minimumCgpa`. Zero is valid; null/missing/invalid values are incomplete when a minimum exists.
- Branch matching trims whitespace and ignores case, with exact names rather than substring matching.
- Graduation year must equal the required year.
- Null numeric requirements and empty allowed branches impose no restriction. Missing unrelated profile fields do not affect eligibility; unrestricted opportunities may be eligible without a profile.
- Known mismatches produce `not_eligible`, even when other required values are missing. Otherwise missing required fields produce `incomplete_profile`. With neither, status is `eligible`.
- All reasons are returned, including missing fields alongside known mismatches.

The pure `evaluateEligibility(opportunity, profile)` function in `backend/src/modules/opportunities/eligibility.js` is reusable. It has no database or HTTP dependency. It evaluates academic requirements only; eligibility is not authorization or an availability check. Future Phase 5 submission code must re-read current data and separately enforce session, ownership/visibility, deadline, and application rules. No application model, endpoint, or apply control is implemented here.

## Filters

Student `GET /api/v1/opportunities` accepts:

| Parameter        | Meaning                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `jobType`        | One existing job type, matched exactly.                                                          |
| `location`       | Case-insensitive literal substring, up to 200 characters.                                        |
| `search`         | Case-insensitive literal substring of title, description, or company name, up to 200 characters. |
| `eligibility`    | `eligible`, `not_eligible`, or `incomplete_profile`.                                             |
| `limit`, `after` | Existing ID cursor pagination, limit 1–100.                                                      |

Filters combine with AND; search fields combine with OR. Unknown keys, repeated values, blank supplied strings, and invalid enums return 400. Regex operators are escaped. Omit empty filters. Recruiter management list parameters remain unchanged.

Visibility and filters are applied before selecting a page. Eligibility uses the same evaluator for both returned reasons and filtering. Filtered results are streamed in bounded batches until a page plus one matching record is found; sparse eligibility matches can scan many candidates. This favors consistent domain rules without duplicating them in database expressions. Cursors represent live results, not frozen snapshots; changing filters or profile data requires starting again without the old cursor.

## UI and availability

Student cards and details show eligibility, reasons, and a profile link when information is missing or requirements are unmet. Apply filters submits browsing criteria; it does not submit an application. Clear filters resets pagination. Refresh fetches current eligibility and availability after profile/company changes.

Expired, unpublished, and hidden-company opportunities remain excluded from student APIs regardless of eligibility. Their detail endpoint returns the same 404 to avoid disclosing private records. The UI explains that the role may have expired, been unpublished, or become hidden. Loaded roles expire locally as time advances; publication or company changes become visible on the next fetch. Existing recruiter draft/published/expired/hidden indicators remain intact.

Run `npm test -w backend`, `npm test -w frontend`, `npm run lint`, and `npm run build -w frontend`. Tests cover evaluator boundaries, reasons, literal searches, combined filters, pagination, profile changes, role restrictions, stale responses, and hidden/expired records.
