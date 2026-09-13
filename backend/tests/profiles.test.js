import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { User } from '../src/modules/users/user.model.js';
import { AuthSession } from '../src/modules/auth/session.model.js';
import { createSession } from '../src/modules/auth/session.service.js';
import { createTokenService } from '../src/modules/auth/token.service.js';
import { StudentProfile } from '../src/modules/profiles/student-profile.model.js';
import { RecruiterProfile } from '../src/modules/profiles/recruiter-profile.model.js';

const jwtSecret = randomBytes(32).toString('hex');
const tokens = createTokenService(jwtSecret);
let mongo, server, base, identities;

before(
  async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), {
      dbName: 'placementhub_profiles_test',
    });
    await Promise.all([
      User.init(),
      AuthSession.init(),
      StudentProfile.init(),
      RecruiterProfile.init(),
    ]);
    server = createApp({ jwtSecret }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port + '/api/v1/profiles';
  },
  { timeout: 900000 },
);
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    AuthSession.deleteMany({}),
    StudentProfile.deleteMany({}),
    RecruiterProfile.deleteMany({}),
  ]);
  identities = {};
  for (const [key, role] of [
    ['student', 'student'],
    ['otherStudent', 'student'],
    ['recruiter', 'recruiter'],
    ['otherRecruiter', 'recruiter'],
    ['admin', 'admin'],
  ]) {
    // Authentication fixtures, no login/password handling is exercised here.
    const user = await User.create({
      name: key,
      email: key.toLowerCase() + '@example.test',
      role,
      passwordHash: 'unused-test-fixture',
    });
    const { session } = await createSession(user);
    identities[key] = { user, session, token: tokens.sign(user, session.id) };
  }
});

