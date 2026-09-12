import express from 'express';
import { isDatabaseReady } from './config/database.js';

export function createApp({ databaseReady = isDatabaseReady } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

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
