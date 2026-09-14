import { Opportunity } from './opportunity.model.js';
import { normalizeBranch } from './eligibility.js';

// Startup only: at most one batch is held in Node. CAS protects concurrent edits;
// bulk writes bypass timestamps/version updates because no business data changes.
export async function backfillEligibilityBranches(batchSize = 250) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new Error('Invalid backfill batch size');
  let after;
  while (true) {
    const records = await Opportunity.collection
      .find(
        {
          eligibilityBranches: { $exists: false },
          ...(after ? { _id: { $gt: after } } : {}),
        },
        { projection: { _id: 1, allowedBranches: 1 } },
      )
      .sort({ _id: 1 })
      .limit(batchSize)
      .toArray();
    if (!records.length) return;
    const result = await Opportunity.collection.bulkWrite(
      records.map((record) => ({
        updateOne: {
          filter: {
            _id: record._id,
            eligibilityBranches: { $exists: false },
            allowedBranches: record.allowedBranches ?? null,
          },
          update: {
            $set: {
              eligibilityBranches: (record.allowedBranches || []).map(
                normalizeBranch,
              ),
            },
          },
        },
      })),
    );
    if (result.matchedCount < records.length) continue;
    after = records.at(-1)._id;
  }
}
