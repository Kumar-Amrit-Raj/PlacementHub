import { Router } from 'express';
import cookieParser from 'cookie-parser';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { loginSchema, registerSchema } from './auth.validation.js';
import { createAuthService } from './auth.service.js';
import { revokeSession } from './session.service.js';
import {
  REFRESH_COOKIE,
  refreshCookieOptions,
  protectSessionMutation,
} from './session.cookie.js';

export function createAuthRouter(tokens, nodeEnv, cookieSameSite) {
  const router = Router();
  const auth = createAuthService(tokens);
  const cookieOptions = refreshCookieOptions(nodeEnv, cookieSameSite);
  router.use(cookieParser());
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  function sendSession(res, result, status = 200) {
    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      ...cookieOptions,
      expires: result.sessionExpiresAt,
    });
    res.status(status).json(result.response);
  }

  router.post('/register', validate(registerSchema), async (req, res, next) => {
    try {
      sendSession(res, await auth.register(req.body), 201);
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ error: 'Email is already registered' });
      }
      next(error);
    }
  });

  router.post('/login', validate(loginSchema), async (req, res) => {
    const result = await auth.login(req.body);
    if (!result)
      return res.status(401).json({ error: 'Invalid email or password' });
    sendSession(res, result);
  });

  router.post('/refresh', protectSessionMutation, async (req, res) => {
    const result = await auth.refresh(req.cookies[REFRESH_COOKIE]);
    if (!result) {
      res.clearCookie(REFRESH_COOKIE, cookieOptions);
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    sendSession(res, result);
  });

  router.post('/logout', protectSessionMutation, async (req, res) => {
    await revokeSession(req.cookies[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    res.sendStatus(204);
  });

  router.get('/me', authenticate(tokens), (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
