import mongoose from 'mongoose';
import { User } from '../modules/users/user.model.js';

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
      const [session] = await AuthSession.aggregate([
        {
          $match: {
            _id: new mongoose.Types.ObjectId(payload.sid),
            user: new mongoose.Types.ObjectId(payload.sub),
            revokedAt: null,
            expiresAt: { $gt: new Date() },
          },
        },
        {
          $lookup: {
            from: User.collection.name,
            localField: 'user',
            foreignField: '_id',
            as: 'currentUser',
            pipeline: [{ $project: { _id: 1, name: 1, email: 1, role: 1 } }],
          },
        },
        { $unwind: '$currentUser' },
        { $project: { _id: 0, user: '$currentUser' } },
      ]);
      const user = session?.user;
      if (!user) {
        return res
          .status(401)
          .json({ error: 'Invalid or expired access token' });
      }
      req.user = {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
