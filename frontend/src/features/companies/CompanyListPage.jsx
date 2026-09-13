import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';

export default function CompanyListPage() {
  const { client } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const flight = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setCompanies([]);
    setCursor(null);
    client
      .request('/admin/companies/pending?limit=20')
      .then((data) => {
        if (active) {
          setCompanies(data.companies);
          setCursor(data.nextCursor);
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
  }, [client, reload]);
  async function more() {
    if (flight.current) return;
    flight.current = true;
    setLoading(true);
    setError('');
    try {
      const data = await client.request(
        '/admin/companies/pending?limit=20&after=' + encodeURIComponent(cursor),
      );
      setCompanies((current) => [
        ...current,
        ...data.companies.filter(
          (item) => !current.some((old) => old._id === item._id),
        ),
      ]);
      setCursor(data.nextCursor);
    } catch (error) {
      setError(error.message);
    } finally {
      flight.current = false;
      setLoading(false);
    }
  }
  return (
    <section className="workspace-page">
      <p className="eyebrow">ADMINISTRATION</p>
      <h1>Company reviews</h1>
      <p className="muted">
        Review pending company profiles before approving their current details.
      </p>
      <button
        className="compact secondary"
        disabled={loading}
        onClick={() => setReload((value) => value + 1)}
      >
        Refresh list
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading companies…</p>}
      {!loading && !error && !companies.length && (
        <div className="card empty-state">
          <h2>All caught up</h2>
          <p>No companies waiting for review.</p>
        </div>
      )}
      <ul className="company-list">
        {companies.map((company) => (
          <li key={company._id} className="card">
            <div>
              <span className="badge badge-pending">pending</span>
              <h2>{company.companyName || 'Unnamed company'}</h2>
              <p className="muted">
                {[company.industry, company.headquarters]
                  .filter(Boolean)
                  .join(' · ') || 'Company details not provided'}
              </p>
            </div>
            <Link to={'/admin/companies/' + company._id}>
              Review company
              <span className="sr-only">
                : {company.companyName || 'Unnamed company'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {cursor && (
        <button className="compact" disabled={loading} onClick={more}>
          Load more companies
        </button>
      )}
    </section>
  );
}
