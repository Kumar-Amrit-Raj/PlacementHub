import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
test(
  'HTTP startup waits for indexes and fails closed when unique index creation fails',
  { timeout: 120000 },
  async (t) => {
    const mongo = await MongoMemoryServer.create();
    t.after(async () => {
      await mongoose.disconnect();
      await mongo.stop();
    });
    const uri = mongo.getUri('startup_verification');
    await mongoose.connect(uri);
    const reservation = createServer().listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const launch = () => {
      const child = spawn(process.execPath, ['src/server.js'], {
        cwd: new URL('../', import.meta.url),
        env: {
          ...process.env,
          MONGODB_URI: uri,
          JWT_SECRET: randomBytes(32).toString('hex'),
          PORT: String(port),
          NODE_ENV: 'test',
          CORS_ALLOWED_ORIGINS: '',
          REFRESH_COOKIE_SAME_SITE: 'strict',
          TRUST_PROXY_HOPS: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      t.after(() => {
        if (child.exitCode === null) child.kill();
      });
      return child;
    };
    const child = launch();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Startup timed out')), 20000);
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('API listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error('Startup exited: ' + code));
      });
    });
    const response = await fetch('http://127.0.0.1:' + port + '/api/v1/health');
    assert.equal(response.status, 200);
    const indexes = await mongoose.connection
      .collection('applications')
      .indexes();
    const unique = indexes.find(
      (index) => index.key.student === 1 && index.key.opportunity === 1,
    );
    assert.equal(unique.unique, true);
    assert.ok(
      (await mongoose.connection.collection('opportunities').indexes()).length >
        1,
    );
    const closed = once(child, 'exit');
    child.kill();
    await closed;
    // Simulate pre-existing duplicates; startup must never listen without the constraint.
    await mongoose.connection.collection('applications').dropIndex(unique.name);
    const student = new mongoose.Types.ObjectId(),
      opportunity = new mongoose.Types.ObjectId();
    await mongoose.connection.collection('applications').insertMany([
      { student, opportunity },
      { student, opportunity },
    ]);
    const failed = launch();
    let output = '';
    failed.stdout.on('data', (chunk) => {
      output += chunk;
    });
    const [code] = await once(failed, 'exit');
    assert.equal(code, 1);
    assert.doesNotMatch(output, /API listening/);
  },
);
