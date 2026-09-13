import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { RequestError, useNow } from '../opportunities/OpportunityShared.jsx';
import { expired } from '../opportunities/opportunity-utils.js';
export default function ApplyPanel({ opportunity }) {
  const { client } = useAuth();
  const [checking, setChecking] = useState(true);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState('');
  const [retry, setRetry] = useState(0);
  const flight = useRef(false);
  const active = useRef(false);
  const now = useNow();
  useEffect(() => {
    let cancelled = false;
    active.current = true;
    setChecking(true);
    setError(null);
    setBlocked(false);
    (async () => {
      let cursor;
      do {
        const data = await client.request(
          '/applications/mine?limit=100' +
            (cursor ? '&after=' + encodeURIComponent(cursor) : ''),
        );
        if (cancelled) return;
        if (
          data.applications.some((item) => item.opportunity === opportunity._id)
        ) {
          setApplied(true);
          return;
        }
        cursor = data.nextCursor;
      } while (cursor);
      setApplied(false);
    })()
      .catch((error) => {
        if (!cancelled) {
          setError(error);
          setBlocked(true);
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [client, opportunity._id, retry]);
  async function apply() {
    if (
      flight.current ||
      applied ||
      blocked ||
      checking ||
      opportunity.eligibility?.status !== 'eligible' ||
      expired(opportunity)
    )
      return;
    flight.current = true;
    setBusy(true);
    setError(null);
    try {
      await client.request('/applications', {
        method: 'POST',
        body: { opportunityId: opportunity._id },
      });
      if (active.current) {
        setApplied(true);
        setSuccess('Application submitted successfully.');
      }
    } catch (error) {
      if (active.current) {
        if (error.status === 409) {
          setApplied(true);
          setSuccess('You have already applied to this opportunity.');
        } else {
          setError({
            message:
              error.status === 422
                ? 'Your eligibility has changed. Refresh opportunity details and review your profile before applying.'
                : error.status === 404
                  ? 'This opportunity is no longer available for applications.'
                  : error.message,
          });
          setBlocked(true);
        }
      }
    } finally {
      flight.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <section className="application-panel" aria-label="Apply to opportunity">
      <h2>Your application</h2>
      {checking && <p role="status">Checking previous applications…</p>}
      {success && (
        <p role="status" className="success">
          {success}
        </p>
      )}
      <RequestError error={error} />
      {error && (
        <p className="muted">
          Check <Link to="/student/applications">My Applications</Link> if
          submission could not be confirmed. Refresh opportunity details before
          retrying.
        </p>
      )}
      {!checking && opportunity.eligibility?.status !== 'eligible' && (
        <p>
          Meet the eligibility requirements and complete the required profile
          fields before applying.
        </p>
      )}
      <div className="actions">
        <button
          disabled={
            checking ||
            busy ||
            applied ||
            blocked ||
            opportunity.eligibility?.status !== 'eligible' ||
            expired(opportunity, now)
          }
          onClick={apply}
        >
          {applied ? 'Already applied' : busy ? 'Submitting…' : 'Apply'}
        </button>
        <Link to="/student/applications">My Applications</Link>
        {blocked && !busy && (
          <button
            className="secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            Check application status
          </button>
        )}
      </div>
    </section>
  );
}
ApplyPanel.propTypes = { opportunity: PropTypes.object.isRequired };