async function request(
  role,
  method = 'GET',
  body,
  identity = role,
  suffix = '/me',
) {
  const res = await fetch(base + '/' + role + suffix, {
    method,
    headers: {
      ...(identity
        ? { Authorization: 'Bearer ' + identities[identity].token }
        : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

test('missing profiles return null without creating records', async () => {
  for (const role of ['student', 'recruiter']) {
    const result = await request(role);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { profile: null });
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
  assert.equal(await StudentProfile.countDocuments(), 0);
  assert.equal(await RecruiterProfile.countDocuments(), 0);
});

test('student profile saves, normalizes, preserves omitted fields, and clears optional values', async () => {
  const created = await request('student', 'PATCH', {
    institution: ' Example University ',
    degree: 'B.Tech',
    branch: 'Computer Science',
    graduationYear: 2027,
    cgpa: 8.5,
    skills: [' JavaScript ', 'React'],
    bio: ' Student bio ',
    location: 'Pune',
    phone: '+91 12345 67890',
    portfolioUrl: 'https://example.test/portfolio',
    linkedinUrl: '',
    githubUrl: 'https://github.com/example',
  });
  assert.equal(created.status, 200);
  const profile = created.body.profile;
  assert.equal(profile.user, identities.student.user.id);
  assert.equal(profile.institution, 'Example University');
  assert.deepEqual(profile.skills, ['JavaScript', 'React']);
  assert.equal(profile.__v, undefined);
  const updated = await request('student', 'PATCH', {
    bio: '',
    cgpa: null,
    graduationYear: null,
    skills: [],
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.profile._id, profile._id);
  assert.equal(updated.body.profile.degree, 'B.Tech');
  assert.equal(updated.body.profile.cgpa, null);
  assert.equal(updated.body.profile.bio, '');
  assert.deepEqual(updated.body.profile.skills, []);
  assert.deepEqual(
    (await request('student')).body.profile,
    updated.body.profile,
  );
  assert.equal(await StudentProfile.countDocuments(), 1);
});

test('recruiter owns one company draft and can update company and contact fields', async () => {
  const created = await request('recruiter', 'PATCH', {
    companyName: ' Example Labs ',
    website: 'https://example.test',
    industry: 'Software',
    companySize: '11-50',
    description: 'Engineering team',
    headquarters: 'Bengaluru',
    recruiterTitle: 'Hiring Manager',
    phone: '+91 12345 67890',
    contactEmail: ' HIRING@EXAMPLE.TEST ',
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.profile.companyName, 'Example Labs');
  assert.equal(created.body.profile.contactEmail, 'hiring@example.test');
  const updated = await request('recruiter', 'PATCH', {
    website: '',
    companySize: null,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.profile._id, created.body.profile._id);
  assert.equal(updated.body.profile.companyName, 'Example Labs');
  assert.equal(updated.body.profile.companySize, null);
  assert.equal(await RecruiterProfile.countDocuments(), 1);
  assert.equal(
    (await request('recruiter')).body.profile.user,
    identities.recruiter.user.id,
  );
});

test('anonymous callers and wrong roles cannot read or edit either profile type', async () => {
  for (const role of ['student', 'recruiter']) {
    const body =
      role === 'student' ? { bio: 'private' } : { companyName: 'private' };
    for (const method of ['GET', 'PATCH']) {
      assert.equal(
        (
          await request(
            role,
            method,
            method === 'PATCH' ? body : undefined,
            null,
          )
        ).status,
        401,
      );
      for (const identity of [
        role === 'student' ? 'recruiter' : 'student',
        'admin',
      ]) {
        assert.equal(
          (
            await request(
              role,
              method,
              method === 'PATCH' ? body : undefined,
              identity,
            )
          ).status,
          403,
        );
      }
    }
  }
  assert.equal(await StudentProfile.countDocuments(), 0);
  assert.equal(await RecruiterProfile.countDocuments(), 0);
});

test('same-role accounts cannot read or modify each other via IDs, query parameters, or body ownership fields', async () => {
  for (const [role, other, Model, field] of [
    ['student', 'otherStudent', StudentProfile, 'bio'],
    ['recruiter', 'otherRecruiter', RecruiterProfile, 'companyName'],
  ]) {
    await request(role, 'PATCH', { [field]: 'owner data' });
    assert.equal(
      (await request(role, 'GET', undefined, other)).body.profile,
      null,
    );
    const attacker = await request(
      role,
      'PATCH',
      { [field]: 'other data' },
      other,
      '/me?user=' + identities[role].user.id,
    );
    assert.equal(attacker.status, 200);
    assert.equal(attacker.body.profile.user, identities[other].user.id);
    for (const injection of [
      { user: identities[role].user.id },
      { userId: identities[role].user.id },
      { _id: attacker.body.profile._id },
    ]) {
      assert.equal(
        (
          await request(
            role,
            'PATCH',
            { [field]: 'tampered', ...injection },
            other,
          )
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await request(
          role,
          'GET',
          undefined,
          other,
          '/' + identities[role].user.id,
        )
      ).status,
      404,
    );
    assert.equal((await request(role)).body.profile[field], 'owner data');
    assert.equal(await Model.countDocuments(), 2);
  }
});

test('student validation rejects invalid types, ranges, duplicate skills, unsafe URLs and mass assignment', async () => {
  const invalid = [
    {},
    null,
    [],
    { cgpa: 10.1 },
    { cgpa: -1 },
    { cgpa: '8.5' },
    { graduationYear: 2027.5 },
    { graduationYear: 2101 },
    { graduationYear: 1949 },
    { skills: ['React', ' react '] },
    { skills: [' '] },
    { skills: Array.from({ length: 31 }, (_, i) => 'skill' + i) },
    { bio: 'a'.repeat(2001) },
    { institution: { $ne: null } },
    { portfolioUrl: 'javascript:alert(1)' },
    { githubUrl: 'https://name:password@example.test' },
    { phone: 'invalid-phone' },
    { phone: '.....' },
    { phone: '1'.repeat(16) },
    { role: 'admin' },
    { passwordHash: 'injected' },
    { $set: { user: identities.otherStudent.user.id } },
    { companyName: 'forbidden' },
  ];
  for (const body of invalid)
    assert.equal((await request('student', 'PATCH', body)).status, 400);
  assert.equal(await StudentProfile.countDocuments(), 0);
});

test('recruiter validation rejects invalid types, contact details, approval and student fields', async () => {
  for (const body of [
    {},
    { companySize: 'huge' },
    { companyName: 123 },
    { website: 'ftp://example.test' },
    { contactEmail: 'not-email' },
    { description: 'a'.repeat(4001) },
    { companyName: 'a'.repeat(201) },
    { phone: 'not a number' },
    { approved: true },
    { approvalStatus: 'approved' },
    { skills: ['React'] },
    { role: 'admin' },
    { user: identities.otherRecruiter.user.id },
  ])
    assert.equal((await request('recruiter', 'PATCH', body)).status, 400);
  assert.equal(await RecruiterProfile.countDocuments(), 0);
});

test('invalid patches leave existing data intact', async () => {
  await request('student', 'PATCH', { bio: 'original', cgpa: 8 });
  assert.equal(
    (await request('student', 'PATCH', { bio: 'changed', cgpa: 99 })).status,
    400,
  );
  const current = (await request('student')).body.profile;
  assert.equal(current.bio, 'original');
  assert.equal(current.cgpa, 8);
});

test('concurrent first saves retain one profile and independently patched fields', async () => {
  for (const [role, Model, first, second] of [
    ['student', StudentProfile, { institution: 'University' }, { bio: 'Bio' }],
    [
      'recruiter',
      RecruiterProfile,
      { companyName: 'Company' },
      { industry: 'Software' },
    ],
  ]) {
    const results = await Promise.all([
      request(role, 'PATCH', first),
      request(role, 'PATCH', second),
    ]);
    assert.deepEqual(
      results.map((result) => result.status),
      [200, 200],
    );
    assert.equal(await Model.countDocuments(), 1);
    const profile = (await request(role)).body.profile;
    for (const [key, value] of Object.entries({ ...first, ...second }))
      assert.equal(profile[key], value);
  }
});

test('role changes, deleted users, and revoked sessions are enforced for existing tokens', async () => {
  await request('student', 'PATCH', { bio: 'private' });
  await User.updateOne(
    { _id: identities.student.user.id },
    { role: 'recruiter' },
  );
  assert.equal((await request('student')).status, 403);
  await AuthSession.updateOne(
    { _id: identities.recruiter.session.id },
    { revokedAt: new Date() },
  );
  assert.equal(
    (await request('recruiter', 'PATCH', { companyName: 'forbidden' })).status,
    401,
  );
  await User.deleteOne({ _id: identities.otherStudent.user.id });
  assert.equal(
    (await request('student', 'GET', undefined, 'otherStudent')).status,
    401,
  );
});
