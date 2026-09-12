import mongoose from 'mongoose';

export const USER_ROLES = ['student', 'recruiter', 'admin'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      unique: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: USER_ROLES,
      default: 'student',
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, value) {
        delete value.passwordHash;
        delete value.__v;
        return value;
      },
    },
  },
);

export const User = mongoose.model('User', userSchema);

export function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
