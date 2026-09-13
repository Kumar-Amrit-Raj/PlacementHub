import { createApplicationRouter } from './modules/applications/application.routes.js';
import { createOpportunityRouter } from './modules/opportunities/opportunity.routes.js';
import express from 'express';
import { createProfileRouter } from './modules/profiles/profile.routes.js';
import { createAdminRouter } from './modules/admin/admin.routes.js';
import { isDatabaseReady } from './config/database.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createTokenService } from './modules/auth/token.service.js';

export function createApp({
  databaseReady = isDatabaseReady,
  jwtSecret,
  nodeEnv = 'development',
} = {}) {
  const app = express();
  const tokens = createTokenService(jwtSecret);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/v1/auth', createAuthRouter(tokens, nodeEnv));

  app.use('/api/v1/admin', createAdminRouter(tokens));
  app.use('/api/v1/profiles', createProfileRouter(tokens));
  app.use('/api/v1/opportunities', createOpportunityRouter(tokens));
  app.use('/api/v1/applications', createApplicationRouter(tokens));

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

  app.use((error, _req, res, _next) => {
    const status =
      error.status >= 400 && error.status < 500 ? error.status : 500;
    res.status(status).json({
      error: status === 500 ? 'Internal server error' : 'Invalid request',
    });
  });

  return app;
}
