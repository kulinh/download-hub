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
  if (provider === 'r2' || provider === 'local' || provider === 'dropbox') return provider;
  if (fileItem?.storage?.dropboxPath) return 'dropbox';
  if (fileItem?.storage?.objectKey || fileItem?.storage?.r2Key || fileItem?.r2?.key) return 'r2';
  if (fileItem?.storage?.relativePath) return 'local';
  return 'local';
}

export function getDropboxPath(fileItem) {
  return fileItem?.storage?.dropboxPath || '';
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

  const provider = getStorageProvider(fileItem);
  const objectKey = provider === 'r2'
    ? normalizeObjectKey(fileItem?.storage?.objectKey || fileItem?.storage?.r2Key || fileItem?.r2?.key || '')
    : '';
  const relativePath = provider === 'local' ? getLocalRelativePath(fileItem) : '';
  const dropboxPath = provider === 'dropbox' ? (fileItem?.storage?.dropboxPath || '') : '';
  const downloadName = fileItem?.storage?.downloadName
    || fileItem?.r2?.downloadName
    || (objectKey ? path.basename(objectKey) : '')
    || (relativePath ? path.basename(relativePath) : '')
    || (dropboxPath ? path.basename(dropboxPath) : '')
    || 'download.bin';

  let storage = { ...(fileItem.storage || {}), provider, downloadName };

  if (provider === 'r2' && objectKey) {
    storage = { ...storage, objectKey, r2Key: objectKey };
    delete storage.relativePath;
    delete storage.dropboxPath;
  } else if (provider === 'dropbox') {
    storage = { ...storage, dropboxPath };
    delete storage.objectKey;
    delete storage.r2Key;
    delete storage.relativePath;
  } else {
    storage = { ...storage, ...(relativePath ? { relativePath } : {}) };
    delete storage.objectKey;
    delete storage.r2Key;
    delete storage.dropboxPath;
  }

  const normalized = { ...fileItem, storage, storageProvider: provider };

  if (provider === 'r2' && objectKey) {
    normalized.r2 = { ...(fileItem.r2 || {}), key: objectKey, downloadName };
  } else {
    delete normalized.r2;
  }

  return normalized;
}

export function normalizeFileEntries(entries = []) {
  if (!Array.isArray(entries)) return entries;
  return entries.map((entry) => normalizeFileEntry(entry));
}
