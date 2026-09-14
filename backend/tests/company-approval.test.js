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
import { RecruiterProfile } from '../src/modules/profiles/recruiter-profile.model.js';

const jwtSecret = randomBytes(32).toString('hex');
const tokens = createTokenService(jwtSecret);
let mongo, server, base, actors;
before(
  async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), {
      dbName: 'placementhub_approval_test',
    });
    await Promise.all([
      User.init(),
      AuthSession.init(),
      RecruiterProfile.init(),
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
    User.deleteMany({}),
    AuthSession.deleteMany({}),
    RecruiterProfile.deleteMany({}),
  ]);
  actors = {};
  for (const [name, role] of [
    ['admin', 'admin'],
    ['otherAdmin', 'admin'],
    ['recruiter', 'recruiter'],
    ['otherRecruiter', 'recruiter'],
    ['student', 'student'],
  ]) {
    const user = await User.create({
      name,
      email: name.toLowerCase() + '@example.test',
      role,
      passwordHash: 'unused-fixture',
    });
    const { session } = await createSession(user);
    actors[name] = { user, token: tokens.sign(user, session.id) };
  }
});
async function api(path, method = 'GET', body, actor = 'admin') {
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
const edit = (body, actor = 'recruiter') =>
  api('/profiles/recruiter/me', 'PATCH', body, actor);
const create = async () =>
  (await edit({ companyName: 'Example Labs', industry: 'Software' })).body
    .profile;
const decision = (id, action, body, actor = 'admin') =>
  api('/admin/companies/' + id + '/' + action, 'POST', body, actor);

test('new and legacy companies appear pending, with bounded cursor pagination', async () => {
  const company = await create();
  assert.equal(company.approvalStatus, 'pending');
  assert.equal(company.approvalHistory, undefined);
  assert.equal(company.profileVersion, 0);
  const legacy = await RecruiterProfile.collection.insertOne({
    user: actors.otherRecruiter.user._id,
    companyName: 'Legacy Company',
  });
  const first = await api('/admin/companies/pending?limit=1');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(first.body.companies.length, 1);
  assert.ok(first.body.nextCursor);
  const second = await api(
    '/admin/companies/pending?limit=1&after=' + first.body.nextCursor,
  );
  assert.equal(second.body.companies.length, 1);
  assert.equal(second.body.nextCursor, null);
  assert.notEqual(first.body.companies[0]._id, second.body.companies[0]._id);
  assert.equal(
    (await decision(legacy.insertedId, 'approve', { expectedVersion: 0 }))
      .status,
    200,
  );
});

test('only admins can list, read detail, approve, or reject company profiles', async () => {
  const company = await create();
  for (const actor of [null, 'student', 'recruiter', 'otherRecruiter']) {
    const expected = actor ? 403 : 401;
    assert.equal(
      (await api('/admin/companies/pending', 'GET', undefined, actor)).status,
      expected,
    );
    assert.equal(
      (await api('/admin/companies/' + company._id, 'GET', undefined, actor))
        .status,
      expected,
    );
    for (const action of ['approve', 'reject']) {
      assert.equal(
        (
          await decision(
            company._id,
            action,
            { expectedVersion: 0, reason: 'Review' },
            actor,
          )
        ).status,
        expected,
      );
    }
  }
  assert.equal(
    (await RecruiterProfile.findById(company._id)).approvalStatus,
    'pending',
  );
});

test('approval records actor, time, version and snapshot atomically', async () => {
  const company = await create();
  const result = await decision(company._id, 'approve', {
    expectedVersion: 0,
    reason: ' Verified details ',
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.company.approvalStatus, 'approved');
  const detail = (await api('/admin/companies/' + company._id)).body.company;
  assert.equal(detail.approvalHistory.length, 1);
  const event = detail.approvalHistory[0];
  assert.equal(event.actor, actors.admin.user.id);
  assert.equal(event.actorLabel, actors.admin.user.name);
  assert.equal(event.profileVersion, 0);
  assert.equal(event.reason, 'Verified details');
  assert.ok(Number.isFinite(Date.parse(event.at)));
  assert.equal(event.snapshot.companyName, 'Example Labs');
  assert.equal(
    (await api('/admin/companies/pending')).body.companies.length,
    0,
  );
  const own = (
    await api('/profiles/recruiter/me', 'GET', undefined, 'recruiter')
  ).body.profile;
  assert.equal(own.approvalStatus, 'approved');
  assert.equal(own.lastReview.reason, 'Verified details');
  assert.equal(own.approvalHistory, undefined);
});

test('rejection requires a reason and recruiter can read it', async () => {
  const company = await create();
  for (const reason of [undefined, '', '  ', 123, 'a'.repeat(1001)]) {
    assert.equal(
      (await decision(company._id, 'reject', { expectedVersion: 0, reason }))
        .status,
      400,
    );
  }
  const result = await decision(company._id, 'reject', {
    expectedVersion: 0,
    reason: 'Company details need correction',
  });
  assert.equal(result.status, 200);
  const own = (
    await api('/profiles/recruiter/me', 'GET', undefined, 'recruiter')
  ).body.profile;
  assert.equal(own.approvalStatus, 'rejected');
  assert.equal(own.lastReview.reason, 'Company details need correction');
});

test('recruiters cannot assign or erase approval and audit fields', async () => {
  const company = await create();
  await decision(company._id, 'approve', { expectedVersion: 0 });
  for (const body of [
    { approvalStatus: 'approved' },
    { approvalStatus: 'pending' },
    { approvalStatus: null },
    { profileVersion: 99 },
    { approvalHistory: [] },
    { lastReview: null },
    { actor: actors.admin.user.id },
    { approved: true },
  ])
    assert.equal((await edit(body)).status, 400);
  const detail = (await api('/admin/companies/' + company._id)).body.company;
  assert.equal(detail.approvalStatus, 'approved');
  assert.equal(detail.approvalHistory.length, 1);
});

test('actual edits require re-review, preserve past snapshots, and no-op saves do not reset approval', async () => {
  const company = await create();
  await decision(company._id, 'approve', { expectedVersion: 0 });
  assert.equal(
    (await edit({ companyName: ' Example Labs ' })).body.profile.approvalStatus,
    'approved',
  );
  const edited = (await edit({ companyName: 'New Name' })).body.profile;
  assert.equal(edited.approvalStatus, 'pending');
  assert.equal(edited.profileVersion, 1);
  assert.equal(edited.lastReview.profileVersion, 0);
  assert.equal(
    (await decision(company._id, 'approve', { expectedVersion: 0 })).status,
    409,
  );
  assert.equal(
    (
      await decision(
        company._id,
        'reject',
        { expectedVersion: 1, reason: 'Check new identity' },
        'otherAdmin',
      )
    ).status,
    200,
  );
  const detail = (await api('/admin/companies/' + company._id)).body.company;
  assert.equal(detail.approvalHistory.length, 2);
  assert.equal(detail.approvalHistory[0].snapshot.companyName, 'Example Labs');
  assert.equal(detail.approvalHistory[1].snapshot.companyName, 'New Name');
});

test('concurrent conflicting decisions produce one decision and one audit record', async () => {
  const company = await create();
  const results = await Promise.all([
    decision(company._id, 'approve', { expectedVersion: 0 }),
    decision(
      company._id,
      'reject',
      { expectedVersion: 0, reason: 'Not verified' },
      'otherAdmin',
    ),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const detail = (await api('/admin/companies/' + company._id)).body.company;
  assert.equal(detail.approvalHistory.length, 1);
  assert.equal(detail.approvalStatus, detail.approvalHistory[0].status);
  assert.equal(
    (await decision(company._id, 'approve', { expectedVersion: 0 })).status,
    409,
  );
});

test('racing profile edit and approval cannot approve changed details under an old version', async () => {
  const company = await create();
  const [review, update] = await Promise.all([
    decision(company._id, 'approve', { expectedVersion: 0 }),
    edit({ website: 'https://new.example.test' }),
  ]);
  assert.ok([200, 409].includes(review.status));
  assert.equal(update.status, 200);
  const detail = (await api('/admin/companies/' + company._id)).body.company;
  assert.equal(detail.approvalStatus, 'pending');
  assert.equal(detail.profileVersion, 1);
  for (const event of detail.approvalHistory)
    assert.equal(event.snapshot.website, undefined);
});

test('malformed requests, missing versions and unknown profiles fail without audit writes', async () => {
  const company = await create();
  for (const query of [
    'limit=0',
    'limit=101',
    'limit=abc',
    'limit=1&limit=2',
    'after=bad',
    'status=approved',
  ]) {
    assert.equal((await api('/admin/companies/pending?' + query)).status, 400);
  }
  for (const body of [
    {},
    { expectedVersion: -1 },
    { expectedVersion: '0' },
    { expectedVersion: 0.5 },
    { expectedVersion: 0, status: 'approved' },
    { expectedVersion: 0, actor: actors.otherAdmin.user.id },
  ]) {
    assert.equal((await decision(company._id, 'approve', body)).status, 400);
  }
  assert.equal(
    (await decision('bad-id', 'approve', { expectedVersion: 0 })).status,
    400,
  );
  assert.equal(
    (
      await decision(new mongoose.Types.ObjectId(), 'approve', {
        expectedVersion: 0,
      })
    ).status,
    404,
  );
  assert.equal(
    (await api('/admin/companies/' + company._id)).body.company.approvalHistory
      .length,
    0,
  );
});

test('unnamed drafts cannot be approved and revoked/demoted admins cannot decide', async () => {
  const draft = (await edit({ industry: 'Software' })).body.profile;
  assert.equal(
    (await decision(draft._id, 'approve', { expectedVersion: 0 })).status,
    400,
  );
  await User.updateOne({ _id: actors.admin.user.id }, { role: 'student' });
  assert.equal(
    (
      await decision(draft._id, 'reject', {
        expectedVersion: 0,
        reason: 'Review',
      })
    ).status,
    403,
  );
  await AuthSession.updateMany(
    { user: actors.otherAdmin.user.id },
    { revokedAt: new Date() },
  );
  assert.equal(
    (
      await decision(
        draft._id,
        'reject',
        { expectedVersion: 0, reason: 'Review' },
        'otherAdmin',
      )
    ).status,
    401,
  );
});

test('history capacity rejects further decisions without discarding audit records', async () => {
  const company = await create();
  const entry = {
    status: 'rejected',
    actor: actors.admin.user._id,
    at: new Date(),
    reason: 'Archived test review',
    profileVersion: 0,
    snapshot: { companyName: 'Example Labs' },
  };
  await RecruiterProfile.updateOne(
    { _id: company._id },
    { approvalHistory: Array.from({ length: 100 }, () => entry) },
  );
  assert.equal(
    (await decision(company._id, 'approve', { expectedVersion: 0 })).status,
    409,
  );
  const detail = (await api('/admin/companies/' + company._id)).body.company;
  assert.equal(detail.approvalStatus, 'pending');
  assert.equal(detail.approvalHistory.length, 100);
});

test('admin review labels fall back safely after a reviewer is deleted', async () => {
  const company = await create();
  await decision(company._id, 'approve', { expectedVersion: 0 }, 'otherAdmin');
  await User.deleteOne({ _id: actors.otherAdmin.user.id });
  const result = await api('/admin/companies/' + company._id);
  assert.equal(
    result.body.company.approvalHistory[0].actorLabel,
    'Administrator',
  );
  assert.equal(
    result.body.company.approvalHistory[0].actor,
    actors.otherAdmin.user.id,
  );
});
