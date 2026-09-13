import mongoose from 'mongoose';
export const APPLICATION_STATUSES = [
  'applied',
  'shortlisted',
  'interview',
  'selected',
  'rejected',
];
export const TRANSITIONS = {
  applied: ['shortlisted', 'rejected'],
  shortlisted: ['interview', 'rejected'],
  interview: ['selected', 'rejected'],
  selected: [],
  rejected: [],
};
const historySchema = new mongoose.Schema(
  {
    from: {
      type: String,
      enum: [...APPLICATION_STATUSES, null],
      default: null,
    },
    to: { type: String, enum: APPLICATION_STATUSES, required: true },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    at: { type: Date, required: true },
  },
  { _id: false },
);
const applicationSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    opportunity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Opportunity',
      required: true,
      immutable: true,
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RecruiterProfile',
      required: true,
      immutable: true,
    },
    status: {
      type: String,
      enum: APPLICATION_STATUSES,
      default: 'applied',
      required: true,
    },
    version: { type: Number, default: 0, min: 0, required: true },
    snapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    history: { type: [historySchema], required: true },
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
applicationSchema.index({ student: 1, opportunity: 1 }, { unique: true });
applicationSchema.index({ student: 1, _id: 1 });
applicationSchema.index({ company: 1, opportunity: 1, _id: 1 });
export const Application = mongoose.model('Application', applicationSchema);
