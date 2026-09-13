import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import { expired, needsRepublish } from './opportunity-utils.js';
export function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
export function OpportunityStatus({ item, company }) {
  const now = useNow();
  return (
    <div className="opportunity-badges">
      <span
        className={
          'badge badge-' +
          (item.status === 'published' ? 'approved' : 'pending')
        }
      >
        {item.status}
      </span>
      {expired(item, now) && (
        <span className="badge badge-rejected">Expired</span>
      )}
      {!expired(item, now) && needsRepublish(item, company) && (
        <span className="badge badge-rejected">
          Hidden — company review or republication needed
        </span>
      )}
    </div>
  );
}
OpportunityStatus.propTypes = {
  item: PropTypes.object.isRequired,
  company: PropTypes.object,
};
export function RequestError({ error }) {
  if (!error) return null;
  return (
    <div role="alert" className="error">
      <p>{error.message}</p>
      {error.details?.length > 0 && (
        <ul>
          {error.details.map((detail, index) => (
            <li key={index}>
              {detail.field}: {detail.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
RequestError.propTypes = { error: PropTypes.object };
export function OpportunityDetails({ item }) {
  return (
    <>
      <dl className="profile-details">
        <dt>Job type</dt>
        <dd>{item.jobType}</dd>
        <dt>Location</dt>
        <dd>{item.location}</dd>
        <dt>Compensation</dt>
        <dd>{item.compensation}</dd>
        <dt>Deadline</dt>
        <dd>{new Date(item.deadline).toLocaleString()}</dd>
        <dt>Minimum CGPA</dt>
        <dd>{item.minimumCgpa ?? 'No minimum'}</dd>
        <dt>Allowed branches</dt>
        <dd>
          {item.allowedBranches?.length
            ? item.allowedBranches.join(', ')
            : 'All branches'}
        </dd>
        <dt>Graduation year</dt>
        <dd>{item.graduationYear ?? 'Any year'}</dd>
      </dl>
      <h2>About the opportunity</h2>
      <p className="preserve-lines">{item.description}</p>
    </>
  );
}
OpportunityDetails.propTypes = { item: PropTypes.object.isRequired };
