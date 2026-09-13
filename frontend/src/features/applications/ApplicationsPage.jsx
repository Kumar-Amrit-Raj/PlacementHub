import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { RequestError } from '../opportunities/OpportunityShared.jsx';
import ApplicationCard from './ApplicationCard.jsx';
export default function ApplicationsPage({ recruiter = false }) {
  const { client } = useAuth();
  const [params] = useSearchParams();
  const opportunityId = recruiter ? params.get('opportunityId') : null;
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const flight = useRef(false);
  const path =
    '/applications/' +
    (recruiter ? 'company' : 'mine') +
    '?limit=20' +
    (opportunityId
      ? '&opportunityId=' + encodeURIComponent(opportunityId)
      : '');
  useEffect(() => {
    const current = ++generation.current;
    setItems([]);
    setCursor(null);
    setLoading(true);
    setError(null);
    flight.current = false;
    client
      .request(path)
      .then((data) => {
        if (generation.current === current) {
          setItems(data.applications);
          setCursor(data.nextCursor);
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
  }, [client, path, reload]);
  async function more() {
    if (flight.current) return;
    const current = generation.current;
    flight.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await client.request(
        path + '&after=' + encodeURIComponent(cursor),
      );
      if (generation.current === current) {
        setItems((items) => [
          ...items,
          ...data.applications.filter(
            (item) => !items.some((old) => old._id === item._id),
          ),
        ]);
        setCursor(data.nextCursor);
      }
    } catch (error) {
      if (generation.current === current) setError(error);
    } finally {
      if (generation.current === current) {
        flight.current = false;
        setLoading(false);
      }
    }
  }
  return (
    <section className="workspace-page">
      <p className="eyebrow">
        {recruiter ? 'YOUR APPLICANTS' : 'YOUR NEXT STEP'}
      </p>
      <h1>{recruiter ? 'Company applications' : 'My Applications'}</h1>
      <p className="muted">
        {recruiter
          ? 'Review submitted student profiles and track each application through the selection process.'
          : 'Track your submitted applications and their status history.'}
      </p>
      {recruiter && (
        <p>
          {opportunityId ? (
            <Link to="/recruiter/applications">
              Show all company applications
            </Link>
          ) : (
            <Link to="/recruiter/opportunities">
              Choose an opportunity to view its applicants
            </Link>
          )}
        </p>
      )}
      <button
        className="compact secondary"
        disabled={loading}
        onClick={() => setReload((value) => value + 1)}
      >
        Refresh applications
      </button>
      <RequestError error={error} />
      {loading && <p role="status">Loading applications…</p>}
      {!loading && !error && !items.length && (
        <div className="card empty-state">
          <h2>No applications yet</h2>
          <p>
            {recruiter
              ? 'Applications will appear here when students apply.'
              : 'Browse opportunities to find a role that matches your profile.'}
          </p>
          {!recruiter && (
            <Link to="/student/opportunities">Browse opportunities</Link>
          )}
        </div>
      )}
      {items.map((item) => (
        <ApplicationCard
          key={item._id + ':' + reload}
          application={item}
          recruiter={recruiter}
          onUpdate={(updated) =>
            setItems((current) =>
              current.map((old) => (old._id === updated._id ? updated : old)),
            )
          }
        />
      ))}
      {cursor && (
        <button className="compact" disabled={loading} onClick={more}>
          Load more applications
        </button>
      )}
    </section>
  );
}
ApplicationsPage.propTypes = { recruiter: PropTypes.bool };
