import { Application } from '../src/modules/applications/application.model.js';
import { StudentProfile } from '../src/modules/profiles/student-profile.model.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { User } from '../src/modules/users/user.model.js';
import { AuthSession } from '../src/modules/auth/session.model.js';
import { createSession } from '../src/modules/auth/session.service.js';
import { createTokenService } from '../src/modules/auth/token.service.js';
import { RecruiterProfile } from '../src/modules/profiles/recruiter-profile.model.js';
import { Opportunity } from '../src/modules/opportunities/opportunity.model.js';

const jwtSecret = randomBytes(32).toString('hex');
const tokens = createTokenService(jwtSecret);
let mongo, server, base, actors, company, opportunity;
before(
  async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri(), {
      dbName: 'placementhub_opportunities_test',
    });
    await Promise.all([
      Application.init(),
      User.init(),
      AuthSession.init(),
      RecruiterProfile.init(),
      Opportunity.init(),
    ]);
    server = createApp({ jwtSecret }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port + '/api/v1';
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
    Application.deleteMany({}),
    StudentProfile.deleteMany({}),
    User.deleteMany({}),
    AuthSession.deleteMany({}),
    RecruiterProfile.deleteMany({}),
    Opportunity.deleteMany({}),
  ]);
  actors = {};
  for (const [name, role] of [
    ['recruiter', 'recruiter'],
    ['other', 'recruiter'],
    ['student', 'student'],
    ['admin', 'admin'],
  ]) {
    const user = await User.create({
      name,
      role,
      email: name + '@example.test',
      passwordHash: 'unused-fixture',
    });
    const { session } = await createSession(user);
    actors[name] = { user, token: tokens.sign(user, session.id) };
  }
  await StudentProfile.create({
    user: actors.student.user.id,
    cgpa: 8,
    branch: 'CSE',
    graduationYear: 2027,
  });
  company = await RecruiterProfile.create({
    user: actors.recruiter.user.id,
    companyName: 'Example Labs',
    approvalStatus: 'approved',
  });
  opportunity = await Opportunity.create({
    company: company.id,
    title: 'Engineer',
    description: 'Build software',
    jobType: 'full-time',
    location: 'Remote',
    compensation: 'Paid',
    deadline: new Date(Date.now() + 86400000),
    minimumCgpa: 7,
    allowedBranches: ['CSE'],
    graduationYear: 2027,
    status: 'published',
    approvedCompanyVersion: 0,
  });
  await RecruiterProfile.create({
    user: actors.other.user.id,
    companyName: 'Other Labs',
    approvalStatus: 'approved',
  });
});
async function api(path, method = 'GET', body, actor = 'recruiter') {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(actor ? { Authorization: 'Bearer ' + actors[actor].token } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
}

const apply = (actor = 'student', id = opportunity.id, extra = {}) =>
  api('/applications', 'POST', { opportunityId: id, ...extra }, actor);
const change = (id, status, expectedVersion, actor = 'recruiter') =>
  api(
    '/applications/' + id + '/status',
    'PATCH',
    { status, expectedVersion },
    actor,
  );
test('eligible submission links records and captures immutable audit snapshots', async () => {
  const result = await apply();
  assert.equal(result.status, 201);
  const item = result.body.application;
  assert.equal(item.student, actors.student.user.id);
  assert.equal(item.opportunity, opportunity.id);
  assert.equal(item.company, company.id);
  assert.equal(item.status, 'applied');
  assert.equal(item.history.length, 1);
  assert.equal(item.history[0].actor, actors.student.user.id);
  assert.equal(item.snapshot.eligibility.status, 'eligible');
  assert.equal(item.snapshot.studentEmail, actors.student.user.email);
  await api('/profiles/student/me', 'PATCH', { cgpa: 5 }, 'student');
  assert.equal((await Application.findById(item._id)).snapshot.profile.cgpa, 8);
});
test('duplicate and concurrent submissions create exactly one application', async () => {
  const results = await Promise.all([apply(), apply()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await Application.countDocuments(), 1);
  assert.equal((await apply()).status, 409);
});
test('eligibility is rechecked at submission and reports missing and mismatched fields', async () => {
  await StudentProfile.deleteMany({});
  const missing = await apply();
  assert.equal(missing.status, 422);
  assert.equal(missing.body.eligibility.status, 'incomplete_profile');
  await StudentProfile.create({
    user: actors.student.user.id,
    cgpa: 6,
    branch: 'Mechanical',
    graduationYear: 2026,
  });
  const mismatch = await apply();
  assert.equal(mismatch.status, 422);
  assert.equal(mismatch.body.eligibility.reasons.length, 3);
  assert.equal(await Application.countDocuments(), 0);
});
test('draft, expired, unapproved, stale company version and missing opportunities reject submission', async () => {
  for (const patch of [
    { status: 'draft' },
    { deadline: new Date(Date.now() - 1) },
    { approvedCompanyVersion: 99 },
  ]) {
    await Opportunity.updateOne({ _id: opportunity._id }, patch);
    assert.equal((await apply()).status, 404);
    await Opportunity.updateOne(
      { _id: opportunity._id },
      {
        status: 'published',
        deadline: new Date(Date.now() + 86400000),
        approvedCompanyVersion: 0,
      },
    );
  }
  await RecruiterProfile.updateOne(
    { _id: company._id },
    { approvalStatus: 'pending' },
  );
  assert.equal((await apply()).status, 404);
  assert.equal(
    (await apply('student', new mongoose.Types.ObjectId().toString())).status,
    404,
  );
  assert.equal(await Application.countDocuments(), 0);
});
test('roles and ownership are enforced for creation, lists and transitions', async () => {
  for (const actor of [null, 'recruiter', 'admin'])
    assert.equal((await apply(actor)).status, actor ? 403 : 401);
  const item = (await apply()).body.application;
  for (const actor of [null, 'recruiter', 'admin'])
    assert.equal(
      (await api('/applications/mine', 'GET', undefined, actor)).status,
      actor ? 403 : 401,
    );
  for (const actor of [null, 'student', 'admin']) {
    assert.equal(
      (await api('/applications/company', 'GET', undefined, actor)).status,
      actor ? 403 : 401,
    );
    assert.equal(
      (await change(item._id, 'shortlisted', 0, actor)).status,
      actor ? 403 : 401,
    );
  }
  assert.equal(
    (await api('/applications/company', 'GET', undefined, 'other')).body
      .applications.length,
    0,
  );
  assert.equal((await change(item._id, 'shortlisted', 0, 'other')).status, 404);
  assert.equal(
    (
      await api(
        '/applications/company?opportunityId=' + opportunity.id,
        'GET',
        undefined,
        'other',
      )
    ).status,
    404,
  );
  const otherStudent = await User.create({
    name: 'Second',
    email: 'second@example.test',
    role: 'student',
    passwordHash: 'unused-fixture',
  });
  const { session } = await createSession(otherStudent);
  actors.second = {
    user: otherStudent,
    token: tokens.sign(otherStudent, session.id),
  };
  assert.equal(
    (await api('/applications/mine', 'GET', undefined, 'second')).body
      .applications.length,
    0,
  );
});
test('forward transitions append actor/from/to/time and terminal states cannot be reopened', async () => {
  const item = (await apply()).body.application;
  for (const [version, status] of [
    'shortlisted',
    'interview',
    'selected',
  ].entries()) {
    const result = await change(item._id, status, version);
    assert.equal(result.status, 200);
    assert.equal(result.body.application.history.length, version + 2);
    assert.equal(
      result.body.application.history.at(-1).actor,
      actors.recruiter.user.id,
    );
    assert.ok(
      Number.isFinite(Date.parse(result.body.application.history.at(-1).at)),
    );
  }
  assert.equal((await change(item._id, 'rejected', 3)).status, 409);
  assert.equal((await change(item._id, 'applied', 3)).status, 409);
  const mine = await api('/applications/mine', 'GET', undefined, 'student');
  assert.equal(mine.body.applications[0].status, 'selected');
  assert.equal(mine.headers.get('cache-control'), 'no-store');
});
test('skips, backwards, repeated and stale transitions fail without audit writes', async () => {
  const item = (await apply()).body.application;
  for (const [status, version] of [
    ['selected', 0],
    ['interview', 0],
    ['applied', 0],
    ['shortlisted', 9],
  ])
    assert.equal((await change(item._id, status, version)).status, 409);
  assert.equal((await Application.findById(item._id)).history.length, 1);
  assert.equal((await change(item._id, 'rejected', 0)).status, 200);
  assert.equal((await change(item._id, 'shortlisted', 1)).status, 409);
});
test('concurrent conflicting recruiter decisions commit one audit event', async () => {
  const item = (await apply()).body.application;
  const results = await Promise.all([
    change(item._id, 'shortlisted', 0),
    change(item._id, 'rejected', 0),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await Application.findById(item._id)).history.length, 2);
});
test('historical applications remain readable and manageable after opportunity closure', async () => {
  const first = (await apply()).body.application;
  const secondJob = await Opportunity.create({
    ...opportunity.toObject(),
    _id: new mongoose.Types.ObjectId(),
    title: 'Second role',
  });
  assert.equal((await apply('student', secondJob.id)).status, 201);
  await Opportunity.updateOne({ _id: opportunity._id }, { status: 'draft' });
  const mine = await api(
    '/applications/mine?limit=1',
    'GET',
    undefined,
    'student',
  );
  assert.equal(mine.body.applications.length, 1);
  assert.ok(mine.body.nextCursor);
  const next = await api(
    '/applications/mine?limit=1&after=' + mine.body.nextCursor,
    'GET',
    undefined,
    'student',
  );
  assert.equal(next.body.applications.length, 1);
  assert.equal(next.body.nextCursor, null);
  const companyList = await api(
    '/applications/company?opportunityId=' + opportunity.id,
  );
  assert.equal(companyList.body.applications.length, 1);
  assert.equal((await change(first._id, 'shortlisted', 0)).status, 200);
});
test('strict validation rejects injected ownership/status, malformed IDs and pagination', async () => {
  for (const extra of [
    { student: actors.admin.user.id },
    { company: company.id },
    { status: 'selected' },
    { history: [] },
  ])
    assert.equal((await apply('student', opportunity.id, extra)).status, 400);
  assert.equal((await apply('student', 'bad')).status, 400);
  const item = (await apply()).body.application;
  assert.equal((await change(item._id, 'invalid', 0)).status, 400);
  assert.equal((await change(item._id, 'shortlisted', -1)).status, 400);
  assert.equal(
    (
      await api('/applications/' + item._id + '/status', 'PATCH', {
        status: 'shortlisted',
      })
    ).status,
    400,
  );
  for (const suffix of [
    '?limit=0',
    '?limit=101',
    '?after=bad',
    '?student=other',
  ])
    assert.equal(
      (await api('/applications/mine' + suffix, 'GET', undefined, 'student'))
        .status,
      400,
    );
});
test('transaction rollback prevents a partial application on insert failure', async (context) => {
  const before = await Opportunity.findById(opportunity.id).lean();
  context.mock.method(Application, 'create', async () => {
    throw new Error('Injected failure');
  });
  assert.equal((await apply()).status, 500);
  assert.equal(await Application.countDocuments(), 0);
  const after = await Opportunity.findById(opportunity.id).lean();
  assert.equal(after.__v, before.__v);
});

for (const [name, Model, patch, expected] of [
  ['opportunity closure', Opportunity, { status: 'draft' }, 404],
  [
    'company approval loss',
    RecruiterProfile,
    { approvalStatus: 'pending' },
    404,
  ],
  ['student eligibility loss', StudentProfile, { cgpa: 1 }, 422],
])
  test(
    'submission retries and rechecks after concurrent ' + name,
    async (context) => {
      const original = Model.collection.updateOne;
      let injected = false;
      context.mock.method(
        Model.collection,
        'updateOne',
        async function (filter, update, options) {
          if (options?.session && !injected) {
            injected = true;
            await original.call(this, filter, { $set: patch });
          }
          return original.call(this, filter, update, options);
        },
      );
      const result = await apply();
      assert.equal(result.status, expected);
      assert.equal(await Application.countDocuments(), 0);
    },
  );
test('unrestricted opportunities accept students without an academic profile', async () => {
  await StudentProfile.deleteMany({});
  await Opportunity.updateOne(
    { _id: opportunity._id },
    { minimumCgpa: null, allowedBranches: [], graduationYear: null },
  );
  assert.equal((await apply()).status, 201);
});
test('standalone transaction errors fail closed with a useful response', async (context) => {
  context.mock.method(mongoose.connection, 'transaction', async () => {
    throw Object.assign(new Error('Unsupported transactions'), { code: 20 });
  });
  assert.equal((await apply()).status, 503);
  assert.equal(await Application.countDocuments(), 0);
});

test('revoked sessions and changed roles cannot apply or change statuses', async () => {
  const item = (await apply()).body.application;
  await AuthSession.updateMany(
    { user: actors.recruiter.user.id },
    { $set: { revokedAt: new Date() } },
  );
  assert.equal((await change(item._id, 'shortlisted', 0)).status, 401);
  await User.updateOne(
    { _id: actors.student.user.id },
    { $set: { role: 'recruiter' } },
  );
  assert.equal((await apply()).status, 403);
  assert.equal(
    (await api('/applications/mine', 'GET', undefined, 'student')).status,
    403,
  );
  assert.equal((await Application.findById(item._id)).history.length, 1);
});
test('rejection from each nonterminal state preserves the exact audit chain and snapshot', async () => {
  for (const stage of [0, 1, 2]) {
    await Application.deleteMany({});
    const item = (await apply()).body.application;
    for (let index = 0; index < stage; index++)
      assert.equal(
        (await change(item._id, ['shortlisted', 'interview'][index], index))
          .status,
        200,
      );
    const result = await change(item._id, 'rejected', stage);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.application.snapshot, item.snapshot);
    const history = result.body.application.history;
    assert.equal(history.length, stage + 2);
    for (let index = 1; index < history.length; index++) {
      assert.equal(history[index].from, history[index - 1].to);
      assert.ok(new Date(history[index].at) >= new Date(history[index - 1].at));
    }
    assert.equal((await change(item._id, 'selected', stage + 1)).status, 409);
    assert.equal(
      (await Application.findById(item._id)).history.length,
      stage + 2,
    );
  }
});
test('history and identity injection into status updates is rejected without mutation', async () => {
  const item = (await apply()).body.application;
  for (const extra of [
    { history: [] },
    { snapshot: {} },
    { student: actors.admin.user.id },
    { company: new mongoose.Types.ObjectId().toString() },
    { version: 90 },
  ]) {
    assert.equal(
      (
        await api('/applications/' + item._id + '/status', 'PATCH', {
          status: 'shortlisted',
          expectedVersion: 0,
          ...extra,
        })
      ).status,
      400,
    );
  }
  const record = await Application.findById(item._id);
  assert.equal(record.version, 0);
  assert.equal(record.history.length, 1);
});
test('historical applications remain visible after expiry and company approval loss', async () => {
  const item = (await apply()).body.application;
  await Opportunity.updateOne(
    { _id: opportunity._id },
    { deadline: new Date(Date.now() - 1) },
  );
  await RecruiterProfile.updateOne(
    { _id: company._id },
    { approvalStatus: 'rejected' },
  );
  assert.equal((await apply()).status, 404);
  assert.equal(
    (await api('/applications/mine', 'GET', undefined, 'student')).body
      .applications[0]._id,
    item._id,
  );
  assert.equal(
    (await api('/applications/company')).body.applications[0]._id,
    item._id,
  );
  assert.equal((await change(item._id, 'shortlisted', 0)).status, 200);
});
