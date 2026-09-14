# Phase 6B performance hardening

## Eligibility and pagination

MongoDB applies eligibility predicates before company lookup and before the final `$limit`. Search, company approval/version visibility, deadlines, job type, location, and ascending ObjectId cursors retain their existing behavior. Every list response transfers at most `limit + 1` opportunities into Node, even when matching records are sparse. Detail still returns one visible opportunity and its current eligibility/hasApplied information.

CGPA and graduation-year validity helpers are shared with `evaluateEligibility`. Known mismatches still override missing fields. The original evaluator generates every returned reason. Database parity tests include all statuses, null/missing/invalid profile values, numeric boundaries, Unicode branches, and mixed-status pagination.

Branch equality requires JavaScript trim/lowercase behavior. MongoDB only defines [`$toLower` reliably for ASCII](https://www.mongodb.com/docs/v8.0/reference/operator/aggregation/tolower/). The private `eligibilityBranches` array therefore stores normalized branch values while keeping original branches for display and reasons. Model validation and ordinary query edits update the derived values atomically. It is neither publicly writable nor returned in API responses.

Before listening, startup backfills missing derived arrays in batches of 250, projecting only IDs and branches. This operation is idempotent and compares the original branch array before writing, retrying concurrent changes. It does not alter opportunity versions, publication state, timestamps, application records, or audit snapshots. A failure prevents startup.

The first startup after upgrading may take longer for a large existing collection. Stop older backend writers before upgrading: older versions and raw collection/bulk updates bypass normalization. Use the model's supported create/save/query edit paths for subsequent branch changes. The application submission transaction/version-write mechanism is unchanged.

The existing status/ObjectId/deadline index supports candidate traversal; this change bounds API memory and network transfer, not worst-case database work. MongoDB can still inspect many candidates for sparse eligibility or substring matches. No claim of constant-time or indexed eligibility evaluation is made.

## Authenticated requests and session responses

Authentication matches session ID, user ID, null revocation, and future expiry, then joins the current User within one aggregation command. Missing users are rejected and roles come from the current database user, never JWT role claims. Explicit projections exclude session secrets and private user fields. Command-monitoring tests assert one round-trip; revocation, expiry, deletion, role changes, and mismatched session/user tests remain enforced.

Login/register/automatic refresh use their sanitized response user without immediately calling `/auth/me`. Page-load rehydration still calls `/auth/me` after cookie refresh to confirm the current session. Tokens remain in memory; cookie options, refresh serialization/replay handling, logout, and generation guards are unchanged.

## Search decision

The reported unindexed regex finding is valid. Current search is an escaped, case-insensitive literal substring across title, description, and the joined current company name. A [native text index](https://www.mongodb.com/docs/manual/reference/operator/query/text/) uses word/token semantics, so it cannot replace substring matching (including punctuation and partial words) exactly. Indexing company-name text with opportunity text would additionally require denormalization and synchronized company edits.

[Case-insensitive indexes do not accelerate regex matching](https://www.mongodb.com/docs/manual/core/index-case-insensitive/). Prefix-only search would also change behavior. Search therefore remains unchanged; no Atlas Search, external search service, or misleading text index was added.

## Verification

Run `npm test`, `npm run lint`, changed-file Prettier checks, and `npm run build`. Tests use disposable MongoDB instances/replica sets, never Atlas. Large-candidate command monitoring verifies a 20-item page transfers only 21 records without candidate-scanning getMore calls. Separate tests verify backfill idempotence/concurrency, startup completion before listening, and frontend request counts.
