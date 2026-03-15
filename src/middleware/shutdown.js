export function registerGracefulShutdown(server) {
  const signals = ['SIGINT', 'SIGTERM'];

  signals.forEach((signal) => {
    process.on(signal, () => {
      // eslint-disable-next-line no-console
      console.log(`[shutdown] Received ${signal}, closing server...`);
      server.close(() => {
        // eslint-disable-next-line no-console
        console.log('[shutdown] HTTP server closed');
        process.exit(0);
      });
      // Failsafe exit if close hangs
      setTimeout(() => {
        // eslint-disable-next-line no-console
        console.warn('[shutdown] Force exit after timeout');
        process.exit(1);
      }, 8000).unref();
    });
  });
}
