import mongoose from 'mongoose';

const text = (maxlength) => ({ type: String, trim: true, maxlength });
const studentProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      immutable: true,
    },
    institution: text(200),
    degree: text(100),
    branch: text(100),
    graduationYear: { type: Number, min: 1950, max: 2100 },
    cgpa: { type: Number, min: 0, max: 10 },
    skills: {
      type: [String],
      default: [],
      validate: (values) => values.length <= 30,
    },
    bio: text(2000),
    location: text(200),
    phone: text(30),
    portfolioUrl: text(2048),
    linkedinUrl: text(2048),
    githubUrl: text(2048),
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

export const StudentProfile = mongoose.model(
  'StudentProfile',
  studentProfileSchema,
);
