export const REFRESH_COOKIE = 'placementhub_refresh';

export function refreshCookieOptions(nodeEnv, sameSite = 'strict') {
  return {
    httpOnly: true,
    secure: nodeEnv === 'production',
    sameSite,
    path: '/api/v1/auth',
  };
}

// Require a preflight-only header and explicitly trust cross-site origins.
export function protectSessionMutation(req, res, next) {
  if (
    req.get('X-CSRF-Protection') !== '1' ||
    (req.get('Sec-Fetch-Site') === 'cross-site' &&
      !req.app.locals.allowedOrigins?.includes(req.get('Origin')))
  ) {
    return res
      .status(403)
      .json({ error: 'Session request protection required' });
  }
  next();
}
