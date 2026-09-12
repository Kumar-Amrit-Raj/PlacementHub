import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { User, publicUser } from '../users/user.model.js';
import { ACCESS_TOKEN_SECONDS } from './token.service.js';

const BCRYPT_ROUNDS = 12;
// Unknown users still perform a password comparison.
let dummyHash;
function getDummyHash() {
  dummyHash ??= bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
  return dummyHash;
}

export function createAuthService(tokens) {
  function result(user) {
    return {
      user: publicUser(user),
      accessToken: tokens.sign(user),
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_SECONDS,
    };
  }
  return {
    async register({ name, email, password, role }) {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const user = await User.create({ name, email, passwordHash, role });
      return result(user);
    },
    async login({ email, password }) {
      const user = await User.findOne({ email }).select('+passwordHash');
      const matches = await bcrypt.compare(
        password,
        user?.passwordHash ?? (await getDummyHash()),
      );
      return user && matches ? result(user) : null;
    },
  };
}
