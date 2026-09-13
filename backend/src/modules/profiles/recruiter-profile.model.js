import mongoose from 'mongoose';
import { COMPANY_SIZES } from './profile.validation.js';

const reviewFields = {
  status: { type: String, enum: ['approved', 'rejected'], required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  at: { type: Date, required: true },
  reason: { type: String, maxlength: 1000, default: '' },
  profileVersion: { type: Number, required: true, min: 0 },
};
const reviewSchema = new mongoose.Schema(reviewFields, { _id: false });
const historySchema = new mongoose.Schema(
  {
    ...reviewFields,
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const text = (maxlength) => ({ type: String, trim: true, maxlength });
const recruiterProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      immutable: true,
    },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      required: true,
    },
    profileVersion: { type: Number, default: 0, min: 0 },
    lastReview: { type: reviewSchema },
    approvalHistory: { type: [historySchema], default: [], select: false },
    companyName: text(200),
    website: text(2048),
    industry: text(100),
    companySize: { type: String, enum: [...COMPANY_SIZES, null] },
    description: text(4000),
    headquarters: text(200),
    recruiterTitle: text(100),
    phone: text(30),
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, value) {
        delete value.__v;
        return value;
      },
    },
  },
);

recruiterProfileSchema.index({ approvalStatus: 1, _id: 1 });

export const RecruiterProfile = mongoose.model(
  'RecruiterProfile',
  recruiterProfileSchema,
);
