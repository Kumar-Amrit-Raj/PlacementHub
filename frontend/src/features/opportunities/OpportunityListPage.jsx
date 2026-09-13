import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { expired } from './opportunity-utils.js';
import {
  OpportunityStatus,
  RequestError,
  useNow,
} from './OpportunityShared.jsx';

export default function OpportunityListPage({ recruiter = false }) {
  const { client } = useAuth();
  const [items, setItems] = useState([]);
  const [company, setCompany] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const flight = useRef(false);
  const now = useNow();
  const path = '/opportunities' + (recruiter ? '/mine' : '');
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    setItems([]);
    setCursor(null);
    flight.current = false;
    Promise.all([
      client.request(path + '?limit=20'),
      recruiter
        ? client.request('/profiles/recruiter/me')
        : Promise.resolve(null),
    ])
      .then(([data, profile]) => {
        if (generation.current === current) {
          setItems(data.opportunities);
          setCursor(data.nextCursor);
          setCompany(profile?.profile);
        }
      })
      .catch((error) => {
        if (generation.current === current) setError(error);
      })
      .finally(() => {
        if (generation.current === current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [client, path, recruiter, reload]);
  async function more() {
    if (flight.current) return;
    const current = generation.current;
    flight.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await client.request(
        path + '?limit=20&after=' + encodeURIComponent(cursor),
      );
      if (current === generation.current) {
        setItems((items) => [
          ...items,
          ...data.opportunities.filter(
            (item) => !items.some((old) => old._id === item._id),
          ),
        ]);
        setCursor(data.nextCursor);
      }
    } catch (error) {
      if (current === generation.current) setError(error);
    } finally {
      if (current === generation.current) {
        flight.current = false;
        setLoading(false);
      }
    }
  }
  const visible = recruiter
    ? items
    : items.filter((item) => !expired(item, now));
  return (
    <section className="workspace-page">
      <p className="eyebrow">
        {recruiter ? 'BUILD YOUR TEAM' : 'YOUR NEXT OPPORTUNITY'}
      </p>
      <h1>{recruiter ? 'Your opportunities' : 'Explore opportunities'}</h1>
      <p className="muted">
        {recruiter
          ? 'Manage drafts and publishing for your company.'
          : 'Explore current roles and review their eligibility requirements.'}
      </p>
      <div className="actions">
        {recruiter && (
          <Link className="button-link" to="/recruiter/opportunities/new">
            Create opportunity
          </Link>
        )}
        <button
          className="secondary"
          disabled={loading}
          onClick={() => setReload((value) => value + 1)}
        >
          Refresh opportunities
        </button>
      </div>
      {recruiter && (
        <p className="muted">
          Publishing requires company approval.{' '}
          <Link to="/recruiter/profile">Review your company profile</Link>.
        </p>
      )}
      <RequestError error={error} />
      {loading && <p role="status">Loading opportunities…</p>}
      {!loading && !error && !visible.length && (
        <div className="card empty-state">
          <h2>
            {recruiter
              ? 'Start with your first opportunity'
              : 'No current opportunities'}
          </h2>
          <p>
            {recruiter
              ? 'Create a draft when you are ready to hire.'
              : 'Check back later for new roles.'}
          </p>
        </div>
      )}
      <ul className="company-list">
        {visible.map((item) => (
          <li className="card" key={item._id}>
            <div>
              {recruiter && <OpportunityStatus item={item} company={company} />}
              <h2>{item.title}</h2>
              {!recruiter && <p>{item.company?.companyName}</p>}
              <p className="muted">
                {item.jobType} · {item.location}
              </p>
              <p className="preserve-lines">{item.compensation}</p>
              <p className="muted">
                Deadline: {new Date(item.deadline).toLocaleString()}
              </p>
            </div>
            <Link
              to={
                recruiter
                  ? '/recruiter/opportunities/' + item._id + '/edit'
                  : '/student/opportunities/' + item._id
              }
            >
              {recruiter ? 'Manage opportunity' : 'View opportunity'}
              <span className="sr-only">: {item.title}</span>
            </Link>
          </li>
        ))}
      </ul>
      {cursor && (
        <button className="compact" disabled={loading} onClick={more}>
          Load more opportunities
        </button>
      )}
    </section>
  );
}
OpportunityListPage.propTypes = { recruiter: PropTypes.bool };
