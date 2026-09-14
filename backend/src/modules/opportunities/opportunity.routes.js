import { Application } from '../applications/application.model.js';
import { StudentProfile } from '../profiles/student-profile.model.js';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { Opportunity } from './opportunity.model.js';
import {
  OpportunityError,
  ownCompany,
  changeOpportunity,
  publishedOpportunities,
} from './opportunity.service.js';
import {
  createOpportunitySchema,
  updateOpportunitySchema,
  controlSchema,
  idSchema,
  pageSchema,
  studentPageSchema,
} from './opportunity.validation.js';

function pagination(req, res, next) {
  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ error: 'Invalid pagination parameters' });
  req.page = { limit: 20, ...parsed.data };
  next();
}
function pageResult(opportunities, limit) {
  const more = opportunities.length > limit;
  const items = opportunities.slice(0, limit);
  return {
    opportunities: items,
    nextCursor: more ? String(items.at(-1)._id) : null,
  };
}
export function createOpportunityRouter(tokens) {
  const router = Router();
  router.use(authenticate(tokens));
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.param('id', (req, res, next, id) => {
    if (!idSchema.safeParse(id).success)
      return res.status(400).json({ error: 'Invalid opportunity ID' });
    next();
  });
  router.get('/mine', authorize('recruiter'), pagination, async (req, res) => {
    const company = await ownCompany(req.user.id);
    const { after, limit } = req.page;
    const records = await Opportunity.find({
      company: company._id,
      ...(after ? { _id: { $gt: after } } : {}),
    })
      .sort({ _id: 1 })
      .limit(limit + 1);
    res.json(pageResult(records, limit));
  });
  router.get('/mine/:id', authorize('recruiter'), async (req, res) => {
    const company = await ownCompany(req.user.id);
    const opportunity = await Opportunity.findOne({
      _id: req.params.id,
      company: company._id,
    });
    if (!opportunity) throw new OpportunityError('Opportunity not found', 404);
    res.json({ opportunity });
  });
  router.post(
    '/',
    authorize('recruiter'),
    validate(createOpportunitySchema),
    async (req, res) => {
      const company = await ownCompany(req.user.id);
      res.status(201).json({
        opportunity: await Opportunity.create({
          ...req.body,
          company: company._id,
        }),
      });
    },
  );
  router.patch(
    '/:id',
    authorize('recruiter'),
    validate(updateOpportunitySchema),
    async (req, res) => {
      const company = await ownCompany(req.user.id);
      res.json({
        opportunity: await changeOpportunity(
          req.params.id,
          company,
          'update',
          req.body,
        ),
      });
    },
  );
  for (const action of ['publish', 'unpublish']) {
    router.post(
      '/:id/' + action,
      authorize('recruiter'),
      (req, _res, next) => {
        req.body ??= {};
        next();
      },
      validate(controlSchema),
      async (req, res) => {
        const company = await ownCompany(req.user.id);
        res.json({
          opportunity: await changeOpportunity(req.params.id, company, action),
        });
      },
    );
  }
  router.get('/', authorize('student'), async (req, res) => {
    const parsed = studentPageSchema.safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({
        error: 'Invalid opportunity filters or pagination parameters',
      });
    req.page = { limit: 20, ...parsed.data };
    const profile = await StudentProfile.findOne({ user: req.user.id }).lean();
    res.json(
      pageResult(
        await publishedOpportunities({ ...req.page, profile }),
        req.page.limit,
      ),
    );
  });
  router.get('/:id', authorize('student'), async (req, res) => {
    const profile = await StudentProfile.findOne({ user: req.user.id }).lean();
    const [opportunity] = await publishedOpportunities({
      id: req.params.id,
      profile,
    });
    if (!opportunity) throw new OpportunityError('Opportunity not found', 404);
    opportunity.hasApplied = Boolean(
      await Application.exists({
        student: req.user.id,
        opportunity: opportunity._id,
      }),
    );
    res.json({ opportunity });
  });
  router.use((error, _req, res, next) => {
    if (error instanceof OpportunityError)
      return res.status(error.status).json({ error: error.message });
    next(error);
  });
  return router;
}
