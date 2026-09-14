import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useAuth } from '../auth/AuthContext.jsx';
import { RequestError } from '../opportunities/OpportunityShared.jsx';
export const transitions = {
  applied: ['shortlisted', 'rejected'],
  shortlisted: ['interview', 'rejected'],
  interview: ['selected', 'rejected'],
  selected: [],
  rejected: [],
};
const labels = {
  shortlisted: 'Shortlist',
  interview: 'Move to interview',
  selected: 'Select applicant',
  rejected: 'Reject applicant',
};
export default function ApplicationCard({
  application,
  recruiter = false,
  onUpdate,
  onReload,
}) {
  const { client } = useAuth();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState('');
  const flight = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const snapshot = application.snapshot;
  async function update(status) {
    if (flight.current || blocked) return;
    flight.current = true;
    setBusy(true);
    setError(null);
    setSuccess('');
    try {
      const data = await client.request(
        '/applications/' + application._id + '/status',
        {
          method: 'PATCH',
          body: { status, expectedVersion: application.version },
        },
      );
      if (!active.current) return;
      onUpdate(data.application);
      setSuccess('Application status updated to ' + status + '.');
    } catch (error) {
      if (!active.current) return;
      setError({
        message:
          error.status === 409
            ? 'This application changed or the transition is no longer available. Refresh applications before making another decision.'
            : error.message + ' Refresh applications before retrying.',
      });
      setBlocked(true);
    } finally {
      flight.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <article className="card application-card">
      <div className="application-heading">
        <div>
          <h2>{snapshot.title}</h2>
          <p>{snapshot.companyName}</p>
        </div>
        <span
          className={'badge application-status status-' + application.status}
        >
          {application.status}
        </span>
      </div>
      <p className="muted">
        Submitted {new Date(application.createdAt).toLocaleString()}
      </p>
      {recruiter && (
        <section aria-label="Applicant snapshot">
          <h3>{snapshot.studentName}</h3>
          <p>{snapshot.studentEmail}</p>
          <p className="muted">Profile at the time of application</p>
          <dl className="profile-details">
            <dt>CGPA</dt>
            <dd>{snapshot.profile?.cgpa ?? 'Not provided'}</dd>
            <dt>Branch</dt>
            <dd>{snapshot.profile?.branch || 'Not provided'}</dd>
            <dt>Graduation year</dt>
            <dd>{snapshot.profile?.graduationYear ?? 'Not provided'}</dd>
          </dl>
        </section>
      )}
      <details>
        <summary>Status history</summary>
        <ol className="application-history">
          {application.history.map((event, index) => (
            <li key={index}>
              <span className="role">
                {event.from ? event.from + ' → ' : ''}
                {event.to}
              </span>{' '}
              · {new Date(event.at).toLocaleString()}
            </li>
          ))}
        </ol>
      </details>
      {success && (
        <p role="status" className="success">
          {success}
        </p>
      )}
      <RequestError error={error} />
      {blocked && (
        <button className="compact secondary" onClick={onReload}>
          Reload latest applications
        </button>
      )}
      {recruiter &&
        ((transitions[application.status] ?? []).length ? (
          <div className="actions">
            {transitions[application.status].map((status) => (
              <button
                key={status}
                className={status === 'rejected' ? 'secondary' : ''}
                disabled={busy || blocked}
                onClick={() => update(status)}
              >
                {labels[status]}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">This application has reached a final status.</p>
        ))}
      {busy && <p role="status">Updating application…</p>}
    </article>
  );
}
ApplicationCard.propTypes = {
  application: PropTypes.object.isRequired,
  recruiter: PropTypes.bool,
  onUpdate: PropTypes.func.isRequired,
  onReload: PropTypes.func.isRequired,
};
