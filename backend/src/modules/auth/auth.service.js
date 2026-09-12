import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { User, publicUser } from '../users/user.model.js';
import { ACCESS_TOKEN_SECONDS } from './token.service.js';
import { createSession, rotateSession } from './session.service.js';
import { AuthSession } from './session.model.js';

const BCRYPT_ROUNDS = 12;
let dummyHash;
function getDummyHash() {
  dummyHash ??= bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
  return dummyHash;
}

export function createAuthService(tokens) {
  function result(user, { session, refreshToken }) {
    return {
      refreshToken,
      sessionExpiresAt: session.expiresAt,
      response: {
        user: publicUser(user),
        accessToken: tokens.sign(user, session.id),
        tokenType: 'Bearer',
        expiresIn: ACCESS_TOKEN_SECONDS,
      },
    };
  }
  return {
    async register({ name, email, password, role }) {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const user = await User.create({ name, email, passwordHash, role });
      return result(user, await createSession(user));
    },
    async login({ email, password }) {
      const user = await User.findOne({ email }).select('+passwordHash');
      const matches = await bcrypt.compare(
        password,
        user?.passwordHash ?? (await getDummyHash()),
      );
      return user && matches ? result(user, await createSession(user)) : null;
    },
    async refresh(refreshToken) {
      const rotated = await rotateSession(refreshToken);
      if (!rotated) return null;
      const user = await User.findById(rotated.session.user);
      if (!user) {
        await AuthSession.updateOne(
          { _id: rotated.session._id },
          { $set: { revokedAt: new Date() } },
        );
        return null;
      }
      return result(user, rotated);
    },
  };
}
