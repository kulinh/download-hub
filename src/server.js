import cookieParser from 'cookie-parser';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, isProduction } from './lib/config.js';
import { t } from './lib/i18n.js';
import { pickLocale } from './lib/utils.js';
import { applyAppSecurity } from './middleware/security.js';
import { requestLogger } from './middleware/logging.js';
import siteRouter from './routes/site.js';
import { registerGracefulShutdown } from './middleware/shutdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
applyAppSecurity(app);
app.use(requestLogger(!isProduction())); // verbose request logs in dev only
app.set('view engine', 'ejs');
app.set('views', path.resolve(__dirname, '../views'));
app.use(express.urlencoded({
  extended: false,
  limit: config.maxBodySize,
  type: 'application/x-www-form-urlencoded'
}));
app.use(cookieParser());

// Static assets (immutable cache for CSS/JS bundles)
app.use('/assets', express.static(path.resolve(__dirname, '../public/assets'), {
  etag: true,
  immutable: true,
  maxAge: '1d',
  fallthrough: false,
  dotfiles: 'ignore'
}));

// robots.txt and .well-known/security.txt (short cache, allow dotfiles)
app.use(express.static(path.resolve(__dirname, '../public'), {
  etag: true,
  maxAge: '1h',
  dotfiles: 'allow',  // required for .well-known/security.txt
  index: false        // never serve a directory index
}));

app.use(siteRouter);

// 404 handler
app.use((req, res) => {
  const locale = pickLocale(req, config.allowedLocales);
  res.status(404).render('error', {
    locale,
    title: '404',
    message: locale === 'vi' ? 'Không tìm thấy trang.' : 'Not Found',
    t: (key) => t(locale, key)
  });
});

// Error handler
app.use((error, req, res, _next) => {
  const statusCode = error.statusCode || 500;
  const locale = pickLocale(req, config.allowedLocales);
  const message = error.publicMessage?.[locale]
    || (statusCode >= 500
      ? (locale === 'vi' ? 'Máy chủ bận. Thử lại sau.' : 'Server error. Please try again later.')
      : error.message);

  if (isProduction() && statusCode >= 500) {
    console.error('[error]', { path: req.path, statusCode, message: error.message, stack: error.stack });
  }

  if (req.path.startsWith('/api/')) {
    return res.status(statusCode).json({ ok: false, error: message });
  }
  return res.status(statusCode).render('error', {
    locale,
    title: String(statusCode),
    message,
    t: (key) => t(locale, key)
  });
});

const server = app.listen(config.port, () => {
  console.log(`download-888vn listening on :${config.port} [${config.nodeEnv}]`);
});

registerGracefulShutdown(server);
