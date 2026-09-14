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
  const allowedOrigins = (env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const origin of allowedOrigins) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(
        'CORS_ALLOWED_ORIGINS must contain exact HTTP(S) origins.',
      );
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      (nodeEnv === 'production' && url.protocol !== 'https:')
    ) {
      throw new Error(
        'CORS_ALLOWED_ORIGINS must contain exact origins (HTTPS in production).',
      );
    }
  }
  const cookieSameSite = env.REFRESH_COOKIE_SAME_SITE || 'strict';
  if (
    !['strict', 'lax', 'none'].includes(cookieSameSite) ||
    (cookieSameSite === 'none' &&
      (nodeEnv !== 'production' || !allowedOrigins.length))
  ) {
    throw new Error(
      'REFRESH_COOKIE_SAME_SITE must be strict/lax, or none with production HTTPS allowed origins.',
    );
  }
  const trustProxy = Number(env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 10)
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
  return {
    port,
    mongodbUri,
    nodeEnv,
    jwtSecret,
    allowedOrigins,
    cookieSameSite,
    trustProxy,
  };
}
