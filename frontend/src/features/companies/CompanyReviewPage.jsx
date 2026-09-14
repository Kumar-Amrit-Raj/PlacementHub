import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import ProfileDetails, { ApprovalStatus } from '../profiles/ProfileDetails.jsx';

export default function CompanyReviewPage() {
  const { id } = useParams();
  const { client } = useAuth();
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reason, setReason] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [reload, setReload] = useState(0);
  const flight = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setCompany(null);
    setReason('');
    client
      .request('/admin/companies/' + id)
      .then((data) => {
        if (active) {
          setCompany(data.company);
          setBlocked(false);
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, id, reload]);
  async function decide(action) {
    if (flight.current || blocked) return;
    if (action === 'reject' && !reason.trim()) {
      setError(
        'Enter a rejection reason so the recruiter knows what to change.',
      );
      return;
    }
    flight.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const data = await client.request(
        '/admin/companies/' + id + '/' + action,
        {
          method: 'POST',
          body: {
            expectedVersion: company.profileVersion ?? 0,
            reason: reason.trim(),
          },
        },
      );
      setCompany(data.company);
      setReason('');
      setSuccess(
        action === 'approve'
          ? 'Company approved successfully.'
          : 'Company rejected. The recruiter can now see your reason.',
      );
      setReload((value) => value + 1);
    } catch (error) {
      setBlocked(true);
      setError(
        error.message +
          ' Reload company details before making another decision.',
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="workspace-page">
      <Link to="/admin/companies">← Pending companies</Link>
      <h1>Company review</h1>
      {success && (
        <p className="success" role="status">
          {success}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="compact secondary"
        disabled={loading || busy}
        onClick={() => {
          setSuccess('');
          setReload((value) => value + 1);
        }}
      >
        Reload company details
      </button>
      {loading ? (
        <p role="status">Loading company…</p>
      ) : (
        company && (
          <>
            <div className="card review-details">
              <h2>{company.companyName || 'Unnamed company'}</h2>
              <p className="muted">
                Profile version {company.profileVersion ?? 0}
              </p>
              <ProfileDetails role="recruiter" profile={company} />
            </div>
            <ApprovalStatus company={company} />
            {company.approvalStatus === 'pending' && (
              <form
                className="card"
                onSubmit={(event) => event.preventDefault()}
              >
                <h2>Review decision</h2>
                <p className="muted">
                  Review the details above. A rejection reason is required and
                  will be visible to the recruiter. An approval note is
                  optional.
                </p>
                <label htmlFor="review-reason">
                  Review reason
                  <textarea
                    id="review-reason"
                    rows={4}
                    maxLength={1000}
                    value={reason}
                    disabled={busy || blocked}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                {!company.companyName?.trim() && (
                  <p className="muted">
                    The company must provide a name before approval.
                  </p>
                )}
                <div className="actions">
                  <button
                    type="button"
                    disabled={busy || blocked || !company.companyName?.trim()}
                    onClick={() => decide('approve')}
                  >
                    Approve company
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || blocked}
                    onClick={() => decide('reject')}
                  >
                    Reject company
                  </button>
                </div>
                {busy && <p role="status">Saving review decision…</p>}
              </form>
            )}
            <details className="card review-history">
              <summary>
                Review history ({company.approvalHistory?.length ?? 0})
              </summary>
              {!company.approvalHistory?.length ? (
                <p>No reviews recorded.</p>
              ) : (
                <ol>
                  {[...company.approvalHistory]
                    .reverse()
                    .map((review, index) => (
                      <li key={index}>
                        <p>
                          <strong className="role">{review.status}</strong> ·
                          Version {review.profileVersion} ·{' '}
                          {new Date(review.at).toLocaleString()}
                        </p>
                        <p className="muted">
                          Reviewer: {review.actorLabel || 'Administrator'}
                        </p>
                        <p className="preserve-lines">
                          {review.reason || 'No note provided.'}
                        </p>
                      </li>
                    ))}
                </ol>
              )}
            </details>
          </>
        )
      )}
    </section>
  );
}
