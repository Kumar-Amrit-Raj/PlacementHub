import { z } from 'zod';

export const JOB_TYPES = ['full-time', 'part-time', 'internship', 'contract'];
const text = (max) => z.string().trim().min(1).max(max);
export const opportunityFields = z
  .object({
    title: text(200),
    description: text(10000),
    jobType: z.enum(JOB_TYPES),
    location: text(200),
    compensation: text(500),
    deadline: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .refine((value) => value > new Date(), 'Deadline must be in the future'),
    minimumCgpa: z.number().min(0).max(10).nullable().optional(),
    allowedBranches: z
      .array(text(100))
      .max(50)
      .refine(
        (values) =>
          new Set(values.map((value) => value.toLowerCase())).size ===
          values.length,
        'Branches must be unique',
      )
      .optional(),
    graduationYear: z.number().int().min(1950).max(2100).nullable().optional(),
  })
  .strict();
export const createOpportunitySchema = opportunityFields;
export const updateOpportunitySchema = opportunityFields
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one opportunity field',
  );
export const idSchema = z.string().regex(/^[a-f0-9]{24}$/i);
export const pageSchema = z
  .object({
    after: idSchema.optional(),
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .optional(),
  })
  .strict();
export const controlSchema = z.object({}).strict();

export const studentPageSchema = pageSchema
  .extend({
    jobType: z.enum(JOB_TYPES).optional(),
    location: z.string().trim().min(1).max(200).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    eligibility: z
      .enum(['eligible', 'not_eligible', 'incomplete_profile'])
      .optional(),
  })
  .strict();
