import { buildConfig } from '../src/lib/config.js';

try {
  buildConfig(process.env);
  console.log('Config OK');
  process.exit(0);
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
