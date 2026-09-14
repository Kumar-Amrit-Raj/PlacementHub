import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  draftValues,
  expired,
  jobTypes,
  needsRepublish,
  payload,
} from './opportunity-utils.js';
import {
  OpportunityStatus,
  RequestError,
  useNow,
} from './OpportunityShared.jsx';

export default function OpportunityEditorPage() {
  const { id } = useParams();
  const { client } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [item, setItem] = useState(null);
  const [company, setCompany] = useState(null);
  const [draft, setDraft] = useState(draftValues());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(location.state?.success ?? '');
  const [blocked, setBlocked] = useState(false);
  const [reload, setReload] = useState(0);
  const flight = useRef(false);
  const generation = useRef(0);
  const now = useNow();
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    setItem(null);
    setBlocked(false);
    setBusy(false);
    flight.current = false;
    Promise.all([
      client.request('/profiles/recruiter/me'),
      id ? client.request('/opportunities/mine/' + id) : Promise.resolve(null),
    ])
      .then(([profile, data]) => {
        if (current === generation.current) {
          setCompany(profile.profile);
          setItem(data?.opportunity ?? null);
          setDraft(draftValues(data?.opportunity));
        }
      })
      .catch((error) => {
        if (current === generation.current) {
          setError(error);
          setBlocked(true);
        }
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [client, id, reload]);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(draftValues(item ?? undefined));
  async function mutate(action) {
    if (flight.current || blocked) return;
    let body = {};
    if (action === 'save') {
      if (
        (!item || draft.deadline !== draftValues(item).deadline) &&
        !(new Date(draft.deadline).getTime() > Date.now())
      ) {
        setError({ message: 'Choose a future deadline in your local time.' });
        return;
      }
      body = payload(draft, item);
      if (!Object.keys(body).length) {
        setSuccess('No changes to save.');
        setError(null);
        return;
      }
    }
    const current = generation.current;
    flight.current = true;
    setBusy(true);
    setError(null);
    setSuccess('');
    try {
      const path =
        action === 'save'
          ? '/opportunities' + (id ? '/' + id : '')
          : '/opportunities/' + id + '/' + action;
      const data = await client.request(path, {
        method: action === 'save' && id ? 'PATCH' : 'POST',
        body,
      });
      if (current !== generation.current) return;
      setItem(data.opportunity);
      setDraft(draftValues(data.opportunity));
      setSuccess(
        action === 'save'
          ? 'Draft saved successfully.'
          : action === 'publish'
            ? 'Opportunity published successfully.'
            : 'Opportunity unpublished successfully.',
      );
      if (!id)
        navigate('/recruiter/opportunities/' + data.opportunity._id + '/edit', {
          replace: true,
          state: { success: 'Draft saved successfully.' },
        });
    } catch (error) {
      if (current === generation.current) {
        setError(error);
        if (action !== 'save' || error.status === 409 || !error.status)
          setBlocked(true);
      }
    } finally {
      if (current === generation.current) {
        flight.current = false;
        setBusy(false);
      }
    }
  }
  const input = (name) => ({
    id: 'opportunity-' + name,
    name,
    value: draft[name],
    onChange: (event) =>
      setDraft((current) => ({ ...current, [name]: event.target.value })),
  });
  return (
    <section className="workspace-page">
      <Link to="/recruiter/opportunities">← Your opportunities</Link>
      <h1>{id ? 'Edit opportunity' : 'Create opportunity'}</h1>
      {success && (
        <p role="status" className="success">
          {success}
        </p>
      )}
      <RequestError error={error} />
      {blocked && (
        <p className="muted">
          Reload before retrying. Unsaved edits will be discarded. If creation
          could not be confirmed, check your opportunity list before creating
          another draft.
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
        Reload opportunity
      </button>
      {loading ? (
        <p role="status">Loading opportunity…</p>
      ) : !company ? (
        <p className="card">
          Create a <Link to="/recruiter/profile">company profile</Link> before
          adding opportunities.
        </p>
      ) : (
        <>
          {item && (
            <div className="approval-panel">
              <h2>Publication status</h2>
              <OpportunityStatus item={item} company={company} />
              <p className="muted">
                Saving content changes returns this opportunity to draft.
                Publishing is a separate action.
              </p>
              {company.approvalStatus !== 'approved' && (
                <p>
                  Company approval is required to publish.{' '}
                  <Link to="/recruiter/profile">View approval status</Link>.
                </p>
              )}
              {expired(item, now) && (
                <p>Extend the deadline and save before publishing again.</p>
              )}
              {dirty && (
                <p>
                  Save or discard your edits before changing publication status.
                </p>
              )}
              <div className="actions">
                <button
                  disabled={
                    busy ||
                    blocked ||
                    dirty ||
                    expired(item, now) ||
                    company.approvalStatus !== 'approved' ||
                    (item.status === 'published' &&
                      !needsRepublish(item, company))
                  }
                  onClick={() => mutate('publish')}
                >
                  {needsRepublish(item, company)
                    ? 'Republish opportunity'
                    : 'Publish opportunity'}
                </button>
                <button
                  className="secondary"
                  disabled={
                    busy || blocked || dirty || item.status !== 'published'
                  }
                  onClick={() => mutate('unpublish')}
                >
                  Unpublish opportunity
                </button>
              </div>
            </div>
          )}
          {(!id || item) && (
            <form
              className="card"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate('save');
              }}
            >
              <h2>Role and eligibility</h2>
              <p className="muted">
                Deadline uses your local time. Optional eligibility fields left
                blank are unrestricted.
              </p>
              <fieldset disabled={busy || blocked} className="profile-form">
                <legend className="sr-only">Opportunity fields</legend>
                <label htmlFor="opportunity-title">
                  Title
                  <input {...input('title')} required maxLength={200} />
                </label>
                <label htmlFor="opportunity-jobType">
                  Job type
                  <select {...input('jobType')}>
                    {jobTypes.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label htmlFor="opportunity-description" className="wide">
                  Description
                  <textarea
                    {...input('description')}
                    required
                    maxLength={10000}
                    rows={6}
                  />
                </label>
                <label htmlFor="opportunity-location">
                  Location
                  <input {...input('location')} required maxLength={200} />
                </label>
                <label htmlFor="opportunity-compensation">
                  Compensation
                  <input
                    {...input('compensation')}
                    aria-label="Compensation"
                    required
                    maxLength={500}
                  />
                  <span className="small">
                    Include currency and pay period, or state unpaid.
                  </span>
                </label>
                <label htmlFor="opportunity-deadline">
                  Deadline (local time)
                  <input
                    {...input('deadline')}
                    required
                    type="datetime-local"
                  />
                </label>
                <label htmlFor="opportunity-minimumCgpa">
                  Minimum CGPA
                  <input
                    {...input('minimumCgpa')}
                    type="number"
                    min="0"
                    max="10"
                    step="any"
                  />
                </label>
                <label htmlFor="opportunity-graduationYear">
                  Graduation year
                  <input
                    {...input('graduationYear')}
                    type="number"
                    min="1950"
                    max="2100"
                    step="1"
                  />
                </label>
                <label htmlFor="opportunity-allowedBranches">
                  Allowed branches (comma-separated)
                  <input {...input('allowedBranches')} />
                </label>
              </fieldset>
              <div className="actions">
                <button disabled={busy || blocked}>
                  {busy ? 'Saving…' : 'Save draft'}
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDraft(draftValues(item ?? undefined));
                    setError(null);
                  }}
                >
                  Discard edits
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
