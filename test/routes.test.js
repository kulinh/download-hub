import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import siteRouter from '../src/routes/site.js';
import { reloadConfig } from '../src/lib/config.js';

function makeApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => { req.cookies = {}; next(); });
  app.use(siteRouter);
  // error handler to return json
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  });
  return app;
}

describe('routes', () => {
  beforeEach(() => {
    reloadConfig({
      NODE_ENV: 'development',
      DOWNLOAD_TOKEN_SECRET: 'secret',
      TURNSTILE_ENABLED: 'false',
      HCAPTCHA_ENABLED: 'false'
    });
  });

  it('rejects verify endpoint when content-type is not form', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/verify/slug').set('Content-Type', 'application/json').send({});
    expect(res.status).toBe(415);
    expect(res.body.error).toBe('unsupported_media_type');
  });
});
