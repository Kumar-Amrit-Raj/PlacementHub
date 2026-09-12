import { USER_ROLES } from '../modules/users/user.model.js';

export function authorize(...roles) {
  if (roles.length === 0 || roles.some((role) => !USER_ROLES.includes(role))) {
    throw new Error('Authorization requires valid allowed roles.');
  }
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
