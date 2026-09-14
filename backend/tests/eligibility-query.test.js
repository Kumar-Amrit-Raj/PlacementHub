import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Opportunity } from '../src/modules/opportunities/opportunity.model.js';
import { RecruiterProfile } from '../src/modules/profiles/recruiter-profile.model.js';
import { evaluateEligibility } from '../src/modules/opportunities/eligibility.js';
import { eligibilityExpression } from '../src/modules/opportunities/eligibility-query.js';
import { backfillEligibilityBranches } from '../src/modules/opportunities/eligibility-backfill.js';
import { publishedOpportunities } from '../src/modules/opportunities/opportunity.service.js';
let mongo;
before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), {
    dbName: 'eligibility_parity',
    monitorCommands: true,
  });
  await Promise.all([Opportunity.init(), RecruiterProfile.init()]);
});
after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
const statuses = ['eligible', 'not_eligible', 'incomplete_profile'];
const base = () => ({
  company: new mongoose.Types.ObjectId(),
  title: 'Engineer',
  description: 'Build useful software',
  jobType: 'full-time',
  location: 'Remote [India]',
  compensation: 'Paid',
  deadline: new Date(Date.now() + 86400000),
  status: 'published',
  approvedCompanyVersion: 0,
});
test('MongoDB status selection exactly matches evaluator across Unicode, missing values and boundaries', async () => {
  await Opportunity.deleteMany({});
  const records = [];
  for (const minimumCgpa of [null, 0, 7, 10])
    for (const allowedBranches of [
      [],
      ['CSE'],
      ['İ'],
      ['ΟΣ'],
      ['ß'],
      ['ÉCE'],
      ['﻿ CSE ﻿'],
      ['$CSE'],
      ['ſ'],
      ['K'],
    ])
      for (const graduationYear of [null, 1950, 2027, 2100])
        records.push({
          ...base(),
          minimumCgpa,
          allowedBranches,
          graduationYear,
        });
  await Opportunity.insertMany(records);
  const stored = await Opportunity.find().lean();
  const profiles = [
    null,
    {},
    { cgpa: 0, branch: ' cSe ', graduationYear: 1950 },
    { cgpa: 7, branch: 'i̇', graduationYear: 2027 },
    { cgpa: 10, branch: 'ος', graduationYear: 2100 },
    { cgpa: 6.9, branch: 'SS', graduationYear: 2026 },
    { cgpa: 8, branch: 'éce', graduationYear: 2027 },
    { cgpa: '8', branch: ' ', graduationYear: 2027.5 },
    { cgpa: NaN, branch: '$cse', graduationYear: '2027' },
    { cgpa: Infinity, branch: 'S', graduationYear: 2101 },
    { cgpa: -1, branch: 'K', graduationYear: 1949 },
  ];
  for (const profile of profiles)
    for (const status of statuses) {
      const expected = stored
        .filter((item) => evaluateEligibility(item, profile).status === status)
        .map((item) => String(item._id))
        .sort();
      const actual = await Opportunity.aggregate([
        { $match: { $expr: eligibilityExpression(status, profile) } },
        { $project: { _id: 1 } },
      ]);
      assert.deepEqual(
        actual.map((item) => String(item._id)).sort(),
        expected,
        JSON.stringify({ profile, status }),
      );
    }
});

test('large candidate sets return only a bounded page from MongoDB without getMore scans', async () => {
  await Opportunity.deleteMany({});
  const company = await RecruiterProfile.create({
    user: new mongoose.Types.ObjectId(),
    companyName: 'Example Labs',
    approvalStatus: 'approved',
  });
  const template = {
    ...base(),
    company: company._id,
    allowedBranches: ['CSE'],
  };
  await Opportunity.insertMany(
    Array.from({ length: 2500 }, () => ({ ...template, minimumCgpa: 9 })),
  );
  const matches = await Opportunity.insertMany(
    Array.from({ length: 45 }, () => ({ ...template, minimumCgpa: 7 })),
  );
  const profile = { cgpa: 8, branch: 'cse' };
  const client = mongoose.connection.getClient(),
    commands = [],
    batches = [];
  const started = (event) => {
    if (event.commandName === 'aggregate' || event.commandName === 'getMore')
      commands.push(event);
  };
  const succeeded = (event) => {
    if (event.reply?.cursor)
      batches.push(
        event.reply.cursor.firstBatch?.length ??
          event.reply.cursor.nextBatch?.length ??
          0,
      );
  };
  client.on('commandStarted', started);
  client.on('commandSucceeded', succeeded);
  let first;
  try {
    first = await publishedOpportunities({
      limit: 20,
      profile,
      eligibility: 'eligible',
      search: 'Example',
      jobType: 'full-time',
      location: '[india]',
    });
  } finally {
    client.off('commandStarted', started);
    client.off('commandSucceeded', succeeded);
  }
  assert.equal(first.length, 21);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].commandName, 'aggregate');
  assert.ok(commands[0].command.pipeline.some((stage) => stage.$limit === 21));
  assert.deepEqual(batches, [21]);
  assert.deepEqual(
    first.map((item) => String(item._id)),
    matches.slice(0, 21).map((item) => item.id),
  );
  const second = await publishedOpportunities({
    limit: 20,
    profile,
    eligibility: 'eligible',
    after: first[19]._id,
  });
  const third = await publishedOpportunities({
    limit: 20,
    profile,
    eligibility: 'eligible',
    after: second[19]._id,
  });
  assert.deepEqual(
    [...first.slice(0, 20), ...second.slice(0, 20), ...third].map((item) =>
      String(item._id),
    ),
    matches.map((item) => item.id),
  );
  for (const item of first)
    assert.deepEqual(item.eligibility, evaluateEligibility(item, profile));
  assert.equal(
    (
      await publishedOpportunities({
        profile,
        eligibility: 'incomplete_profile',
      })
    ).length,
    0,
  );
});

