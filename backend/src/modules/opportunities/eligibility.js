export const normalizeBranch = (value) => value.trim().toLowerCase();
export const validCgpa = (value) =>
  Number.isFinite(value) && value >= 0 && value <= 10;
export const validGraduationYear = (value) =>
  Number.isInteger(value) && value >= 1950 && value <= 2100;

// Pure domain rule: availability/authorization are separate checks.
// Application submission re-reads profile and opportunity inside its transaction.
export function evaluateEligibility(opportunity, profile) {
  const reasons = [];
  const missing = (field, message) =>
    reasons.push({ field, code: 'missing', message });
  const mismatch = (field, message) =>
    reasons.push({ field, code: 'mismatch', message });
  if (opportunity.minimumCgpa != null) {
    if (!validCgpa(profile?.cgpa))
      missing('cgpa', 'Add your CGPA to your student profile.');
    else if (profile.cgpa < opportunity.minimumCgpa)
      mismatch(
        'cgpa',
        'Your CGPA (' +
          profile.cgpa +
          ') is below the minimum of ' +
          opportunity.minimumCgpa +
          '.',
      );
  }
  if (opportunity.allowedBranches?.length) {
    const branch = profile?.branch?.trim();
    if (!branch) missing('branch', 'Add your branch to your student profile.');
    else if (
      !opportunity.allowedBranches.some(
        (value) => normalizeBranch(value) === normalizeBranch(branch),
      )
    )
      mismatch(
        'branch',
        'Your branch (' +
          branch +
          ') is not among the allowed branches: ' +
          opportunity.allowedBranches.join(', ') +
          '.',
      );
  }
  if (opportunity.graduationYear != null) {
    if (!validGraduationYear(profile?.graduationYear))
      missing(
        'graduationYear',
        'Add your graduation year to your student profile.',
      );
    else if (profile.graduationYear !== opportunity.graduationYear)
      mismatch(
        'graduationYear',
        'Your graduation year (' +
          profile.graduationYear +
          ') does not match the required year ' +
          opportunity.graduationYear +
          '.',
      );
  }
  return {
    status: reasons.some((reason) => reason.code === 'mismatch')
      ? 'not_eligible'
      : reasons.length
        ? 'incomplete_profile'
        : 'eligible',
    reasons,
  };
}
