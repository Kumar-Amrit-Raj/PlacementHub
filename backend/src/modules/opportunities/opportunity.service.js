import mongoose from 'mongoose';
import { Opportunity } from './opportunity.model.js';
import { RecruiterProfile } from '../profiles/recruiter-profile.model.js';

export class OpportunityError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
export async function ownCompany(userId) {
  const company = await RecruiterProfile.findOne({ user: userId });
  if (!company)
    throw new OpportunityError('Create a company profile first.', 409);
  return company;
}
export async function changeOpportunity(id, company, action, changes = {}) {
  const current = await Opportunity.findOne({ _id: id, company: company._id });
  if (!current) throw new OpportunityError('Opportunity not found', 404);
  if (action === 'publish') {
    if (company.approvalStatus !== 'approved')
      throw new OpportunityError(
        'Only approved companies can publish opportunities.',
        403,
      );
    if (current.deadline <= new Date())
      throw new OpportunityError(
        'Extend the deadline before publishing an expired opportunity.',
        409,
      );
  }
  const publishing = action === 'publish';
  // All content edits return to draft. Conditional writes prevent a concurrent edit
  // from being silently overwritten by a publish operation based on older details.
  const updated = await Opportunity.findOneAndUpdate(
    {
      _id: current._id,
      company: company._id,
      version: current.version,
      ...(publishing ? { deadline: { $gt: new Date() } } : {}),
    },
    {
      $set: {
        ...changes,
        status: publishing ? 'published' : 'draft',
        publishedAt: publishing ? new Date() : null,
        approvedCompanyVersion: publishing ? company.profileVersion : null,
      },
      $inc: { version: 1 },
    },
    { returnDocument: 'after', runValidators: true },
  );
  if (!updated)
    throw new OpportunityError(
      'Opportunity changed or expired. Reload before retrying.',
      409,
    );
  return updated;
}
export function publishedOpportunities({ id, after, limit = 20 } = {}) {
  return Opportunity.aggregate([
    {
      $match: {
        status: 'published',
        deadline: { $gt: new Date() },
        ...(id
          ? { _id: new mongoose.Types.ObjectId(id) }
          : after
            ? { _id: { $gt: new mongoose.Types.ObjectId(after) } }
            : {}),
      },
    },
    { $sort: { _id: 1 } },
    {
      $lookup: {
        from: RecruiterProfile.collection.name,
        localField: 'company',
        foreignField: '_id',
        as: 'companyProfile',
      },
    },
    { $unwind: '$companyProfile' },
    // Check approval at read time, including its version. An edit/review race can
    // never expose an opportunity under a new, unreviewed company profile.
    {
      $match: {
        'companyProfile.approvalStatus': 'approved',
        $expr: {
          $eq: [
            '$approvedCompanyVersion',
            { $ifNull: ['$companyProfile.profileVersion', 0] },
          ],
        },
      },
    },
    { $limit: id ? 1 : limit + 1 },
    {
      $project: {
        _id: 1,
        title: 1,
        description: 1,
        jobType: 1,
        location: 1,
        compensation: 1,
        deadline: 1,
        minimumCgpa: 1,
        allowedBranches: 1,
        graduationYear: 1,
        publishedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        company: {
          _id: '$companyProfile._id',
          companyName: '$companyProfile.companyName',
          website: '$companyProfile.website',
        },
      },
    },
  ]);
}
