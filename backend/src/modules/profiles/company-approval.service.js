import { isDeepStrictEqual } from 'node:util';
import { RecruiterProfile } from './recruiter-profile.model.js';

export class ApprovalError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
export const pendingFilter = {
  $or: [{ approvalStatus: 'pending' }, { approvalStatus: { $exists: false } }],
};
const versionFilter = (version) =>
  version === 0
    ? { $or: [{ profileVersion: 0 }, { profileVersion: { $exists: false } }] }
    : { profileVersion: version };
const profileFields = [
  'companyName',
  'website',
  'industry',
  'companySize',
  'description',
  'headquarters',
  'recruiterTitle',
  'phone',
  'contactEmail',
];

export async function updateRecruiterProfile(userId, changes) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await RecruiterProfile.findOne({ user: userId });
    if (!current) {
      try {
        return await RecruiterProfile.create({ ...changes, user: userId });
      } catch (error) {
        if (error.code === 11000) continue;
        throw error;
      }
    }
    if (
      Object.entries(changes).every(([key, value]) =>
        isDeepStrictEqual(current.get(key), value),
      )
    )
      return current;
    const updated = await RecruiterProfile.findOneAndUpdate(
      {
        user: userId,
        ...versionFilter(current.profileVersion),
      },
      {
        $set: {
          ...changes,
          approvalStatus: 'pending',
          profileVersion: current.profileVersion + 1,
        },
      },
      { returnDocument: 'after', runValidators: true },
    );
    if (updated) return updated;
  }
  throw new ApprovalError(
    'Profile changed concurrently. Reload and try again.',
    409,
  );
}

export async function decideCompany(
  id,
  adminId,
  status,
  { expectedVersion, reason = '' },
) {
  const current =
    await RecruiterProfile.findById(id).select('+approvalHistory');
  if (!current) throw new ApprovalError('Company profile not found', 404);
  if (
    current.approvalStatus !== 'pending' ||
    current.profileVersion !== expectedVersion
  ) {
    throw new ApprovalError(
      'Company is no longer pending at this version. Reload before reviewing.',
      409,
    );
  }
  if (status === 'approved' && !current.companyName?.trim()) {
    throw new ApprovalError('Company name is required before approval.', 400);
  }
  // Bounded embedded audit snapshots keep each atomic document below MongoDB's size limit.
  if (current.approvalHistory.length >= 100)
    throw new ApprovalError(
      'Review history limit reached. Operator archival is required.',
      409,
    );
  const at = new Date();
  const review = {
    status,
    actor: adminId,
    at,
    reason,
    profileVersion: expectedVersion,
  };
  const snapshot = Object.fromEntries(
    profileFields
      .filter((key) => current.get(key) !== undefined)
      .map((key) => [key, current.get(key)]),
  );
  const updated = await RecruiterProfile.findOneAndUpdate(
    {
      _id: id,
      $and: [pendingFilter, versionFilter(expectedVersion)],
      'approvalHistory.99': { $exists: false },
    },
    {
      $set: { approvalStatus: status, lastReview: review },
      $push: { approvalHistory: { ...review, snapshot } },
    },
    { returnDocument: 'after', runValidators: true },
  );
  if (!updated)
    throw new ApprovalError(
      'Company changed during review. Reload before reviewing.',
      409,
    );
  return updated;
}
