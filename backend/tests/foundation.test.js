import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config/env.js';

test('configuration rejects missing database URI and invalid ports', () => {
  assert.throws(() => readConfig({}), /MONGODB_URI/);
  for (const PORT of ['abc', '0', '65536', '1.5']) {
    assert.throws(
      () => readConfig({ PORT, MONGODB_URI: 'mongodb://localhost/test' }),
      /PORT/,
    );
  }
  assert.equal(
    readConfig({ MONGODB_URI: 'mongodb://localhost/test' }).port,
    5000,
  );
});

for (const ready of [true, false]) {
  test(`health endpoint reports database readiness: ${ready}`, async (t) => {
    const server = createApp({ databaseReady: () => ready }).listen(
      0,
      '127.0.0.1',
    );
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/health`,
    );
    assert.equal(response.status, ready ? 200 : 503);
    assert.deepEqual(await response.json(), {
      status: ready ? 'ok' : 'unavailable',
      service: 'placementhub-api',
      database: ready ? 'connected' : 'disconnected',
    });
  });
}
