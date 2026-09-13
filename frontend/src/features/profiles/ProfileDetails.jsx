import { Fragment } from 'react';
import PropTypes from 'prop-types';
import { fields } from './profile-fields.js';

export default function ProfileDetails({ role, profile }) {
  return (
    <dl className="profile-details">
      {fields[role].map(([key, label]) => (
        <Fragment key={key}>
          <dt>{label.replace(' (comma-separated)', '')}</dt>
          <dd>
            {Array.isArray(profile[key])
              ? profile[key].join(', ') || 'Not provided'
              : String(profile[key] ?? '') || 'Not provided'}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}
ProfileDetails.propTypes = {
  role: PropTypes.string.isRequired,
  profile: PropTypes.object.isRequired,
};

export function ApprovalStatus({ company }) {
  const status = company.approvalStatus || 'pending';
  return (
    <section className="approval-panel" aria-label="Company approval">
      <h2>Company approval</h2>
      <span className={'badge badge-' + status}>{status}</span>
      {status === 'pending' && <p>Your company is waiting for admin review.</p>}
      {status === 'approved' && (
        <p>Your current company profile is approved.</p>
      )}
      {company.lastReview?.reason && (
        <p className="preserve-lines">
          <strong>
            {status === 'rejected'
              ? 'Rejection reason'
              : 'Previous review note'}
            :{' '}
          </strong>
          {company.lastReview.reason}
        </p>
      )}
      <p className="muted">
        Changes to company details return the profile to pending review.
      </p>
    </section>
  );
}
ApprovalStatus.propTypes = { company: PropTypes.object.isRequired };
