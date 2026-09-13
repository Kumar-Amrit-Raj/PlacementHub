import mongoose from 'mongoose';
import { COMPANY_SIZES } from './profile.validation.js';

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

export const RecruiterProfile = mongoose.model(
  'RecruiterProfile',
  recruiterProfileSchema,
);
