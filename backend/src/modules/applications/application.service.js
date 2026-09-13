import mongoose from 'mongoose';
import { Application, TRANSITIONS } from './application.model.js';
import { Opportunity } from '../opportunities/opportunity.model.js';
import { RecruiterProfile } from '../profiles/recruiter-profile.model.js';
import { StudentProfile } from '../profiles/student-profile.model.js';
import { evaluateEligibility } from '../opportunities/eligibility.js';
export class ApplicationError extends Error {
  constructor(message, status, eligibility) {
    super(message);
    this.status = status;
    this.eligibility = eligibility;
  }
}
export async function applyForOpportunity(student, opportunityId) {
  try {
    return await mongoose.connection.transaction(async (session) => {
      const opportunity =
        await Opportunity.findById(opportunityId).session(session);
      const company = opportunity
        ? await RecruiterProfile.findById(opportunity.company).session(session)
        : null;
      if (
        !opportunity ||
        opportunity.status !== 'published' ||
        opportunity.deadline <= new Date() ||
        !company ||
        company.approvalStatus !== 'approved' ||
        opportunity.approvedCompanyVersion !== company.profileVersion
      )
        throw new ApplicationError(
          'Opportunity is not available for applications.',
          404,
        );
      if (
        await Application.exists({
          student: student.id,
          opportunity: opportunityId,
        }).session(session)
      )
        throw new ApplicationError(
          'You have already applied to this opportunity.',
          409,
        );
      const profile = await StudentProfile.findOne({
        user: student.id,
      }).session(session);
      const eligibility = evaluateEligibility(opportunity, profile);
      if (eligibility.status !== 'eligible')
        throw new ApplicationError(
          'Your profile does not meet the opportunity requirements.',
          422,
          eligibility,
        );
      // Real writes establish conflicts with simultaneous opportunity, company and
      // profile updates. Snapshot reads alone would permit write skew.
      for (const [Model, doc] of [
        [Opportunity, opportunity],
        [RecruiterProfile, company],
        [StudentProfile, profile],
      ]) {
        if (doc)
          await Model.collection.updateOne(
            { _id: doc._id },
            { $inc: { __v: 1 } },
            { session },
          );
      }
      const at = new Date();
      if (opportunity.deadline <= at)
        throw new ApplicationError(
          'Opportunity is not available for applications.',
          404,
        );
      const [application] = await Application.create(
        [
          {
            student: student.id,
            opportunity: opportunity._id,
            company: company._id,
            snapshot: {
              studentName: student.name,
              studentEmail: student.email,
              title: opportunity.title,
              companyName: company.companyName,
              opportunityVersion: opportunity.version,
              companyVersion: company.profileVersion,
              requirements: {
                minimumCgpa: opportunity.minimumCgpa,
                allowedBranches: opportunity.allowedBranches,
                graduationYear: opportunity.graduationYear,
              },
              profile: {
                cgpa: profile?.cgpa ?? null,
                branch: profile?.branch ?? '',
                graduationYear: profile?.graduationYear ?? null,
              },
              eligibility,
            },
            history: [{ from: null, to: 'applied', actor: student.id, at }],
          },
        ],
        { session },
      );
      return application;
    });
  } catch (error) {
    if (error.code === 11000)
      throw new ApplicationError(
        'You have already applied to this opportunity.',
        409,
      );
    if (error.code === 20)
      throw new ApplicationError(
        'Applications require MongoDB Atlas or a replica set.',
        503,
      );
    throw error;
  }
}
export async function updateApplicationStatus(
  id,
  companyId,
  actor,
  { status, expectedVersion },
) {
  const current = await Application.findOne({ _id: id, company: companyId });
  if (
    !current ||
    !(await Opportunity.exists({
      _id: current.opportunity,
      company: companyId,
    }))
  )
    throw new ApplicationError('Application not found', 404);
  if (current.version !== expectedVersion)
    throw new ApplicationError(
      'Application changed. Reload before updating.',
      409,
    );
  if (!TRANSITIONS[current.status].includes(status))
    throw new ApplicationError('Illegal application status transition.', 409);
  const application = await Application.findOneAndUpdate(
    {
      _id: id,
      company: companyId,
      status: current.status,
      version: expectedVersion,
    },
    {
      $set: { status },
      $inc: { version: 1 },
      $push: {
        history: { from: current.status, to: status, actor, at: new Date() },
      },
    },
    { returnDocument: 'after', runValidators: true },
  );
  if (!application)
    throw new ApplicationError(
      'Application changed. Reload before updating.',
      409,
    );
  return application;
}
