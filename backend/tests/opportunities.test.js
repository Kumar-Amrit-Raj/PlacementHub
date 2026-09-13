import { StudentProfile } from '../src/modules/profiles/student-profile.model.js';
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
import { Opportunity } from '../src/modules/opportunities/opportunity.model.js';

const jwtSecret = randomBytes(32).toString('hex');
const tokens = createTokenService(jwtSecret);
let mongo, server, base, actors, company;
before(
  async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), {
      dbName: 'placementhub_opportunities_test',
    });
    await Promise.all([
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
  company = await RecruiterProfile.create({
    user: actors.recruiter.user.id,
    companyName: 'Example Labs',
    approvalStatus: 'approved',
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
const future = () => new Date(Date.now() + 86400000).toISOString();
const valid = () => ({
  title: 'Software Engineer',
  description: 'Build useful software.',
  jobType: 'full-time',
  location: 'Bengaluru',
  compensation: 'INR 8–12 lakh annually',
  deadline: future(),
  minimumCgpa: 7,
  allowedBranches: ['CSE', 'ECE'],
  graduationYear: 2027,
});
const create = async (body = valid(), actor = 'recruiter') => {
  const result = await api('/opportunities', 'POST', body, actor);
  assert.equal(result.status, 201);
  return result.body.opportunity;
};
const control = (id, action, actor = 'recruiter', body = {}) =>
  api('/opportunities/' + id + '/' + action, 'POST', body, actor);
const studentList = (query = '') =>
  api('/opportunities' + query, 'GET', undefined, 'student');
const studentDetail = (id) =>
  api('/opportunities/' + id, 'GET', undefined, 'student');

test('creates an owned draft, updates fields, and provides recruiter list/detail', async () => {
  const draft = await create({ ...valid(), title: '  Developer  ' });
  assert.equal(draft.title, 'Developer');
  assert.equal(draft.company, company.id);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.publishedAt, null);
  assert.equal((await studentList()).body.opportunities.length, 0);
  assert.equal((await studentDetail(draft._id)).status, 404);
  const update = await api('/opportunities/' + draft._id, 'PATCH', {
    minimumCgpa: null,
    allowedBranches: [],
    graduationYear: null,
  });
  assert.equal(update.status, 200);
  assert.equal(update.body.opportunity.title, 'Developer');
  assert.equal(update.body.opportunity.minimumCgpa, null);
  assert.deepEqual(update.body.opportunity.allowedBranches, []);
  assert.equal((await api('/opportunities/mine')).body.opportunities.length, 1);
  assert.equal((await api('/opportunities/mine/' + draft._id)).status, 200);
});
test('requires a company profile, but permits pending and rejected companies to keep drafts', async () => {
  await RecruiterProfile.deleteOne({ _id: company._id });
  assert.equal((await api('/opportunities', 'POST', valid())).status, 409);
  for (const status of ['pending', 'rejected']) {
    await RecruiterProfile.findOneAndUpdate(
      { user: actors.recruiter.user.id },
      { companyName: 'Draft Labs', approvalStatus: status },
      { upsert: true },
    );
    const draft = await create();
    assert.equal((await control(draft._id, 'publish')).status, 403);
    assert.equal(
      (
        await api('/opportunities/' + draft._id, 'PATCH', {
          title: 'Updated draft',
        })
      ).status,
      200,
    );
    assert.equal((await control(draft._id, 'unpublish')).status, 200);
  }
});
test('only recruiters can create, update, publish, unpublish and read owned drafts', async () => {
  const draft = await create();
  for (const actor of [null, 'student', 'admin']) {
    const expected = actor ? 403 : 401;
    for (const [path, method, body] of [
      ['/opportunities', 'POST', valid()],
      ['/opportunities/' + draft._id, 'PATCH', { title: 'Changed' }],
      ['/opportunities/' + draft._id + '/publish', 'POST', {}],
      ['/opportunities/' + draft._id + '/unpublish', 'POST', {}],
      ['/opportunities/mine', 'GET'],
      ['/opportunities/mine/' + draft._id, 'GET'],
    ])
      assert.equal((await api(path, method, body, actor)).status, expected);
  }
});
test('other recruiters cannot access or manage another company opportunity', async () => {
  const draft = await create();
  assert.equal(
    (await api('/opportunities/mine', 'GET', undefined, 'other')).body
      .opportunities.length,
    0,
  );
  assert.equal(
    (await api('/opportunities/mine/' + draft._id, 'GET', undefined, 'other'))
      .status,
    404,
  );
  assert.equal(
    (
      await api(
        '/opportunities/' + draft._id,
        'PATCH',
        { title: 'Hijacked' },
        'other',
      )
    ).status,
    404,
  );
  for (const action of ['publish', 'unpublish'])
    assert.equal((await control(draft._id, action, 'other')).status, 404);
  assert.equal((await Opportunity.findById(draft._id)).title, draft.title);
});
test('published student list/detail expose only safe fields and require the student role', async () => {
  const draft = await create();
  assert.equal((await control(draft._id, 'publish')).status, 200);
  const list = await studentList();
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.equal(list.body.opportunities.length, 1);
  const detail = await studentDetail(draft._id);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.opportunity.company.companyName, 'Example Labs');
  for (const key of [
    'user',
    'contactEmail',
    'approvalHistory',
    'approvalStatus',
  ])
    assert.equal(detail.body.opportunity.company[key], undefined);
  assert.equal(detail.body.opportunity.approvedCompanyVersion, undefined);
  assert.equal(detail.body.opportunity.minimumCgpa, 7);
  for (const actor of [null, 'recruiter', 'admin']) {
    assert.equal(
      (await api('/opportunities', 'GET', undefined, actor)).status,
      actor ? 403 : 401,
    );
    assert.equal(
      (await api('/opportunities/' + draft._id, 'GET', undefined, actor))
        .status,
      actor ? 403 : 401,
    );
  }
});
test('unpublishing and editing a published opportunity hide it until explicitly republished', async () => {
  const draft = await create();
  await control(draft._id, 'publish');
  assert.equal(
    (await control(draft._id, 'unpublish')).body.opportunity.status,
    'draft',
  );
  assert.equal((await studentDetail(draft._id)).status, 404);
  await control(draft._id, 'publish');
  const edited = await api('/opportunities/' + draft._id, 'PATCH', {
    compensation: 'INR 10 lakh annually',
  });
  assert.equal(edited.body.opportunity.status, 'draft');
  assert.equal(edited.body.opportunity.publishedAt, null);
  assert.equal((await studentList()).body.opportunities.length, 0);
  await control(draft._id, 'publish');
  assert.equal((await studentDetail(draft._id)).status, 200);
});
test('expired opportunities disappear from both student endpoints and cannot be republished', async () => {
  const draft = await create();
  await control(draft._id, 'publish');
  await Opportunity.updateOne(
    { _id: draft._id },
    { deadline: new Date(Date.now() - 1) },
  );
  assert.equal((await studentList()).body.opportunities.length, 0);
  assert.equal((await studentDetail(draft._id)).status, 404);
  assert.equal((await control(draft._id, 'publish')).status, 409);
  assert.equal((await api('/opportunities/mine/' + draft._id)).status, 200);
  await api('/opportunities/' + draft._id, 'PATCH', { deadline: future() });
  assert.equal((await control(draft._id, 'publish')).status, 200);
});
test('company edits hide published opportunities and reapproval requires explicit republication', async () => {
  const draft = await create();
  await control(draft._id, 'publish');
  assert.equal(
    (await api('/profiles/recruiter/me', 'PATCH', { industry: 'Software' }))
      .status,
    200,
  );
  assert.equal((await studentList()).body.opportunities.length, 0);
  assert.equal((await studentDetail(draft._id)).status, 404);
  assert.equal((await control(draft._id, 'publish')).status, 403);
  const reviewed = await api(
    '/admin/companies/' + company.id + '/approve',
    'POST',
    { expectedVersion: 1 },
    'admin',
  );
  assert.equal(reviewed.status, 200);
  assert.equal((await studentDetail(draft._id)).status, 404);
  await control(draft._id, 'publish');
  assert.equal((await studentDetail(draft._id)).status, 200);
  await RecruiterProfile.deleteOne({ _id: company._id });
  assert.equal((await studentDetail(draft._id)).status, 404);
});
test('strict validation rejects invalid eligibility, deadlines, unknown fields and ownership/state injection', async () => {
  const draft = await create();
  for (const patch of [
    { title: '' },
    { description: 'a'.repeat(10001) },
    { jobType: 'anything' },
    { location: '' },
    { compensation: '' },
    { minimumCgpa: -1 },
    { minimumCgpa: 11 },
    { minimumCgpa: '7' },
    { graduationYear: 2027.5 },
    { graduationYear: 2101 },
    { allowedBranches: ['CSE', 'cse'] },
    { allowedBranches: [''] },
    { allowedBranches: Array(51).fill('A') },
    { deadline: 'not-a-date' },
    { deadline: new Date(Date.now() - 1000).toISOString() },
    { deadline: '2028-01-01' },
    { company: actors.other.user.id },
    { status: 'published' },
    { approvedCompanyVersion: 1 },
    { version: 999 },
    { user: actors.other.user.id },
  ]) {
    assert.equal(
      (await api('/opportunities', 'POST', { ...valid(), ...patch })).status,
      400,
      JSON.stringify(patch),
    );
    assert.equal(
      (await api('/opportunities/' + draft._id, 'PATCH', patch)).status,
      400,
      JSON.stringify(patch),
    );
  }
  assert.equal((await api('/opportunities', 'POST', {})).status, 400);
  assert.equal(
    (await api('/opportunities/' + draft._id, 'PATCH', {})).status,
    400,
  );
  assert.equal(
    (await control(draft._id, 'publish', 'recruiter', { status: 'published' }))
      .status,
    400,
  );
});
test('student pagination filters hidden companies before applying page size', async () => {
  const hidden = await create(valid(), 'other');
  await control(hidden._id, 'publish', 'other');
  await RecruiterProfile.updateOne(
    { user: actors.other.user.id },
    { approvalStatus: 'rejected' },
  );
  const first = await create();
  const second = await create();
  for (const item of [first, second]) await control(item._id, 'publish');
  const page = await studentList('?limit=1');
  assert.equal(page.body.opportunities.length, 1);
  assert.equal(page.body.opportunities[0]._id, first._id);
  assert.equal(page.body.nextCursor, first._id);
  const next = await studentList('?limit=1&after=' + page.body.nextCursor);
  assert.equal(next.body.opportunities[0]._id, second._id);
  assert.equal(next.body.nextCursor, null);
  const mine = await api('/opportunities/mine?limit=1');
  assert.equal(mine.body.nextCursor, first._id);
  assert.equal(
    (await api('/opportunities/mine?limit=1&after=' + first._id)).body
      .opportunities[0]._id,
    second._id,
  );
});
test('invalid IDs and pagination return client errors, and absent IDs return 404', async () => {
  for (const query of [
    '?limit=0',
    '?limit=101',
    '?limit=no',
    '?after=bad',
    '?extra=value',
  ]) {
    assert.equal((await studentList(query)).status, 400);
    assert.equal((await api('/opportunities/mine' + query)).status, 400);
  }
  assert.equal((await studentDetail('bad')).status, 400);
  assert.equal(
    (await api('/opportunities/bad', 'PATCH', { title: 'Test' })).status,
    400,
  );
  const absent = new mongoose.Types.ObjectId().toString();
  assert.equal((await studentDetail(absent)).status, 404);
  assert.equal((await control(absent, 'publish')).status, 404);
});

test('conditional publication does not overwrite a concurrent opportunity edit', async (context) => {
  const draft = await create();
  const original = Opportunity.findOneAndUpdate;
  context.mock.method(
    Opportunity,
    'findOneAndUpdate',
    async function (...args) {
      await Opportunity.updateOne(
        { _id: draft._id },
        { $set: { title: 'Concurrent edit' }, $inc: { version: 1 } },
      );
      return original.apply(this, args);
    },
  );
  const result = await control(draft._id, 'publish');
  assert.equal(result.status, 409);
  const current = await Opportunity.findById(draft._id);
  assert.equal(current.status, 'draft');
  assert.equal(current.title, 'Concurrent edit');
  assert.equal((await studentDetail(draft._id)).status, 404);
});
test('a company edit during publication cannot expose an unapproved company', async (context) => {
  const draft = await create();
  const original = Opportunity.findOneAndUpdate;
  context.mock.method(
    Opportunity,
    'findOneAndUpdate',
    async function (...args) {
      await RecruiterProfile.updateOne(
        { _id: company._id },
        { $set: { approvalStatus: 'pending' }, $inc: { profileVersion: 1 } },
      );
      return original.apply(this, args);
    },
  );
  await control(draft._id, 'publish');
  assert.equal((await studentList()).body.opportunities.length, 0);
  assert.equal((await studentDetail(draft._id)).status, 404);
});
test('approved legacy company profiles without a stored version can publish', async () => {
  await RecruiterProfile.collection.updateOne(
    { _id: company._id },
    { $unset: { profileVersion: '' } },
  );
  const draft = await create();
  assert.equal((await control(draft._id, 'publish')).status, 200);
  assert.equal((await studentDetail(draft._id)).status, 200);
});

test('student responses evaluate the authenticated profile and reflect profile updates', async () => {
  const draft = await create();
  await control(draft._id, 'publish');
  assert.equal(
    (await studentDetail(draft._id)).body.opportunity.eligibility.status,
    'incomplete_profile',
  );
  await api(
    '/profiles/student/me',
    'PATCH',
    { cgpa: 7, branch: ' cse ', graduationYear: 2027 },
    'student',
  );
  assert.equal(
    (await studentDetail(draft._id)).body.opportunity.eligibility.status,
    'eligible',
  );
  assert.equal(
    (await studentList()).body.opportunities[0].eligibility.status,
    'eligible',
  );
  await api('/profiles/student/me', 'PATCH', { cgpa: 5 }, 'student');
  const result = await studentDetail(draft._id);
  assert.equal(result.body.opportunity.eligibility.status, 'not_eligible');
  assert.match(
    result.body.opportunity.eligibility.reasons[0].message,
    /below the minimum/,
  );
  assert.equal((await studentList('?user=someone')).status, 400);
});
test('eligibility filtering occurs before pagination and does not skip matching records', async () => {
  const incomplete = await create();
  await control(incomplete._id, 'publish');
  const first = await create({
    ...valid(),
    minimumCgpa: null,
    allowedBranches: [],
    graduationYear: null,
  });
  await control(first._id, 'publish');
  const second = await create({
    ...valid(),
    minimumCgpa: null,
    allowedBranches: [],
    graduationYear: null,
  });
  await control(second._id, 'publish');
  const page = await studentList('?eligibility=eligible&limit=1');
  assert.equal(page.body.opportunities[0]._id, first._id);
  assert.equal(page.body.nextCursor, first._id);
  const next = await studentList(
    '?eligibility=eligible&limit=1&after=' + page.body.nextCursor,
  );
  assert.equal(next.body.opportunities[0]._id, second._id);
  assert.equal(next.body.nextCursor, null);
  assert.equal(
    (await studentList('?eligibility=incomplete_profile')).body.opportunities
      .length,
    1,
  );
  assert.equal(
    (await studentList('?eligibility=not_eligible')).body.opportunities.length,
    0,
  );
});
test('combined type/location/search filters are case-insensitive literal matches', async () => {
  const draft = await create({
    ...valid(),
    title: 'C++ Engineer (R&D)',
    jobType: 'contract',
    location: 'Remote [India]',
  });
  await control(draft._id, 'publish');
  const query =
    '?jobType=contract&location=' +
    encodeURIComponent('[india]') +
    '&search=' +
    encodeURIComponent('c++');
  assert.equal((await studentList(query)).body.opportunities.length, 1);
  assert.equal(
    (await studentList('?search=Example')).body.opportunities.length,
    1,
  );
  assert.equal(
    (await studentList('?search=useful')).body.opportunities.length,
    1,
  );
  assert.equal(
    (await studentList('?search=' + encodeURIComponent('.*'))).body
      .opportunities.length,
    0,
  );
  assert.equal(
    (await studentList('?jobType=internship')).body.opportunities.length,
    0,
  );
});
test('filters never expose expired, unpublished or hidden opportunities', async () => {
  const draft = await create({
    ...valid(),
    minimumCgpa: null,
    allowedBranches: [],
    graduationYear: null,
  });
  assert.equal(
    (await studentList('?eligibility=eligible')).body.opportunities.length,
    0,
  );
  await control(draft._id, 'publish');
  await RecruiterProfile.updateOne(
    { _id: company._id },
    { approvalStatus: 'pending' },
  );
  assert.equal(
    (await studentList('?eligibility=eligible&search=Software')).body
      .opportunities.length,
    0,
  );
  assert.equal((await studentDetail(draft._id)).status, 404);
  await RecruiterProfile.updateOne(
    { _id: company._id },
    { approvalStatus: 'approved' },
  );
  await Opportunity.updateOne(
    { _id: draft._id },
    { deadline: new Date(Date.now() - 1) },
  );
  assert.equal(
    (await studentList('?eligibility=eligible')).body.opportunities.length,
    0,
  );
});
test('invalid filter types and attempts to inject profile data are rejected', async () => {
  for (const query of [
    '?jobType=invalid',
    '?eligibility=unknown',
    '?search=',
    '?location=',
    '?search=a&search=b',
    '?cgpa=10',
    '?location[x]=y',
    '?search=' + 'a'.repeat(201),
  ]) {
    assert.equal((await studentList(query)).status, 400, query);
  }
  assert.equal(
    (await api('/opportunities/mine?eligibility=eligible')).status,
    400,
  );
});
