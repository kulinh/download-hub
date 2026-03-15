import path from 'node:path';

function normalizeRelativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

export function planR2Key(relativePath) {
  return normalizeRelativePath(relativePath);
}

export function summarizeCatalogMigration(catalogEntries = [], scannedFiles = []) {
  const scannedByRelativePath = new Map(
    scannedFiles
      .filter((item) => item?.relativePath)
      .map((item) => [normalizeRelativePath(item.relativePath), item])
  );

  const catalogSummary = catalogEntries.map((entry) => {
    const relativePath = normalizeRelativePath(entry?.storage?.relativePath || '');
    const disk = relativePath ? scannedByRelativePath.get(relativePath) || null : null;
    const plannedR2Key = entry?.r2?.key || (relativePath ? planR2Key(relativePath) : '');

    return {
      slug: entry?.slug || null,
      id: entry?.id || null,
      relativePath: relativePath || null,
      diskExists: Boolean(disk),
      plannedR2Key: plannedR2Key || null,
      published: Boolean(entry?.published),
      demo: Boolean(entry?.demo),
      sizeBytesCatalog: Number(entry?.sizeBytes || 0),
      sizeBytesDisk: disk?.sizeBytes ?? null,
      checksumCatalog: entry?.checksumSha256 || '',
      checksumDisk: disk?.checksumSha256 || '',
      needsMetadataRefresh: Boolean(
        disk && (
          Number(entry?.sizeBytes || 0) !== Number(disk?.sizeBytes || 0)
          || String(entry?.checksumSha256 || '') !== String(disk?.checksumSha256 || '')
          || String(entry?.mimeType || '') !== String(disk?.mimeType || '')
        )
      )
    };
  });

  const catalogByRelativePath = new Map(
    catalogSummary
      .filter((item) => item.relativePath)
      .map((item) => [item.relativePath, item])
  );

  const orphansOnDisk = scannedFiles
    .filter((item) => !catalogByRelativePath.has(normalizeRelativePath(item.relativePath)))
    .map((item) => ({
      relativePath: normalizeRelativePath(item.relativePath),
      absolutePath: item.absolutePath,
      sizeBytes: item.sizeBytes,
      checksumSha256: item.checksumSha256,
      mimeType: item.mimeType,
      plannedR2Key: planR2Key(item.relativePath)
    }));

  const missingOnDisk = catalogSummary
    .filter((item) => item.relativePath && !item.diskExists)
    .map((item) => ({
      slug: item.slug,
      relativePath: item.relativePath,
      plannedR2Key: item.plannedR2Key,
      published: item.published,
      demo: item.demo
    }));

  const uploadManifest = scannedFiles.map((scan) => {
    const relativePath = normalizeRelativePath(scan.relativePath);
    const matchingCatalog = catalogEntries.filter((entry) => normalizeRelativePath(entry?.storage?.relativePath || '') === relativePath);
    const primaryCatalog = matchingCatalog[0] || null;
    return {
      relativePath,
      absolutePath: scan.absolutePath,
      r2Key: primaryCatalog?.r2?.key || planR2Key(relativePath),
      sizeBytes: scan.sizeBytes,
      checksumSha256: scan.checksumSha256,
      mimeType: scan.mimeType || 'application/octet-stream',
      downloadName: primaryCatalog?.storage?.downloadName || path.basename(relativePath),
      catalogSlugs: matchingCatalog.map((entry) => entry.slug).filter(Boolean),
      hasCatalogEntry: matchingCatalog.length > 0,
      published: matchingCatalog.some((entry) => Boolean(entry?.published)),
      demo: matchingCatalog.some((entry) => Boolean(entry?.demo)),
      updatedAt: scan.updatedAt
    };
  }).sort((a, b) => a.r2Key.localeCompare(b.r2Key));

  const catalogPreview = catalogEntries.map((entry) => {
    const relativePath = normalizeRelativePath(entry?.storage?.relativePath || '');
    const disk = relativePath ? scannedByRelativePath.get(relativePath) || null : null;
    const next = JSON.parse(JSON.stringify(entry));
    const plannedR2Key = entry?.r2?.key || (relativePath ? planR2Key(relativePath) : undefined);

    if (plannedR2Key) {
      next.r2 = {
        ...(next.r2 || {}),
        key: plannedR2Key,
        downloadName: next?.r2?.downloadName || next?.storage?.downloadName || (relativePath ? path.basename(relativePath) : undefined)
      };
    }

    if (disk) {
      next.sizeBytes = disk.sizeBytes;
      next.checksumSha256 = disk.checksumSha256;
      next.mimeType = next.mimeType || disk.mimeType;
      next.updatedAt = disk.updatedAt;
    }

    return next;
  });

  const demoEntries = catalogSummary.filter((item) => item.demo);
  const publishRiskEntries = catalogSummary.filter((item) => item.demo && item.published);
  const metadataRefreshEntries = catalogSummary.filter((item) => item.needsMetadataRefresh);

  return {
    summary: {
      catalogEntries: catalogEntries.length,
      scannedDiskFiles: scannedFiles.length,
      uploadCandidates: uploadManifest.length,
      orphanDiskFiles: orphansOnDisk.length,
      missingCatalogFiles: missingOnDisk.length,
      demoEntries: demoEntries.length,
      publishedDemoEntries: publishRiskEntries.length,
      metadataRefreshNeeded: metadataRefreshEntries.length
    },
    catalogSummary,
    orphansOnDisk,
    missingOnDisk,
    demoEntries: demoEntries.map((item) => ({
      slug: item.slug,
      relativePath: item.relativePath,
      published: item.published,
      plannedR2Key: item.plannedR2Key
    })),
    publishRiskEntries: publishRiskEntries.map((item) => ({
      slug: item.slug,
      relativePath: item.relativePath,
      plannedR2Key: item.plannedR2Key
    })),
    metadataRefreshEntries: metadataRefreshEntries.map((item) => ({
      slug: item.slug,
      relativePath: item.relativePath,
      plannedR2Key: item.plannedR2Key
    })),
    uploadManifest,
    catalogPreview
  };
}
