import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { RequestError, useNow } from '../opportunities/OpportunityShared.jsx';
import { expired } from '../opportunities/opportunity-utils.js';
export default function ApplyPanel({ opportunity, onRefresh }) {
  const { client } = useAuth();
  const [applied, setApplied] = useState(opportunity.hasApplied === true);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState('');
  const flight = useRef(false);
  const active = useRef(false);
  const now = useNow();
  const missingStatus = typeof opportunity.hasApplied !== 'boolean';
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function apply() {
    if (
      flight.current ||
      applied ||
      blocked ||
      missingStatus ||
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
            details: error.eligibility?.reasons,
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
      {missingStatus && (
        <p role="alert">
          Application status is unavailable. Refresh opportunity details before
          applying.
        </p>
      )}
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
      {opportunity.eligibility?.status !== 'eligible' && (
        <p>
          Meet the eligibility requirements and complete the required profile
          fields before applying.
        </p>
      )}
      <div className="actions">
        <button
          disabled={
            busy ||
            applied ||
            blocked ||
            missingStatus ||
            opportunity.eligibility?.status !== 'eligible' ||
            expired(opportunity, now)
          }
          onClick={apply}
        >
          {applied ? 'Already applied' : busy ? 'Submitting…' : 'Apply'}
        </button>
        <Link to="/student/applications">My Applications</Link>
        {(blocked || missingStatus) && !busy && (
          <button className="secondary" onClick={onRefresh}>
            Refresh opportunity and application status
          </button>
        )}
      </div>
    </section>
  );
}
ApplyPanel.propTypes = {
  opportunity: PropTypes.object.isRequired,
  onRefresh: PropTypes.func.isRequired,
};
