import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { loginSchema, registerSchema } from './auth.validation.js';
import { createAuthService } from './auth.service.js';

export function createAuthRouter(tokens) {
  const router = Router();
  const auth = createAuthService(tokens);

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/register', validate(registerSchema), async (req, res, next) => {
    try {
      res.status(201).json(await auth.register(req.body));
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ error: 'Email is already registered' });
      }
      next(error);
    }
  });

  router.post('/login', validate(loginSchema), async (req, res) => {
    const result = await auth.login(req.body);
    if (!result) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    res.json(result);
  });

  return router;
}
