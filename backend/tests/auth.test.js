import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { User } from '../src/modules/users/user.model.js';
import { authenticate } from '../src/middleware/authenticate.js';
import { authorize } from '../src/middleware/authorize.js';
import {
  createTokenService,
  TOKEN_ISSUER,
  TOKEN_AUDIENCE,
} from '../src/modules/auth/token.service.js';
import { readConfig } from '../src/config/env.js';

import { AuthSession } from '../src/modules/auth/session.model.js';

const jwtSecret = randomBytes(32).toString('hex');
const tokens = createTokenService(jwtSecret);
const password = randomBytes(16).toString('hex');
let mongo;
let server;
let base;

before(
  async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), {
      dbName: 'placementhub_auth_test',
    });
    await Promise.all([User.init(), AuthSession.init()]);
    const app = express();
    // Test-only routes exercise middleware without adding product endpoints.
    app.get('/protected', authenticate(tokens), (req, res) =>
      res.json(req.user),
    );
    app.get('/admin', authenticate(tokens), authorize('admin'), (_req, res) =>
      res.sendStatus(204),
    );
    app.get(
      '/recruiter',
      authenticate(tokens),
      authorize('recruiter', 'admin'),
      (_req, res) => res.sendStatus(204),
    );
    app.get('/unauthenticated', authorize('admin'), (_req, res) =>
      res.sendStatus(204),
    );
    app.use(
      createApp({ jwtSecret, rateLimits: { credentials: 1000, auth: 1000 } }),
    );
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  },
  { timeout: 900000 },
);

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
beforeEach(async () => {
  await User.deleteMany({});
  await AuthSession.deleteMany({});
});

