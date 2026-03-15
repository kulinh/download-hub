#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../src/lib/config.js';

function parseArgs(argv) {
  const args = {
    manifest: '',
    execute: false,
    skipExisting: true,
    limit: 0,
    prefix: '',
    results: ''
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--manifest' && argv[i + 1]) {
      args.manifest = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--execute') {
      args.execute = true;
      continue;
    }
    if (token === '--no-skip-existing') {
      args.skipExisting = false;
      continue;
    }
    if (token === '--limit' && argv[i + 1]) {
      args.limit = Number.parseInt(argv[i + 1], 10) || 0;
      i += 1;
      continue;
    }
    if (token === '--prefix' && argv[i + 1]) {
      args.prefix = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--results' && argv[i + 1]) {
      args.results = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      args.help = true;
    }
  }

  return args;
}

function requireR2Config() {
  if (!config.r2?.enabled || !config.r2?.accountId || !config.r2?.accessKeyId || !config.r2?.secretAccessKey || !config.r2?.bucket) {
    throw new Error('Missing R2 config. Set R2_ENABLED, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.');
  }
}

function createClient() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey
    }
  });
}

function normalizeKey(prefix, key) {
  const base = String(key || '').replace(/^\/+/, '');
  const pfx = String(prefix || '').replace(/^\/+|\/+$/g, '');
  return pfx ? `${pfx}/${base}` : base;
}

async function objectExists(client, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: config.r2.bucket, Key: key }));
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return false;
    if (error?.Code === 'NotFound') return false;
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log([
      'Usage: node scripts/migrate-upload-r2.mjs --manifest PATH [--execute] [--limit N] [--prefix PREFIX] [--results PATH]',
      '',
      'Safe default: dry-run only. Add --execute to actually upload.',
      'Default behavior skips keys that already exist in R2. Use --no-skip-existing to force PUT.'
    ].join('\n'));
    return;
  }

  if (!args.manifest) {
    throw new Error('--manifest is required');
  }

  requireR2Config();

  const manifestPath = path.resolve(process.cwd(), args.manifest);
  const manifestRaw = await fsp.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  if (!Array.isArray(manifest)) {
    throw new Error('Manifest must be a JSON array');
  }

  const selected = (args.limit > 0 ? manifest.slice(0, args.limit) : manifest).map((item) => ({
    ...item,
    effectiveKey: normalizeKey(args.prefix, item.r2Key)
  }));

  if (!args.execute) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      bucket: config.r2.bucket,
      manifestPath,
      selected: selected.length,
      skipExisting: args.skipExisting,
      preview: selected.slice(0, 20).map((item) => ({
        relativePath: item.relativePath,
        effectiveKey: item.effectiveKey,
        sizeBytes: item.sizeBytes,
        demo: item.demo,
        published: item.published
      }))
    }));
    return;
  }

  const client = createClient();
  const results = [];

  for (const item of selected) {
    const filePath = path.resolve(String(item.absolutePath || ''));
    const key = item.effectiveKey;

    if (!key) {
      results.push({ ok: false, key: null, error: 'missing_r2_key', relativePath: item.relativePath });
      continue;
    }

    await fsp.access(filePath);

    if (args.skipExisting && await objectExists(client, key)) {
      results.push({ ok: true, key, skipped: true, reason: 'already_exists', relativePath: item.relativePath });
      continue;
    }

    await client.send(new PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: item.mimeType || 'application/octet-stream'
    }));

    results.push({ ok: true, key, uploaded: true, relativePath: item.relativePath, sizeBytes: item.sizeBytes });
  }

  const payload = {
    ok: true,
    dryRun: false,
    bucket: config.r2.bucket,
    uploaded: results.filter((item) => item.uploaded).length,
    skipped: results.filter((item) => item.skipped).length,
    failed: results.filter((item) => item.ok === false).length,
    results
  };

  if (args.results) {
    const outputPath = path.resolve(process.cwd(), args.results);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify(payload));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
