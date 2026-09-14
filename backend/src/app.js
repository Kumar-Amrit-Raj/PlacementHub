import { createApplicationRouter } from './modules/applications/application.routes.js';
import { createOpportunityRouter } from './modules/opportunities/opportunity.routes.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { errorHandler } from './middleware/error-handler.js';
import { createProfileRouter } from './modules/profiles/profile.routes.js';
import { createAdminRouter } from './modules/admin/admin.routes.js';
import { isDatabaseReady } from './config/database.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createTokenService } from './modules/auth/token.service.js';

export function createApp({
  databaseReady = isDatabaseReady,
  jwtSecret,
  nodeEnv = 'development',
  allowedOrigins = [],
  cookieSameSite = 'strict',
  trustProxy = 0,
  logger = console,
  rateLimits = {},
} = {}) {
  const app = express();
  const tokens = createTokenService(jwtSecret);
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.locals.allowedOrigins = allowedOrigins;
  app.use(helmet());
  app.use(
    cors((req, callback) => {
      const origin = req.get('Origin');
      if (origin === req.protocol + '://' + req.get('Host'))
        return callback(null, { origin: false });
      const options = {
        origin(origin, callback) {
          if (!origin || allowedOrigins.includes(origin))
            return callback(null, Boolean(origin));
          const error = new Error('Origin not allowed');
          error.status = 403;
          callback(error);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Protection'],
        maxAge: 600,
      };
      callback(null, options);
    }),
  );
  const limiter = (limit, windowMs) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please try again later.' },
    });
  app.use('/api/v1', limiter(rateLimits.api ?? 300, 60 * 1000));
  app.use(
    '/api/v1/auth',
    (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    },
    limiter(rateLimits.auth ?? 60, 15 * 60 * 1000),
  );
  app.use(
    ['/api/v1/auth/login', '/api/v1/auth/register'],
    limiter(rateLimits.credentials ?? 10, 15 * 60 * 1000),
  );
  app.use(express.json({ limit: '100kb' }));
  mount('/api/v1/auth', createAuthRouter(tokens, nodeEnv, cookieSameSite));

  mount('/api/v1/admin', createAdminRouter(tokens));
  mount('/api/v1/profiles', createProfileRouter(tokens));
  mount('/api/v1/opportunities', createOpportunityRouter(tokens));
  mount('/api/v1/applications', createApplicationRouter(tokens));

  function mount(path, router) {
    app.use(path, router, (error, req, res, next) => {
      res.locals.errorPath = path + (req.route?.path || '');
      next(error);
    });
  }

  app.get('/api/v1/health', (_req, res) => {
    const ready = databaseReady();
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'unavailable',
      service: 'placementhub-api',
      database: ready ? 'connected' : 'disconnected',
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(errorHandler(logger));

  return app;
}
