import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { expired } from './opportunity-utils.js';
import {
  OpportunityDetails,
  RequestError,
  useNow,
} from './OpportunityShared.jsx';
export default function OpportunityDetailPage() {
  const { id } = useParams();
  const { client } = useAuth();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const now = useNow();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setItem(null);
    setError(null);
    client
      .request('/opportunities/' + id)
      .then((data) => {
        if (active) setItem(data.opportunity);
      })
      .catch((error) => {
        if (active)
          setError(
            error.status === 404
              ? { message: 'This opportunity is no longer available.' }
              : error,
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, id, reload]);
  return (
    <section className="workspace-page">
      <Link to="/student/opportunities">← Browse opportunities</Link>
      <h1>Opportunity details</h1>
      <RequestError error={error} />
      {loading ? (
        <p role="status">Loading opportunity…</p>
      ) : (
        item &&
        (expired(item, now) ? (
          <p role="status">This opportunity has expired.</p>
        ) : (
          <article className="card">
            <p className="eyebrow">{item.company?.companyName}</p>
            <h2>{item.title}</h2>
            <OpportunityDetails item={item} />
          </article>
        ))
      )}
      <button
        className="compact secondary"
        disabled={loading}
        onClick={() => setReload((value) => value + 1)}
      >
        Refresh details
      </button>
    </section>
  );
}
