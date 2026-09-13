import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { RecruiterProfile } from '../profiles/recruiter-profile.model.js';
import {
  decideCompany,
  pendingFilter,
  ApprovalError,
} from '../profiles/company-approval.service.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
const querySchema = z
  .object({
    after: objectId.optional(),
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .optional(),
  })
  .strict();
const decisionSchema = (reject) =>
  z
    .object({
      expectedVersion: z.number().int().min(0),
      reason: reject
        ? z.string().trim().min(1).max(1000)
        : z.string().trim().max(1000).optional(),
    })
    .strict();

// Mounted behind authenticate + authorize('admin') by the admin router.
export function createCompanyAdminRouter() {
  const router = Router();
  router.get('/pending', async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ error: 'Invalid pagination parameters' });
    const { after, limit = 20 } = parsed.data;
    const profiles = await RecruiterProfile.find({
      ...pendingFilter,
      ...(after ? { _id: { $gt: after } } : {}),
    })
      .sort({ _id: 1 })
      .limit(limit + 1);
    const more = profiles.length > limit;
    const companies = profiles.slice(0, limit);
    res.json({ companies, nextCursor: more ? companies.at(-1).id : null });
  });
  router.param('id', (req, res, next, id) => {
    if (!objectId.safeParse(id).success)
      return res.status(400).json({ error: 'Invalid company profile ID' });
    next();
  });
  router.get('/:id', async (req, res) => {
    const company = await RecruiterProfile.findById(req.params.id).select(
      '+approvalHistory',
    );
    if (!company)
      return res.status(404).json({ error: 'Company profile not found' });
    res.json({ company });
  });
  for (const [action, status] of [
    ['approve', 'approved'],
    ['reject', 'rejected'],
  ]) {
    router.post(
      '/:' + 'id/' + action,
      validate(decisionSchema(action === 'reject')),
      async (req, res, next) => {
        try {
          res.json({
            company: await decideCompany(
              req.params.id,
              req.user.id,
              status,
              req.body,
            ),
          });
        } catch (error) {
          if (error instanceof ApprovalError)
            return res.status(error.status).json({ error: error.message });
          next(error);
        }
      },
    );
  }
  return router;
}
