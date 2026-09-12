import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({
  path: fileURLToPath(new URL('../../.env', import.meta.url)),
  quiet: true,
});

export function readConfig(env = process.env) {
  const port = Number(env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const mongodbUri = env.MONGODB_URI?.trim();
  if (!mongodbUri || !/^mongodb(?:\+srv)?:\/\//.test(mongodbUri)) {
    throw new Error(
      'MONGODB_URI must be a MongoDB connection string. Configure backend/.env.',
    );
  }
  const nodeEnv = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }
  const jwtSecret = env.JWT_SECRET;
  if (typeof jwtSecret !== 'string' || jwtSecret.trim().length < 32) {
    throw new Error(
      'JWT_SECRET must contain at least 32 characters. Configure backend/.env.',
    );
  }
  return { port, mongodbUri, nodeEnv, jwtSecret };
}
