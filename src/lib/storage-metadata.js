import path from 'node:path';

export function normalizeObjectKey(value) {
  if (!value) return '';
  return String(value)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

export function getStorageObjectKey(fileItem) {
  return normalizeObjectKey(
    fileItem?.storage?.objectKey
    || fileItem?.storage?.r2Key
    || fileItem?.r2?.key
    || fileItem?.storage?.relativePath
    || ''
  );
}

export function getStorageDownloadName(fileItem) {
  return fileItem?.storage?.downloadName
    || fileItem?.r2?.downloadName
    || path.basename(getStorageObjectKey(fileItem))
    || 'download.bin';
}

export function normalizeFileEntry(fileItem) {
  if (!fileItem || typeof fileItem !== 'object') return fileItem;

  const objectKey = getStorageObjectKey(fileItem);
  const downloadName = getStorageDownloadName(fileItem);
  const relativePath = fileItem?.storage?.relativePath || objectKey || undefined;

  return {
    ...fileItem,
    storage: {
      ...(fileItem.storage || {}),
      ...(relativePath ? { relativePath } : {}),
      ...(objectKey ? { objectKey, r2Key: objectKey } : {}),
      ...(downloadName ? { downloadName } : {})
    },
    ...(objectKey ? {
      r2: {
        ...(fileItem.r2 || {}),
        key: objectKey,
        downloadName
      }
    } : {})
  };
}

export function normalizeFileEntries(entries = []) {
  if (!Array.isArray(entries)) return entries;
  return entries.map((entry) => normalizeFileEntry(entry));
}
