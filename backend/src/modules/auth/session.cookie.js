export const REFRESH_COOKIE = 'placementhub_refresh';

export function refreshCookieOptions(nodeEnv) {
  return {
    httpOnly: true,
    secure: nodeEnv === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
  };
}

// Custom headers require a browser preflight; this API enables no cross-origin CORS.
// Together with SameSite=Strict this protects cookie-authenticated mutations.
export function protectSessionMutation(req, res, next) {
  if (
    req.get('X-CSRF-Protection') !== '1' ||
    req.get('Sec-Fetch-Site') === 'cross-site'
  ) {
    return res
      .status(403)
      .json({ error: 'Session request protection required' });
  }
  next();
}
