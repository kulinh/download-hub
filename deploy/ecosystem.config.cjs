// PM2 ecosystem config for download-888vn
// Usage: pm2 start deploy/ecosystem.config.cjs --env production
//
// CloudPanel Node.js apps can also be launched via the CloudPanel UI;
// this file is provided as a fallback for manual PM2 deployments.
//
// NOTE: cwd is the root of the app source (where package.json lives),
//       NOT the htdocs root. Adjust to match your actual deploy path.

module.exports = {
  apps: [
    {
      name: 'download-888vn',
      script: './src/server.js',
      cwd: '/home/cloudpanel/htdocs/download-888vn/app',
      interpreter: 'node',
      // No interpreter_args needed — app is native ESM ("type":"module"),
      // plain `node src/server.js` works without any extra flags.
      instances: 1,          // single instance — no session/state sharing needed
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      },
      // Restart on crash, max 10 times per minute before giving up
      max_restarts: 10,
      min_uptime: '5s',
      restart_delay: 2000,
      // Log
      out_file: '/var/log/pm2/download-888vn.out.log',
      error_file: '/var/log/pm2/download-888vn.err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Watch (disable in production; rely on explicit restart)
      watch: false
    }
  ]
};
