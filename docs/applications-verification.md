# Phase 5C application verification

## Recovery behavior

- Failed Apply requests now offer a refresh of both opportunity details and prior applications. Duplicate checks alone cannot re-enable submission using stale eligibility.
- Eligibility reasons returned with HTTP 422 are preserved by the API client and displayed.
- Uncertain submission recovery checks the existing application before allowing another attempt; the unique backend index remains authoritative.
- Recruiter updates that finish after their card is unmounted by a reload cannot overwrite the refreshed list.
- Status conflicts retain disabled action controls and offer a nearby “Reload latest applications” button. A fresh version requires a new explicit decision.
- Successful status updates use the returned record, version, and history without a second mutation.

## Automated coverage

Run from the repository root:

```sh
npm test -w backend
npm test -w frontend
npm run lint
npm run build -w frontend
```

Backend coverage includes transactional eligibility and visibility checks, simultaneous duplicates, concurrent status decisions, version conflicts, all legal and terminal transitions, role changes, revoked sessions, audit injection rejection, exact history chains, and retention after expiry or company approval loss.

Frontend coverage includes duplicate detection across pages, uncertain submissions, refreshed eligibility, 422 reasons, stale update responses, conflict recovery, pagination errors, role guards, terminal controls, and history rendering.

Application integration tests use disposable MongoDB replica sets. Browser verification uses separate student and recruiter sessions against a disposable replica set; it does not connect to Atlas.

## End-to-end checks

- Student applies, recruiter shortlists/interviews/selects, student sees the updated status and four-event history.
- Reloaded opportunity disables duplicate Apply.
- Ineligible opportunity keeps Apply disabled.
- Two recruiter sessions exercise a real stale HTTP 409; reload obtains the current status/version before continuing.
- Wrong-role routes and another company's opportunity filter deny access.
- Closing an opportunity preserves existing student application history.
- Mobile layouts are checked for horizontal overflow, text status indicators, labeled controls, and expandable history.

No dashboards, Phase 6 features, new application states, or unrelated redesigns are included.
