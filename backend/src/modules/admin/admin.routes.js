import { Router } from 'express';
import { createCompanyAdminRouter } from './company.routes.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';

export function createAdminRouter(tokens) {
  const router = Router();
  router.use(authenticate(tokens), authorize('admin'));
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use('/companies', createCompanyAdminRouter());
  router.get('/access', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok', role: 'admin' });
  });
  return router;
}
