import { User, publicUser } from '../modules/users/user.model.js';

import { AuthSession } from '../modules/auth/session.model.js';

export function authenticate(tokens) {
  return async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
    if (!match) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    let payload;
    try {
      payload = tokens.verify(match[1]);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired access token' });
    }
    try {
      // Read the current role from MongoDB; do not authorize using stale JWT roles.
      const session = await AuthSession.exists({
        _id: payload.sid,
        user: payload.sub,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
      const user = session ? await User.findById(payload.sub) : null;
      if (!user) {
        return res
          .status(401)
          .json({ error: 'Invalid or expired access token' });
      }
      req.user = publicUser(user);
      next();
    } catch (error) {
      next(error);
    }
  };
}
