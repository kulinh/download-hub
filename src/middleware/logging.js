export function requestLogger(enabled) {
  if (!enabled) return (_req, _res, next) => next();

  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const entry = {
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        ip: req.ip,
        ua: req.get('user-agent') || ''
      };
      // eslint-disable-next-line no-console
      console.log('[req]', JSON.stringify(entry));
    });
    next();
  };
}
