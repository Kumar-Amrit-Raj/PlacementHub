import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEligibility } from '../src/modules/opportunities/eligibility.js';
const requirements = {
  minimumCgpa: 7,
  allowedBranches: ['CSE', 'ECE'],
  graduationYear: 2027,
};
test('eligibility accepts exact CGPA/year boundaries and normalized branches', () => {
  assert.deepEqual(
    evaluateEligibility(requirements, {
      cgpa: 7,
      branch: ' cSe ',
      graduationYear: 2027,
    }),
    { status: 'eligible', reasons: [] },
  );
});
test('eligibility reports every known mismatch', () => {
  const result = evaluateEligibility(requirements, {
    cgpa: 6.9,
    branch: 'Mechanical',
    graduationYear: 2026,
  });
  assert.equal(result.status, 'not_eligible');
  assert.deepEqual(
    result.reasons.map((reason) => reason.field),
    ['cgpa', 'branch', 'graduationYear'],
  );
  assert.ok(result.reasons.every((reason) => reason.code === 'mismatch'));
});
test('missing required values produce incomplete profile; known failures take precedence', () => {
  assert.equal(
    evaluateEligibility(requirements, null).status,
    'incomplete_profile',
  );
  assert.equal(evaluateEligibility(requirements, {}).reasons.length, 3);
  const result = evaluateEligibility(requirements, { cgpa: 5 });
  assert.equal(result.status, 'not_eligible');
  assert.equal(
    result.reasons.filter((reason) => reason.code === 'missing').length,
    2,
  );
});
test('unrestricted opportunities need no profile and zero CGPA is a valid value', () => {
  assert.equal(evaluateEligibility({}, null).status, 'eligible');
  assert.equal(
    evaluateEligibility({ minimumCgpa: 0 }, { cgpa: 0 }).status,
    'eligible',
  );
  assert.equal(
    evaluateEligibility({ minimumCgpa: 0 }, {}).status,
    'incomplete_profile',
  );
});
test('invalid legacy values are incomplete rather than coerced into eligibility', () => {
  const result = evaluateEligibility(requirements, {
    cgpa: '8',
    branch: ' ',
    graduationYear: 2027.5,
  });
  assert.equal(result.status, 'incomplete_profile');
  assert.equal(result.reasons.length, 3);
});
