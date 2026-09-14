import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config/env.js';
import { refreshCookieOptions } from '../src/modules/auth/session.cookie.js';
import { errorHandler } from '../src/middleware/error-handler.js';
const jwtSecret = randomBytes(32).toString('hex');
async function serve(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}
test('Helmet and credentialed CORS allow only configured exact origins', async (t) => {
  const origin = 'https://frontend.example.test';
  const base = await serve(
    t,
    createApp({
      jwtSecret,
      allowedOrigins: [origin],
      databaseReady: () => true,
    }),
  );
  const response = await fetch(base + '/api/v1/health', {
    headers: { Origin: origin },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(
    response.headers.get('access-control-allow-credentials'),
    'true',
  );
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(response.headers.get('content-security-policy'));
  const preflight = await fetch(base + '/api/v1/auth/refresh', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'X-CSRF-Protection',
    },
  });
  assert.equal(preflight.status, 204);
  assert.match(
    preflight.headers.get('access-control-allow-headers'),
    /X-CSRF-Protection/,
  );
  for (const untrusted of ['https://frontend.example.test.evil.test', 'null']) {
    const denied = await fetch(base + '/api/v1/auth/login', {
      method: 'POST',
      headers: { Origin: untrusted },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  }
  // Missing header is blocked even when the cross-site origin is trusted.
  const denied = await fetch(base + '/api/v1/auth/refresh', {
    method: 'POST',
    headers: { Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
  });
  assert.equal(denied.status, 403);
  // No cookie: reaching the session handler safely returns 401.
  const allowed = await fetch(base + '/api/v1/auth/refresh', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Sec-Fetch-Site': 'cross-site',
      'X-CSRF-Protection': '1',
    },
  });
  assert.equal(allowed.status, 401);
});
test('rate limiters independently bound API, credentials and session traffic', async (t) => {
  for (const [limits, path, method, first] of [
    [{ api: 1 }, '/api/v1/health', 'GET', 200],
    [{ credentials: 1 }, '/api/v1/auth/login', 'POST', 400],
    [{ auth: 1 }, '/api/v1/auth/refresh', 'POST', 403],
  ]) {
    const base = await serve(
      t,
      createApp({ jwtSecret, rateLimits: limits, databaseReady: () => true }),
    );
    assert.equal((await fetch(base + path, { method })).status, first);
    const response = await fetch(base + path, { method });
    assert.equal(response.status, 429);
    assert.ok(response.headers.get('retry-after'));
    assert.deepEqual(await response.json(), {
      error: 'Too many requests. Please try again later.',
    });
  }
});
test('configuration validates exact HTTPS production origins, cookies and proxy hops', () => {
  const env = {
    MONGODB_URI: 'mongodb://localhost/test',
    JWT_SECRET: jwtSecret,
    NODE_ENV: 'production',
  };
  for (const origin of [
    '*',
    'null',
    'https://example.test/path',
    'http://example.test',
    'https://user:password@example.test',
  ])
    assert.throws(
      () => readConfig({ ...env, CORS_ALLOWED_ORIGINS: origin }),
      /CORS/,
    );
  assert.throws(
    () => readConfig({ ...env, REFRESH_COOKIE_SAME_SITE: 'none' }),
    /SAME_SITE/,
  );
  assert.throws(
    () => readConfig({ ...env, TRUST_PROXY_HOPS: 'true' }),
    /PROXY/,
  );
  const config = readConfig({
    ...env,
    CORS_ALLOWED_ORIGINS: 'https://example.test',
    REFRESH_COOKIE_SAME_SITE: 'none',
    TRUST_PROXY_HOPS: '1',
  });
  assert.equal(config.trustProxy, 1);
  assert.deepEqual(
    refreshCookieOptions(config.nodeEnv, config.cookieSameSite),
    { httpOnly: true, secure: true, sameSite: 'none', path: '/api/v1/auth' },
  );
});
test('unexpected errors log safe context without request or error-message secrets', async (t) => {
  const logs = [];
  const app = express();
  app.use(express.json());
  app.post('/failure/:id', () => {
    throw new Error(
      'secret-password secret-token mongodb://private\n    at secret-forged-frame (private:1:2)',
    );
  });
  app.use(errorHandler({ error: (entry) => logs.push(entry) }));
  const base = await serve(t, app);
  const response = await fetch(
    base + '/failure/private-id?token=secret-query',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-header',
        Cookie: 'secret-cookie',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: 'secret-body' }),
    },
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Internal server error' });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].method, 'POST');
  assert.equal(logs[0].path, '/failure/:id');
  assert.match(logs[0].stack, /security.test.js/);
  assert.doesNotMatch(JSON.stringify(logs), /secret-|private/);
  const malformed = await fetch(base + '/failure/id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: 'Invalid request' });
  assert.equal(logs.length, 1);
});
