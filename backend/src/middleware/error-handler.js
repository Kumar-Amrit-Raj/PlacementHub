// Log only controlled metadata and stack frames, never error messages or requests.
export function errorHandler(logger = console) {
  return (error, req, res, next) => {
    const status =
      Number.isInteger(error.status) &&
      error.status >= 400 &&
      error.status < 500
        ? error.status
        : 500;
    if (status === 500) {
      const heading = String(error.name) + ': ' + String(error.message);
      const stack =
        typeof error.stack === 'string' && error.stack.startsWith(heading)
          ? error.stack.slice(heading.length)
          : '';
      logger.error({
        event: 'unexpected_server_error',
        method: req.method,
        path:
          res.locals.errorPath ||
          (req.route ? req.baseUrl + req.route.path : '(unmatched request)'),
        stack: stack
          ? stack
              .split('\n')
              .filter((line) => /^\s+at .+\(?.+:\d+:\d+\)?$/.test(line))
              .join('\n')
          : '(stack unavailable)',
      });
    }
    if (res.headersSent) return next(error);
    res.status(status).json({
      error: status === 500 ? 'Internal server error' : 'Invalid request',
    });
  };
}
