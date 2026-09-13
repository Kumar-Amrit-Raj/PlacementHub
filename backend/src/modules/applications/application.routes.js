import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import {
  idSchema,
  pageSchema,
} from '../opportunities/opportunity.validation.js';
import {
  ownCompany,
  OpportunityError,
} from '../opportunities/opportunity.service.js';
import { Opportunity } from '../opportunities/opportunity.model.js';
import { Application, APPLICATION_STATUSES } from './application.model.js';
import {
  applyForOpportunity,
  updateApplicationStatus,
  ApplicationError,
} from './application.service.js';
const createSchema = z.object({ opportunityId: idSchema }).strict();
const statusSchema = z
  .object({
    status: z.enum(APPLICATION_STATUSES),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
const recruiterQuery = pageSchema
  .extend({ opportunityId: idSchema.optional() })
  .strict();
async function list(filter, page) {
  const { limit = 20, after } = page;
  const results = await Application.find({
    ...filter,
    ...(after ? { _id: { $gt: after } } : {}),
  })
    .sort({ _id: 1 })
    .limit(limit + 1);
  return {
    applications: results.slice(0, limit),
    nextCursor: results.length > limit ? results[limit - 1].id : null,
  };
}
export function createApplicationRouter(tokens) {
  const router = Router();
  router.use(authenticate(tokens));
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.post(
    '/',
    authorize('student'),
    validate(createSchema),
    async (req, res) => {
      res.status(201).json({
        application: await applyForOpportunity(
          req.user,
          req.body.opportunityId,
        ),
      });
    },
  );
  router.get('/mine', authorize('student'), async (req, res) => {
    const parsed = pageSchema.safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ error: 'Invalid pagination parameters' });
    res.json(await list({ student: req.user.id }, parsed.data));
  });
  router.get('/company', authorize('recruiter'), async (req, res) => {
    const parsed = recruiterQuery.safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ error: 'Invalid application filters' });
    const company = await ownCompany(req.user.id);
    if (
      parsed.data.opportunityId &&
      !(await Opportunity.exists({
        _id: parsed.data.opportunityId,
        company: company._id,
      }))
    )
      throw new ApplicationError('Opportunity not found', 404);
    res.json(
      await list(
        {
          company: company._id,
          ...(parsed.data.opportunityId
            ? { opportunity: parsed.data.opportunityId }
            : {}),
        },
        parsed.data,
      ),
    );
  });
  router.patch(
    '/:id/status',
    authorize('recruiter'),
    validate(statusSchema),
    async (req, res) => {
      if (!idSchema.safeParse(req.params.id).success)
        return res.status(400).json({ error: 'Invalid application ID' });
      const company = await ownCompany(req.user.id);
      res.json({
        application: await updateApplicationStatus(
          req.params.id,
          company._id,
          req.user.id,
          req.body,
        ),
      });
    },
  );
  router.use((error, _req, res, next) => {
    if (error instanceof ApplicationError || error instanceof OpportunityError)
      return res.status(error.status).json({
        error: error.message,
        ...(error.eligibility ? { eligibility: error.eligibility } : {}),
      });
    next(error);
  });
  return router;
}
