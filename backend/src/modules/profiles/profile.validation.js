import { z } from 'zod';

const text = (max) => z.string().trim().max(max);
const url = text(2048).refine((value) => {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}, 'Use an HTTP or HTTPS URL without embedded credentials');
const phone = text(30).refine((value) => {
  const digits = value.replace(/\D/g, '').length;
  return (
    !value || (/^\+?[\d\s().-]+$/.test(value) && digits >= 5 && digits <= 15)
  );
}, 'Invalid phone number');
const patch = (fields) =>
  z
    .object(fields)
    .strict()
    .refine(
      (value) => Object.keys(value).length > 0,
      'Provide at least one profile field',
    );

export const studentProfilePatch = patch({
  institution: text(200).optional(),
  degree: text(100).optional(),
  branch: text(100).optional(),
  graduationYear: z.number().int().min(1950).max(2100).nullable().optional(),
  cgpa: z.number().min(0).max(10).nullable().optional(),
  skills: z
    .array(z.string().trim().min(1).max(50))
    .max(30)
    .refine(
      (values) =>
        new Set(values.map((value) => value.toLowerCase())).size ===
        values.length,
      'Skills must be unique',
    )
    .optional(),
  bio: text(2000).optional(),
  location: text(200).optional(),
  phone: phone.optional(),
  portfolioUrl: url.optional(),
  linkedinUrl: url.optional(),
  githubUrl: url.optional(),
});

export const COMPANY_SIZES = [
  '1-10',
  '11-50',
  '51-200',
  '201-500',
  '501-1000',
  '1001+',
];
export const recruiterProfilePatch = patch({
  companyName: text(200).optional(),
  website: url.optional(),
  industry: text(100).optional(),
  companySize: z.enum(COMPANY_SIZES).nullable().optional(),
  description: text(4000).optional(),
  headquarters: text(200).optional(),
  recruiterTitle: text(100).optional(),
  phone: phone.optional(),
  contactEmail: z
    .union([z.literal(''), z.string().trim().toLowerCase().max(254).email()])
    .optional(),
});
