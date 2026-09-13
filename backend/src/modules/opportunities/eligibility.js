// Pure domain rule: availability/authorization are separate checks.
// Future application submission must re-read the profile and opportunity first.
export function evaluateEligibility(opportunity, profile) {
  const reasons = [];
  const missing = (field, message) =>
    reasons.push({ field, code: 'missing', message });
  const mismatch = (field, message) =>
    reasons.push({ field, code: 'mismatch', message });
  if (opportunity.minimumCgpa != null) {
    if (
      !Number.isFinite(profile?.cgpa) ||
      profile.cgpa < 0 ||
      profile.cgpa > 10
    )
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
        (value) => value.trim().toLowerCase() === branch.toLowerCase(),
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
    if (
      !Number.isInteger(profile?.graduationYear) ||
      profile.graduationYear < 1950 ||
      profile.graduationYear > 2100
    )
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
