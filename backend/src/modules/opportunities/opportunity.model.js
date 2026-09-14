import { normalizeBranch } from './eligibility.js';
import mongoose from 'mongoose';
import { JOB_TYPES } from './opportunity.validation.js';

const text = (maxlength) => ({
  type: String,
  trim: true,
  required: true,
  maxlength,
});
const opportunitySchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RecruiterProfile',
      required: true,
      immutable: true,
    },
    title: text(200),
    description: text(10000),
    jobType: { type: String, enum: JOB_TYPES, required: true },
    location: text(200),
    compensation: text(500),
    deadline: { type: Date, required: true },
    minimumCgpa: { type: Number, min: 0, max: 10, default: null },
    allowedBranches: {
      type: [{ type: String, trim: true, maxlength: 100 }],
      default: [],
    },
    eligibilityBranches: { type: [String], default: undefined, select: false },
    graduationYear: { type: Number, min: 1950, max: 2100, default: null },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
      required: true,
    },
    publishedAt: { type: Date, default: null },
    approvedCompanyVersion: { type: Number, default: null },
    version: { type: Number, default: 0, required: true, min: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, value) {
        delete value.__v;
        delete value.eligibilityBranches;
        return value;
      },
    },
  },
);
opportunitySchema.pre('validate', function () {
  if (this.isNew || this.isModified('allowedBranches')) {
    this.eligibilityBranches = (this.allowedBranches || []).map(
      normalizeBranch,
    );
  }
});
// Keep the derived value atomic with ordinary opportunity edits.
opportunitySchema.pre(
  ['findOneAndUpdate', 'updateOne', 'updateMany'],
  function () {
    const update = this.getUpdate();
    const branches = update.$set?.allowedBranches ?? update.allowedBranches;
    if (branches !== undefined) {
      update.$set ??= {};
      update.$set.eligibilityBranches = (branches || []).map(normalizeBranch);
    } else if (update.$unset?.allowedBranches !== undefined) {
      update.$set ??= {};
      update.$set.eligibilityBranches = [];
    }
  },
);
opportunitySchema.index({ company: 1, _id: 1 });
opportunitySchema.index({ status: 1, _id: 1, deadline: 1 });
export const Opportunity = mongoose.model('Opportunity', opportunitySchema);
