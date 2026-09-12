import { z } from 'zod';

const email = z.string().trim().toLowerCase().max(254).email();
const password = z
  .string()
  .min(8)
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= 72,
    'Password must not exceed 72 UTF-8 bytes',
  );

export const registerSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email,
    password,
    role: z.enum(['student', 'recruiter']).default('student'),
  })
  .strict();

export const loginSchema = z.object({ email, password }).strict();
