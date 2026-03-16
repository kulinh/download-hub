import path from 'node:path';

export function normalizeObjectKey(value) {
  if (!value) return '';
  return String(value)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

export function getStorageProvider(fileItem) {
  const provider = fileItem?.storage?.provider || fileItem?.storageProvider;
  if (provider === 'r2' || provider === 'local') return provider;
  if (fileItem?.storage?.objectKey || fileItem?.storage?.r2Key || fileItem?.r2?.key) return 'r2';
  if (fileItem?.storage?.relativePath) return 'local';
  return 'local';
}

export function getStorageObjectKey(fileItem) {
  const provider = getStorageProvider(fileItem);
  if (provider !== 'r2') return '';
  return normalizeObjectKey(
    fileItem?.storage?.objectKey
    || fileItem?.storage?.r2Key
    || fileItem?.r2?.key
    || ''
  );
}

export function getLocalRelativePath(fileItem) {
  return normalizeObjectKey(fileItem?.storage?.relativePath || '');
}

export function getStorageDownloadName(fileItem) {
  return fileItem?.storage?.downloadName
    || fileItem?.r2?.downloadName
    || path.basename(getStorageObjectKey(fileItem))
    || 'download.bin';
}

export function normalizeFileEntry(fileItem) {
  if (!fileItem || typeof fileItem !== 'object') return fileItem;

  const provider = getStorageProvider(fileItem) === 'r2' ? 'r2' : 'local';
  const objectKey = provider === 'r2'
    ? normalizeObjectKey(fileItem?.storage?.objectKey || fileItem?.storage?.r2Key || fileItem?.r2?.key || '')
    : '';
  const relativePath = provider === 'local' ? getLocalRelativePath(fileItem) : '';
  const downloadName = getStorageDownloadName({ ...fileItem, storage: { ...(fileItem.storage || {}), objectKey, r2Key: objectKey } });

  let storage = {
    ...(fileItem.storage || {}),
    provider,
    ...(downloadName ? { downloadName } : {})
  };

  if (provider === 'r2' && objectKey) {
    storage = {
      ...storage,
      objectKey,
      r2Key: objectKey,
      ...(storage.relativePath ? { relativePath: storage.relativePath } : {})
    };
  } else {
    storage = {
      ...storage,
      ...(relativePath ? { relativePath } : {})
    };
    delete storage.objectKey;
    delete storage.r2Key;
  }

  const normalized = {
    ...fileItem,
    storage,
    storageProvider: provider
  };

  if (provider === 'r2' && objectKey) {
    normalized.r2 = {
      ...(fileItem.r2 || {}),
      key: objectKey,
      downloadName
    };
  } else if (normalized.r2 && !objectKey) {
    delete normalized.r2;
  }

  return normalized;
}

export function normalizeFileEntries(entries = []) {
  if (!Array.isArray(entries)) return entries;
  return entries.map((entry) => normalizeFileEntry(entry));
}
