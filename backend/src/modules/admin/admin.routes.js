import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';

export function createAdminRouter(tokens) {
  const router = Router();
  router.use(authenticate(tokens), authorize('admin'));
  router.get('/access', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok', role: 'admin' });
  });
  return router;
}
