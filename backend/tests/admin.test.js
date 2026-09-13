import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { User } from '../src/modules/users/user.model.js';
import { AuthSession } from '../src/modules/auth/session.model.js';
import { provisionInitialAdmin } from '../src/modules/admin/provision.service.js';
import { readCredentials } from '../scripts/provision-admin.js';
import {
  TOKEN_ISSUER,
  TOKEN_AUDIENCE,
} from '../src/modules/auth/token.service.js';

const jwtSecret = randomBytes(32).toString('hex');
const password = randomBytes(16).toString('hex');
const credentials = (extra = {}) => ({
  name: 'Initial Admin',
  email: 'admin@example.test',
  password,
  ...extra,
});
let mongo, server, base;

before(
  async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), {
      dbName: 'placementhub_admin_test',
    });
    await Promise.all([User.init(), AuthSession.init()]);
    server = createApp({ jwtSecret }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
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

async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const access = (token) =>
  fetch(base + '/api/v1/admin/access', {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });

function runCli(input, args = ['--stdin'], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL('../scripts/provision-admin.js', import.meta.url),
        ),
        ...args,
      ],
      {
        env: {
          ...process.env,
          MONGODB_URI: mongo.getUri('placementhub_admin_test'),
          JWT_SECRET: jwtSecret,
          NODE_ENV: 'test',
          ...env,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

test('initial provisioning normalizes email, hashes password, and hides bootstrap metadata', async () => {
  const result = await provisionInitialAdmin(
    credentials({ email: ' ADMIN@Example.Test ' }),
  );
  assert.equal(result.role, 'admin');
  assert.equal(result.email, 'admin@example.test');
  assert.deepEqual(Object.keys(result).sort(), ['email', 'id', 'name', 'role']);
  const stored = await User.findById(result.id).select(
    '+passwordHash +bootstrapKey',
  );
  assert.equal(await bcrypt.compare(password, stored.passwordHash), true);
  assert.equal(bcrypt.getRounds(stored.passwordHash), 12);
  assert.equal(stored.bootstrapKey, 'initial-admin');
  assert.equal(stored.toJSON().bootstrapKey, undefined);
  assert.equal((await User.findById(result.id)).bootstrapKey, undefined);
});

test('repeated provisioning refuses to reset an admin or create another', async () => {
  const original = await provisionInitialAdmin(credentials());
  for (const email of ['admin@example.test', 'another@example.test']) {
    await assert.rejects(
      provisionInitialAdmin(credentials({ email })),
      /admin already exists/,
    );
  }
  assert.equal(await User.countDocuments({ role: 'admin' }), 1);
  assert.equal(
    await bcrypt.compare(
      password,
      (await User.findById(original.id).select('+passwordHash')).passwordHash,
    ),
    true,
  );
});

test('existing non-admin accounts cannot be promoted by initial provisioning', async () => {
  await post('/api/v1/auth/register', { ...credentials(), role: 'student' });
  await assert.rejects(
    provisionInitialAdmin(credentials()),
    /No account was changed/,
  );
  assert.equal((await User.findOne()).role, 'student');
  assert.equal(await User.countDocuments(), 1);
});

test('concurrent first-admin attempts create exactly one admin', async () => {
  const results = await Promise.allSettled([
    provisionInitialAdmin(credentials()),
    provisionInitialAdmin(credentials({ email: 'other@example.test' })),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(await User.countDocuments({ role: 'admin' }), 1);
});

test('demoting the bootstrap admin does not reopen initial provisioning', async () => {
  await provisionInitialAdmin(credentials());
  await User.updateOne({}, { role: 'student' });
  await assert.rejects(
    provisionInitialAdmin(credentials({ email: 'other@example.test' })),
    /already used/,
  );
  assert.equal(await User.countDocuments(), 1);
});

test('invalid credentials and unexpected fields never create users', async () => {
  for (const input of [
    {},
    credentials({ password: 'short' }),
    credentials({ password: '🙂'.repeat(19) }),
    credentials({ name: ' ' }),
    credentials({ email: 'invalid' }),
    credentials({ role: 'admin' }),
    credentials({ bootstrapKey: 'initial-admin' }),
  ])
    await assert.rejects(provisionInitialAdmin(input), /Provide only/);
  assert.equal(await User.countDocuments(), 0);
});

test('public registration rejects admin role and bootstrap key injection', async () => {
  for (const extra of [{ role: 'admin' }, { bootstrapKey: 'initial-admin' }]) {
    assert.equal(
      (await post('/api/v1/auth/register', { ...credentials(), ...extra }))
        .status,
      400,
    );
  }
  assert.equal(await User.countDocuments(), 0);
});

test('admin access denies anonymous, student, recruiter, and forged role claims', async () => {
  assert.equal((await access()).status, 401);
  for (const role of ['student', 'recruiter']) {
    const registered = await post('/api/v1/auth/register', {
      ...credentials({ email: role + '@example.test' }),
      role,
    });
    assert.equal(registered.status, 201);
    const token = registered.body.accessToken;
    assert.equal((await access(token)).status, 403);
    const payload = jwt.decode(token);
    const forgedRole = jwt.sign(
      { sid: payload.sid, role: 'admin' },
      jwtSecret,
      {
        subject: payload.sub,
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        expiresIn: 900,
      },
    );
    assert.equal((await access(forgedRole)).status, 403);
  }
});

test('provisioned admin logs in normally; demotion and revocation immediately block admin access', async () => {
  const admin = await provisionInitialAdmin(credentials());
  const login = await post('/api/v1/auth/login', {
    email: admin.email,
    password,
  });
  assert.equal(login.status, 200);
  const token = login.body.accessToken;
  const permitted = await access(token);
  assert.equal(permitted.status, 200);
  assert.equal(permitted.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await permitted.json(), { status: 'ok', role: 'admin' });
  await User.updateOne({ _id: admin.id }, { role: 'student' });
  assert.equal((await access(token)).status, 403);
  await User.updateOne({ _id: admin.id }, { role: 'admin' });
  await AuthSession.updateMany({}, { revokedAt: new Date() });
  assert.equal((await access(token)).status, 401);
});

test('CLI provisions through stdin and does not print credentials', async () => {
  const result = await runCli(JSON.stringify(credentials()));
  assert.equal(result.code, 0);
  assert.match(result.output, /Initial admin created/);
  assert.equal(result.output.includes(password), false);
  assert.equal(result.output.includes(jwtSecret), false);
  assert.equal(await User.countDocuments({ role: 'admin' }), 1);
  const repeat = await runCli(JSON.stringify(credentials()));
  assert.equal(repeat.code, 1);
});

test('CLI rejects unsafe arguments, invalid input, and bad config without leaking values', async () => {
  const results = [
    await runCli('', ['--password=' + password]),
    await runCli('invalid JSON ' + password),
    await runCli(JSON.stringify(credentials()), ['--stdin'], {
      MONGODB_URI: 'invalid-' + password,
    }),
  ];
  for (const result of results) {
    assert.equal(result.code, 1);
    assert.equal(result.output.includes(password), false);
    assert.equal(result.output.includes(jwtSecret), false);
  }
  assert.equal(await User.countDocuments(), 0);
});

test('stdin reader rejects oversized or terminal input and accepts UTF-8 BOM', async () => {
  await assert.rejects(
    readCredentials(Readable.from(['a'.repeat(8193)])),
    /8 KiB/,
  );
  const terminal = Readable.from([]);
  terminal.isTTY = true;
  await assert.rejects(readCredentials(terminal), /standard input/);
  assert.equal(
    (
      await readCredentials(
        Readable.from(['\uFEFF' + JSON.stringify(credentials())]),
      )
    ).email,
    credentials().email,
  );
});