async function post(path, body, headers = {}) {
  const response = await fetch(base + '/api/v1/auth/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
    headers: response.headers,
  };
}
function registration(overrides = {}) {
  return {
    name: 'Test Student',
    email: 'student@example.test',
    password,
    ...overrides,
  };
}
async function get(path, token) {
  return fetch(base + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

test('register stores bcrypt hash, normalizes email, and returns a limited access token', async () => {
  const result = await post(
    'register',
    registration({ email: '  STUDENT@Example.Test ' }),
  );
  assert.equal(result.status, 201);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.body.user.email, 'student@example.test');
  assert.equal(result.body.user.role, 'student');
  assert.deepEqual(Object.keys(result.body.user).sort(), [
    'email',
    'id',
    'name',
    'role',
  ]);
  assert.equal(result.body.expiresIn, 900);
  assert.equal(result.body.tokenType, 'Bearer');
  const user = await User.findOne().select('+passwordHash');
  assert.notEqual(user.passwordHash, password);
  assert.equal(await bcrypt.compare(password, user.passwordHash), true);
  assert.equal(bcrypt.getRounds(user.passwordHash), 12);
  assert.equal((await User.findOne()).passwordHash, undefined);
  assert.equal(user.toJSON().passwordHash, undefined);
  const payload = tokens.verify(result.body.accessToken);
  assert.equal(payload.sub, user.id);
  assert.equal(payload.exp - payload.iat, 900);
  assert.equal((await get('/protected', result.body.accessToken)).status, 200);
});

test('recruiter registration succeeds but admin and mass assignment are rejected', async () => {
  assert.equal(
    (await post('register', registration({ role: 'recruiter' }))).status,
    201,
  );
  for (const extra of [
    { role: 'admin' },
    { role: 'owner' },
    { passwordHash: 'injected' },
    { isAdmin: true },
  ]) {
    assert.equal((await post('register', registration(extra))).status, 400);
  }
  assert.equal(await User.countDocuments(), 1);
});

test('concurrent normalized duplicate registrations produce one user and a 409', async () => {
  const results = await Promise.all([
    post('register', registration()),
    post('register', registration({ email: ' STUDENT@EXAMPLE.TEST ' })),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal(await User.countDocuments(), 1);
});

test('validation rejects malformed bodies, injection, weak and overlong passwords', async () => {
  const invalid = [
    null,
    [],
    {},
    registration({ name: ' ' }),
    registration({ name: 'a'.repeat(101) }),
    registration({ email: 'invalid' }),
    registration({ email: { $ne: null } }),
    registration({ password: 'short' }),
    registration({ password: 12345678 }),
    registration({ password: 'a'.repeat(73) }),
    registration({ password: '🙂'.repeat(19) }),
  ];
  for (const body of invalid)
    assert.equal((await post('register', body)).status, 400);
  assert.equal(await User.countDocuments(), 0);
  assert.equal(
    (await post('login', { email: { $ne: null }, password })).status,
    400,
  );
  const malformed = await fetch(base + '/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 400);
});

test('login accepts normalized email and rejects incorrect or unknown credentials identically', async () => {
  await post('register', registration());
  const result = await post('login', {
    email: ' STUDENT@EXAMPLE.TEST ',
    password,
  });
  assert.equal(result.status, 200);
  assert.equal(tokens.verify(result.body.accessToken).role, 'student');
  assert.equal(result.body.user.passwordHash, undefined);
  const wrong = await post('login', {
    email: 'student@example.test',
    password: 'incorrect-password',
  });
  const unknown = await post('login', {
    email: 'unknown@example.test',
    password,
  });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
});

test('authentication rejects missing, malformed, forged, expired and inappropriate tokens', async () => {
  const result = await post('register', registration());
  const userId = result.body.user.id;
  const options = {
    subject: userId,
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    expiresIn: 900,
  };
  const invalidTokens = [
    'not-a-jwt',
    jwt.sign({}, randomBytes(32).toString('hex'), options),
    jwt.sign({}, jwtSecret, { ...options, expiresIn: -1 }),
    jwt.sign({}, jwtSecret, { ...options, audience: 'other-app' }),
    jwt.sign({}, jwtSecret, { ...options, issuer: 'other-issuer' }),
    jwt.sign({}, jwtSecret, { ...options, algorithm: 'HS384' }),
    jwt.sign({}, jwtSecret, { ...options, subject: 'not-an-object-id' }),
    jwt.sign({}, jwtSecret, {
      subject: userId,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    }),
  ];
  assert.equal((await get('/protected')).status, 401);
  for (const token of invalidTokens)
    assert.equal((await get('/protected', token)).status, 401);
  assert.equal(
    (
      await fetch(base + '/protected', {
        headers: { Authorization: 'Basic abc' },
      })
    ).status,
    401,
  );
});

test('role checks use the current database role and reject deleted accounts', async () => {
  const result = await post('register', registration());
  const token = result.body.accessToken;
  assert.equal((await get('/admin', token)).status, 403);
  assert.equal((await get('/recruiter', token)).status, 403);
  assert.equal((await get('/unauthenticated')).status, 401);
  await User.updateOne({ _id: result.body.user.id }, { role: 'admin' });
  assert.equal((await get('/admin', token)).status, 204);
  await User.updateOne({ _id: result.body.user.id }, { role: 'recruiter' });
  assert.equal((await get('/recruiter', token)).status, 204);
  assert.equal((await get('/admin', token)).status, 403);
  await User.deleteMany({});
  assert.equal((await get('/protected', token)).status, 401);
});

test('User model and auth configuration reject invalid roles and missing secrets', async () => {
  const invalid = new User({
    name: 'Test',
    email: 'test@example.test',
    passwordHash: 'test-only',
    role: 'owner',
  });
  await assert.rejects(invalid.validate(), /role/);
  for (const JWT_SECRET of [undefined, '', 'short', ' '.repeat(32)]) {
    assert.throws(
      () => readConfig({ MONGODB_URI: 'mongodb://localhost/test', JWT_SECRET }),
      /JWT_SECRET/,
    );
    assert.throws(() => createTokenService(JWT_SECRET), /JWT_SECRET/);
  }
  assert.throws(() => authorize(), /valid allowed roles/);
  assert.throws(() => authorize('owner'), /valid allowed roles/);
});

function cookieFrom(result) {
  return result.headers.get('set-cookie').split(';')[0];
}
async function sessionRequest(path, cookie, extraHeaders = {}) {
  return post(
    path,
    {},
    {
      'X-CSRF-Protection': '1',
      ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders,
    },
  );
}

test('refresh cookie is HTTP-only and server stores only digests', async () => {
  const registered = await post('register', registration());
  const header = registered.headers.get('set-cookie');
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Strict/i);
  assert.match(header, /Path=\/api\/v1\/auth/i);
  assert.doesNotMatch(header, /; Secure/i);
  assert.equal(registered.body.refreshToken, undefined);
  const raw = cookieFrom(registered).split('=')[1];
  const session = await AuthSession.findOne().select('+tokenHash +spentHashes');
  assert.equal(session.tokenHash.length, 64);
  assert.equal(JSON.stringify(session).includes(raw), false);
  const current = await get('/api/v1/auth/me', registered.body.accessToken);
  assert.equal(current.status, 200);
  assert.deepEqual((await current.json()).user, registered.body.user);
  assert.equal((await get('/api/v1/auth/me')).status, 401);
});

test('production cookies are Secure and clear with the same attributes', async (t) => {
  const production = createApp({
    jwtSecret,
    nodeEnv: 'production',
    rateLimits: { credentials: 1000, auth: 1000 },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => production.once('listening', resolve));
  t.after(() => new Promise((resolve) => production.close(resolve)));
  const url = `http://127.0.0.1:${production.address().port}/api/v1/auth`;
  const registered = await fetch(url + '/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(registration()),
  });
  assert.match(registered.headers.get('set-cookie'), /; Secure/i);
  const loggedOut = await fetch(url + '/logout', {
    method: 'POST',
    headers: {
      'X-CSRF-Protection': '1',
      Cookie: registered.headers.get('set-cookie').split(';')[0],
    },
  });
  assert.equal(loggedOut.status, 204);
  assert.match(loggedOut.headers.get('set-cookie'), /; Secure/i);
  assert.match(loggedOut.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(loggedOut.headers.get('set-cookie'), /SameSite=Strict/i);
});

test('rotation replaces cookies, preserves absolute expiry, and uses current user details', async () => {
  const registered = await post('register', registration());
  const originalExpiry = (await AuthSession.findOne()).expiresAt.getTime();
  await User.updateOne({}, { role: 'recruiter' });
  const refreshed = await sessionRequest('refresh', cookieFrom(registered));
  assert.equal(refreshed.status, 200);
  assert.notEqual(cookieFrom(refreshed), cookieFrom(registered));
  assert.notEqual(refreshed.body.accessToken, registered.body.accessToken);
  assert.equal(refreshed.body.user.role, 'recruiter');
  assert.equal(refreshed.body.expiresIn, 900);
  assert.equal(
    (await AuthSession.findOne()).expiresAt.getTime(),
    originalExpiry,
  );
  assert.equal(
    (await get('/api/v1/auth/me', refreshed.body.accessToken)).status,
    200,
  );
  const expiredAccess = jwt.sign(
    { sid: tokens.verify(refreshed.body.accessToken).sid },
    jwtSecret,
    {
      subject: registered.body.user.id,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      expiresIn: -1,
    },
  );
  assert.equal((await get('/api/v1/auth/me', expiredAccess)).status, 401);
  assert.equal(
    (await sessionRequest('refresh', cookieFrom(refreshed))).status,
    200,
  );
});

test('replay revokes the whole session including successor refresh and access tokens', async () => {
  const registered = await post('register', registration());
  const first = await sessionRequest('refresh', cookieFrom(registered));
  const second = await sessionRequest('refresh', cookieFrom(first));
  assert.equal(second.status, 200);
  const replay = await sessionRequest('refresh', cookieFrom(registered));
  assert.equal(replay.status, 401);
  assert.match(replay.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/i);
  assert.equal(
    (await sessionRequest('refresh', cookieFrom(second))).status,
    401,
  );
  assert.equal(
    (await get('/api/v1/auth/me', registered.body.accessToken)).status,
    401,
  );
  assert.equal(
    (await get('/api/v1/auth/me', second.body.accessToken)).status,
    401,
  );
});

test('simultaneous refresh allows one rotation and revokes that session on reuse', async () => {
  const registered = await post('register', registration());
  const results = await Promise.all([
    sessionRequest('refresh', cookieFrom(registered)),
    sessionRequest('refresh', cookieFrom(registered)),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 401]);
  const winner = results.find((result) => result.status === 200);
  assert.equal(
    (await get('/api/v1/auth/me', winner.body.accessToken)).status,
    401,
  );
  assert.equal(
    (await sessionRequest('refresh', cookieFrom(winner))).status,
    401,
  );
});

test('logout is idempotent and revokes only the supplied session', async () => {
  const first = await post('register', registration());
  const other = await post('login', { email: registration().email, password });
  assert.ok(other.headers.get('set-cookie'));
  const rotated = await sessionRequest('refresh', cookieFrom(first));
  // An older, issued cookie can still revoke its family.
  assert.equal((await sessionRequest('logout', cookieFrom(first))).status, 204);
  assert.equal((await sessionRequest('logout', cookieFrom(first))).status, 204);
  assert.equal((await sessionRequest('logout')).status, 204);
  assert.equal(
    (await get('/api/v1/auth/me', rotated.body.accessToken)).status,
    401,
  );
  assert.equal(
    (await sessionRequest('refresh', cookieFrom(rotated))).status,
    401,
  );
  assert.equal(
    (await get('/api/v1/auth/me', other.body.accessToken)).status,
    200,
  );
  assert.equal(
    (await sessionRequest('refresh', cookieFrom(other))).status,
    200,
  );
});

test('expiry and rotation limit fail closed without waiting for TTL cleanup', async () => {
  const registered = await post('register', registration());
  await AuthSession.updateOne({}, { expiresAt: new Date(Date.now() - 1000) });
  assert.equal(
    (await get('/api/v1/auth/me', registered.body.accessToken)).status,
    401,
  );
  assert.equal(
    (await sessionRequest('refresh', cookieFrom(registered))).status,
    401,
  );
  const login = await post('login', { email: registration().email, password });
  await AuthSession.updateOne(
    { _id: tokens.verify(login.body.accessToken).sid },
    { rotationCount: 4096 },
  );
  assert.equal(
    (await sessionRequest('refresh', cookieFrom(login))).status,
    401,
  );
  assert.equal(
    (await get('/api/v1/auth/me', login.body.accessToken)).status,
    401,
  );
});

test('session mutations reject CSRF and malformed cookies without revoking valid sessions', async () => {
  const registered = await post('register', registration());
  const cookie = cookieFrom(registered);
  for (const path of ['refresh', 'logout']) {
    assert.equal((await post(path, {}, { Cookie: cookie })).status, 403);
    assert.equal(
      (await sessionRequest(path, cookie, { 'Sec-Fetch-Site': 'cross-site' }))
        .status,
      403,
    );
  }
  for (const cookieValue of [
    undefined,
    'placementhub_refresh=broken',
    'placementhub_refresh=%E0%A4%A',
  ]) {
    assert.equal((await sessionRequest('refresh', cookieValue)).status, 401);
  }
  const forged = cookie.slice(0, cookie.lastIndexOf('.') + 1) + 'a'.repeat(64);
  assert.equal((await sessionRequest('refresh', forged)).status, 401);
  assert.equal((await sessionRequest('logout', forged)).status, 204);
  assert.equal(
    (await get('/api/v1/auth/me', registered.body.accessToken)).status,
    200,
  );
  assert.equal((await sessionRequest('refresh', cookie)).status, 200);
});

test('deleted users cannot refresh and their session is revoked', async () => {
  const registered = await post('register', registration());
  await User.deleteMany({});
  assert.equal(
    (await sessionRequest('refresh', cookieFrom(registered))).status,
    401,
  );
  assert.ok((await AuthSession.findOne()).revokedAt);
});
