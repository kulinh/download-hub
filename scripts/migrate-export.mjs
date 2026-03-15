#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/lib/config.js';
import { readRawFilesIndex, scanStorageFiles } from '../src/lib/file-store.js';
import { summarizeCatalogMigration } from '../src/lib/migration-tools.js';

function parseArgs(argv) {
  const args = { outDir: '', pretty: true };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--out' && argv[i + 1]) {
      args.outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--compact') {
      args.pretty = false;
    }
    if (token === '--help' || token === '-h') {
      args.help = true;
    }
  }
  return args;
}

function timestampTag() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeJson(filePath, value, pretty) {
  const content = pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value);
  await fs.writeFile(filePath, content, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log([
      'Usage: node scripts/migrate-export.mjs [--out DIR] [--compact]',
      '',
      'Exports current files.json, scans local storage tree, and prepares migration artifacts:',
      '  - catalog-export.json',
      '  - disk-scan.json',
      '  - migration-report.json',
      '  - r2-upload-manifest.json',
      '  - catalog-r2-preview.json',
      '',
      'Env-driven paths:',
      `  FILES_INDEX_PATH=${config.filesIndexPath}`,
      `  FILES_STORAGE_PATH=${config.filesStoragePath}`
    ].join('\n'));
    return;
  }

  const outDir = path.resolve(process.cwd(), args.outDir || `./work/migration-export-${timestampTag()}`);
  await fs.mkdir(outDir, { recursive: true });

  const [catalog, diskScan] = await Promise.all([
    readRawFilesIndex(),
    scanStorageFiles()
  ]);

  const report = summarizeCatalogMigration(catalog, diskScan);
  const runMeta = {
    generatedAt: new Date().toISOString(),
    filesIndexPath: config.filesIndexPath,
    filesStoragePath: config.filesStoragePath,
    outDir
  };

  await Promise.all([
    writeJson(path.join(outDir, 'catalog-export.json'), catalog, args.pretty),
    writeJson(path.join(outDir, 'disk-scan.json'), diskScan, args.pretty),
    writeJson(path.join(outDir, 'migration-report.json'), { ...runMeta, ...report }, args.pretty),
    writeJson(path.join(outDir, 'r2-upload-manifest.json'), report.uploadManifest, args.pretty),
    writeJson(path.join(outDir, 'catalog-r2-preview.json'), report.catalogPreview, args.pretty)
  ]);

  console.log(JSON.stringify({
    ok: true,
    outDir,
    files: [
      'catalog-export.json',
      'disk-scan.json',
      'migration-report.json',
      'r2-upload-manifest.json',
      'catalog-r2-preview.json'
    ],
    summary: report.summary
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
