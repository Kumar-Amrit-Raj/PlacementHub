import PropTypes from 'prop-types';
import { Link } from 'react-router';
export default function EligibilityStatus({ eligibility }) {
  if (!eligibility)
    return (
      <p className="muted">
        Eligibility unavailable. Refresh to check your profile.
      </p>
    );
  const labels = {
    eligible: 'Eligible',
    not_eligible: 'Not eligible',
    incomplete_profile: 'Incomplete profile',
  };
  return (
    <section className="eligibility-panel" aria-label="Your eligibility">
      <span
        className={
          'badge badge-' +
          (eligibility.status === 'eligible'
            ? 'approved'
            : eligibility.status === 'not_eligible'
              ? 'rejected'
              : 'pending')
        }
      >
        {labels[eligibility.status]}
      </span>
      {eligibility.status === 'eligible' && (
        <p className="muted">
          Your profile meets the listed eligibility requirements.
        </p>
      )}
      {!!eligibility.reasons.length && (
        <ul>
          {eligibility.reasons.map((reason) => (
            <li key={reason.field}>{reason.message}</li>
          ))}
        </ul>
      )}
      {eligibility.status !== 'eligible' && (
        <Link to="/student/profile">Review your student profile</Link>
      )}
    </section>
  );
}
EligibilityStatus.propTypes = {
  eligibility: PropTypes.shape({
    status: PropTypes.string.isRequired,
    reasons: PropTypes.array.isRequired,
  }),
};
