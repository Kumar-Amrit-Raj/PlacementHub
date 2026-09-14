import {
  normalizeBranch,
  validCgpa,
  validGraduationYear,
} from './eligibility.js';

// Only select status here; evaluateEligibility remains the source of reasons.
// Normalized branches use JS Unicode rules, not MongoDB's ASCII-only $toLower.
export function eligibilityExpression(status, profile) {
  const required = (field) => ({
    $ne: [{ $ifNull: ['$' + field, null] }, null],
  });
  const cgpa = required('minimumCgpa');
  const year = required('graduationYear');
  const branches = {
    $gt: [{ $size: { $ifNull: ['$allowedBranches', []] } }, 0],
  };
  const branch = profile?.branch?.trim();
  const mismatch = {
    $or: [
      validCgpa(profile?.cgpa)
        ? { $and: [cgpa, { $gt: ['$minimumCgpa', profile.cgpa] }] }
        : false,
      branch
        ? {
            $and: [
              branches,
              {
                $not: [
                  {
                    $in: [
                      { $literal: normalizeBranch(branch) },
                      { $ifNull: ['$eligibilityBranches', []] },
                    ],
                  },
                ],
              },
            ],
          }
        : false,
      validGraduationYear(profile?.graduationYear)
        ? { $and: [year, { $ne: ['$graduationYear', profile.graduationYear] }] }
        : false,
    ],
  };
  const missing = {
    $or: [
      validCgpa(profile?.cgpa) ? false : cgpa,
      branch ? false : branches,
      validGraduationYear(profile?.graduationYear) ? false : year,
    ],
  };
  if (status === 'not_eligible') return mismatch;
  return {
    $and: [
      { $not: [mismatch] },
      status === 'incomplete_profile' ? missing : { $not: [missing] },
    ],
  };
}
