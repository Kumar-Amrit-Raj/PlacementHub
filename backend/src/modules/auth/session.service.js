import { createHash, randomBytes } from 'node:crypto';
import { AuthSession } from './session.model.js';

export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ROTATIONS = 4096;
const digest = (token) => createHash('sha256').update(token).digest('hex');
const secret = () => randomBytes(32).toString('hex');

function parse(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{24}\.[a-f0-9]{64}$/.test(token))
    return null;
  return { id: token.slice(0, 24), hash: digest(token) };
}

export async function createSession(user) {
  const session = new AuthSession({
    user: user._id,
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
  });
  const refreshToken = session.id + '.' + secret();
  session.tokenHash = digest(refreshToken);
  await session.save();
  return { session, refreshToken };
}

export async function rotateSession(token) {
  const parsed = parse(token);
  if (!parsed) return null;
  const refreshToken = parsed.id + '.' + secret();
  // One document compare-and-swap ensures a refresh token can win only once.
  const session = await AuthSession.findOneAndUpdate(
    {
      _id: parsed.id,
      tokenHash: parsed.hash,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
      rotationCount: { $lt: MAX_ROTATIONS },
    },
    {
      $set: { tokenHash: digest(refreshToken) },
      $push: { spentHashes: parsed.hash },
      $inc: { rotationCount: 1 },
    },
    { returnDocument: 'after' },
  );
  if (session) return { session, refreshToken };

  // Only a proven issued token can revoke the family, never a guessed selector.
  await AuthSession.updateOne(
    {
      _id: parsed.id,
      revokedAt: null,
      $or: [{ spentHashes: parsed.hash }, { tokenHash: parsed.hash }],
    },
    { $set: { revokedAt: new Date() } },
  );
  return null;
}

export async function revokeSession(token) {
  const parsed = parse(token);
  if (!parsed) return;
  await AuthSession.updateOne(
    {
      _id: parsed.id,
      revokedAt: null,
      $or: [{ tokenHash: parsed.hash }, { spentHashes: parsed.hash }],
    },
    { $set: { revokedAt: new Date() } },
  );
}
