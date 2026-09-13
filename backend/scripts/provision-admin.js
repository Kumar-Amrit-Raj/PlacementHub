import { pathToFileURL } from 'node:url';
import { readConfig } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import {
  ProvisioningError,
  validateAdminCredentials,
  provisionInitialAdmin,
} from '../src/modules/admin/provision.service.js';

export async function readCredentials(input) {
  if (input.isTTY)
    throw new ProvisioningError(
      'Pipe credentials as JSON through standard input; do not use command-line passwords.',
    );
  let size = 0;
  const chunks = [];
  for await (const chunk of input) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 8192)
      throw new ProvisioningError('Credential input exceeds 8 KiB.');
    chunks.push(buffer);
  }
  let parsed;
  try {
    // PowerShell pipelines may prefix UTF-8 text with a BOM.
    parsed = JSON.parse(
      Buffer.concat(chunks)
        .toString('utf8')
        .replace(/^\uFEFF/, ''),
    );
  } catch {
    throw new ProvisioningError('Credential input must be one JSON object.');
  }
  return validateAdminCredentials(parsed);
}

export async function main(args = process.argv.slice(2)) {
  try {
    if (args.length !== 1 || args[0] !== '--stdin') {
      throw new ProvisioningError(
        'Usage: npm run provision:admin -w backend -- --stdin (credentials via standard input only).',
      );
    }
    const credentials = await readCredentials(process.stdin);
    const config = readConfig();
    await connectDatabase(config.mongodbUri);
    await provisionInitialAdmin(credentials);
    console.log(
      'Initial admin created. Sign in through the normal login page.',
    );
    return 0;
  } catch (error) {
    // Never print raw driver errors, input values, connection strings, or hashes.
    console.error(
      error instanceof ProvisioningError
        ? error.message
        : 'Admin provisioning failed. Check database connectivity, configuration, and index permissions.',
    );
    return 1;
  } finally {
    await disconnectDatabase();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error('Admin provisioning cleanup failed.');
      process.exitCode = 1;
    });
}
