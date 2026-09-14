import { createApp } from './app.js';
import { readConfig } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';

import { User } from './modules/users/user.model.js';
import { AuthSession } from './modules/auth/session.model.js';
import { StudentProfile } from './modules/profiles/student-profile.model.js';
import { RecruiterProfile } from './modules/profiles/recruiter-profile.model.js';

import { Opportunity } from './modules/opportunities/opportunity.model.js';
import { Application } from './modules/applications/application.model.js';

let server;
let stopping = false;

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  try {
    if (server?.listening) {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await disconnectDatabase();
    process.exitCode = exitCode;
  } catch {
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

async function start() {
  const config = readConfig();
  try {
    await connectDatabase(config.mongodbUri);
  } catch {
    throw new Error(
      'MongoDB connection failed. Check MONGODB_URI and database availability.',
    );
  }
  // Ensure ownership and identity indexes exist before accepting writes.
  await Promise.all([
    Opportunity.init(),
    Application.init(),
    User.init(),
    AuthSession.init(),
    StudentProfile.init(),
    RecruiterProfile.init(),
  ]);
  server = createApp({
    ...config,
  }).listen(config.port, () => {
    console.log(
      `PlacementHub API listening on http://localhost:${config.port}`,
    );
  });
  server.on('error', () => {
    console.error('HTTP server failed to start. Check PORT availability.');
    void shutdown(1);
  });
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

start().catch(() => {
  console.error(
    'API startup failed. Check configuration, database availability, and model indexes.',
  );
  void shutdown(1);
});