test('bounded backfill preserves legacy data and query edits keep normalized fields atomic', async () => {
  await Opportunity.deleteMany({});
  const ids = [];
  for (const allowedBranches of [[' İ '], [' ΟΣ '], undefined, []]) {
    const record = {
      ...base(),
      ...(allowedBranches ? { allowedBranches } : {}),
    };
    ids.push((await Opportunity.collection.insertOne(record)).insertedId);
  }
  await backfillEligibilityBranches(2);
  const once = await Opportunity.collection.find().sort({ _id: 1 }).toArray();
  assert.deepEqual(
    once.map((item) => item.eligibilityBranches),
    [['i̇'], ['ος'], [], []],
  );
  await backfillEligibilityBranches(2);
  assert.deepEqual(
    await Opportunity.collection.find().sort({ _id: 1 }).toArray(),
    once,
  );
  await Opportunity.updateOne(
    { _id: ids[0] },
    { $set: { allowedBranches: ['ÉCE'] } },
  );
  assert.deepEqual(
    (await Opportunity.collection.findOne({ _id: ids[0] })).eligibilityBranches,
    ['éce'],
  );
  await Opportunity.findOneAndUpdate(
    { _id: ids[0] },
    { $set: { allowedBranches: [] } },
  );
  assert.deepEqual(
    (await Opportunity.collection.findOne({ _id: ids[0] })).eligibilityBranches,
    [],
  );
  const exposed = await Opportunity.findById(ids[0]);
  assert.equal(exposed.toJSON().eligibilityBranches, undefined);
});

test('all filtered statuses paginate without omissions and retain identical reasons', async () => {
  await Opportunity.deleteMany({});
  const company = await RecruiterProfile.create({
    user: new mongoose.Types.ObjectId(),
    companyName: 'Pagination Co',
    approvalStatus: 'approved',
  });
  const template = { ...base(), company: company._id };
  const records = await Opportunity.insertMany(
    Array.from({ length: 90 }, (_, index) => ({
      ...template,
      minimumCgpa: index % 3 === 0 ? 7 : null,
      allowedBranches: index % 3 === 2 ? [] : ['CSE'],
    })),
  );
  const profile = { cgpa: 5 };
  for (const status of statuses) {
    const expected = records.filter(
      (item) => evaluateEligibility(item, profile).status === status,
    );
    let after;
    const seen = [];
    do {
      const page = await publishedOpportunities({
        limit: 7,
        eligibility: status,
        profile,
        after,
      });
      assert.ok(page.length <= 8);
      const visible = page.slice(0, 7);
      for (const item of visible) {
        seen.push(String(item._id));
        assert.deepEqual(item.eligibility, evaluateEligibility(item, profile));
        assert.equal(item.eligibility.status, status);
      }
      after = page.length > 7 ? visible.at(-1)._id : null;
    } while (after);
    assert.deepEqual(
      seen,
      expected.map((item) => item.id),
    );
  }
});
test('backfill never overwrites a concurrent branch edit', async (t) => {
  await Opportunity.deleteMany({});
  const id = (
    await Opportunity.collection.insertOne({
      ...base(),
      allowedBranches: ['CSE'],
      version: 3,
    })
  ).insertedId;
  const original = Opportunity.collection.bulkWrite.bind(
    Opportunity.collection,
  );
  let raced = false;
  t.mock.method(Opportunity.collection, 'bulkWrite', async (...args) => {
    if (!raced) {
      raced = true;
      await Opportunity.updateOne(
        { _id: id },
        { $set: { allowedBranches: ['ÉCE'] } },
      );
    }
    return original(...args);
  });
  await backfillEligibilityBranches(1);
  const stored = await Opportunity.collection.findOne({ _id: id });
  assert.deepEqual(stored.allowedBranches, ['ÉCE']);
  assert.deepEqual(stored.eligibilityBranches, ['éce']);
  assert.equal(stored.version, 3);
});
