import jwt from 'jsonwebtoken';

export const ACCESS_TOKEN_SECONDS = 15 * 60;
export const TOKEN_ISSUER = 'placementhub-api';
export const TOKEN_AUDIENCE = 'placementhub';

export function createTokenService(secret) {
  if (typeof secret !== 'string' || secret.trim().length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters.');
  }
  return {
    sign(user) {
      return jwt.sign({ role: user.role }, secret, {
        algorithm: 'HS256',
        subject: user.id,
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        expiresIn: ACCESS_TOKEN_SECONDS,
      });
    },
    verify(token) {
      const payload = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        maxAge: ACCESS_TOKEN_SECONDS,
      });
      if (
        typeof payload !== 'object' ||
        typeof payload.sub !== 'string' ||
        !/^[a-f0-9]{24}$/i.test(payload.sub) ||
        typeof payload.exp !== 'number'
      ) {
        throw new Error('Invalid access token');
      }
      return payload;
    },
  };
}
