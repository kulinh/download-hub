(function () {
  'use strict';

  const script = document.currentScript;
  if (!script) return;

  const locale = script.dataset.locale || 'en';
  const messages = {
    connected: script.dataset.msgConnected,
    tokenRequired: script.dataset.msgTokenRequired,
    loading: script.dataset.msgLoading,
    loadSuccess: script.dataset.msgLoadSuccess,
    syncing: script.dataset.msgSyncing,
    syncSuccess: script.dataset.msgSyncSuccess,
    reloading: script.dataset.msgReloading,
    reloadSuccess: script.dataset.msgReloadSuccess,
    noExtra: script.dataset.msgNoExtra,
    noFiles: script.dataset.msgNoFiles,
    labels: {
      storagePath: script.dataset.labelStoragePath,
      indexPath: script.dataset.labelIndexPath,
      totalFiles: script.dataset.labelTotalFiles,
      extraFiles: script.dataset.labelExtraFiles,
      created: script.dataset.labelCreated,
      updated: script.dataset.labelUpdated,
      unchanged: script.dataset.labelUnchanged
    },
    columns: {
      slug: script.dataset.colSlug,
      relativePath: script.dataset.colRelativePath,
      published: script.dataset.colPublished,
      catalogSize: script.dataset.colCatalogSize,
      diskSize: script.dataset.colDiskSize,
      catalogSha: script.dataset.colCatalogSha,
      diskSha: script.dataset.colDiskSha,
      status: script.dataset.colStatus
    },
    status: {
      match: script.dataset.statusMatch,
      mismatch: script.dataset.statusMismatch,
      missing: script.dataset.statusMissing
    }
  };

  const form = document.getElementById('admin-auth-form');
  const tokenInput = document.getElementById('admin-token');
  const statusEl = document.getElementById('admin-status');
  const metaEl = document.getElementById('admin-meta');
  const tableEl = document.getElementById('admin-files-table');
  const extraEl = document.getElementById('admin-extra-files');
  const loadBtn = document.getElementById('load-files-btn');
  const syncBtn = document.getElementById('sync-files-btn');
  const reloadBtn = document.getElementById('reload-files-btn');

  if (!form || !tokenInput || !statusEl || !metaEl || !tableEl || !extraEl) return;

  const STORAGE_KEY = 'download888vn_admin_bearer';
  tokenInput.value = sessionStorage.getItem(STORAGE_KEY) || '';

  function setStatus(type, text) {
    statusEl.className = 'result';
    if (type === 'error') statusEl.classList.add('result-error');
    if (type === 'success') statusEl.classList.add('result-success');
    if (type === 'pending') statusEl.classList.add('result-pending');
    statusEl.textContent = text;
  }

  function getToken() {
    const raw = tokenInput.value.trim();
    if (!raw) return '';
    return raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw;
  }

  function authHeaders() {
    const token = getToken();
    if (!token) throw new Error('missing_token');
    return { Authorization: 'Bearer ' + token };
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(bytes);
  }

  function shortHash(value) {
    if (!value) return '—';
    if (value.length <= 20) return value;
    return value.slice(0, 10) + '…' + value.slice(-10);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMeta(payload, syncSummary) {
    const items = [
      [messages.labels.storagePath, payload.storagePath],
      [messages.labels.indexPath, payload.filesIndexPath],
      [messages.labels.totalFiles, String(payload.files.length)],
      [messages.labels.extraFiles, String(payload.extraDiskFiles.length)]
    ];

    if (syncSummary) {
      items.push(
        [messages.labels.created, String(syncSummary.created.length)],
        [messages.labels.updated, String(syncSummary.updated.length)],
        [messages.labels.unchanged, String(syncSummary.unchanged.length)]
      );
    }

    metaEl.innerHTML = items.map(([key, value]) => (
      '<div class="kv-row"><dt>' + escapeHtml(key) + '</dt><dd>' + escapeHtml(value) + '</dd></div>'
    )).join('');
  }

  function renderExtraFiles(extraFiles) {
    if (!extraFiles.length) {
      extraEl.innerHTML = '<p class="note">' + escapeHtml(messages.noExtra) + '</p>';
      return;
    }

    extraEl.innerHTML = [
      '<table class="admin-table">',
      '<thead><tr>',
      '<th>' + escapeHtml(messages.columns.relativePath) + '</th>',
      '<th>' + escapeHtml(messages.columns.diskSize) + '</th>',
      '<th>' + escapeHtml(messages.columns.diskSha) + '</th>',
      '</tr></thead><tbody>',
      extraFiles.map((file) => (
        '<tr>' +
          '<td><code>' + escapeHtml(file.relativePath) + '</code></td>' +
          '<td>' + escapeHtml(formatBytes(file.sizeBytes)) + '</td>' +
          '<td><code>' + escapeHtml(shortHash(file.checksumSha256)) + '</code></td>' +
        '</tr>'
      )).join(''),
      '</tbody></table>'
    ].join('');
  }

  function statusForRow(file) {
    if (!file.disk || !file.disk.exists) return messages.status.missing;
    if (file.sizeBytes !== file.disk.sizeBytes || file.checksumSha256 !== file.disk.checksumSha256) {
      return messages.status.mismatch;
    }
    return messages.status.match;
  }

  function renderFiles(files) {
    if (!files.length) {
      tableEl.innerHTML = '<p class="note">' + escapeHtml(messages.noFiles) + '</p>';
      return;
    }

    tableEl.innerHTML = [
      '<table class="admin-table">',
      '<thead><tr>',
      '<th>' + escapeHtml(messages.columns.slug) + '</th>',
      '<th>' + escapeHtml(messages.columns.relativePath) + '</th>',
      '<th>' + escapeHtml(messages.columns.published) + '</th>',
      '<th>' + escapeHtml(messages.columns.catalogSize) + '</th>',
      '<th>' + escapeHtml(messages.columns.diskSize) + '</th>',
      '<th>' + escapeHtml(messages.columns.catalogSha) + '</th>',
      '<th>' + escapeHtml(messages.columns.diskSha) + '</th>',
      '<th>' + escapeHtml(messages.columns.status) + '</th>',
      '</tr></thead><tbody>',
      files.map((file) => (
        '<tr>' +
          '<td>' + escapeHtml(file.slug || '—') + '</td>' +
          '<td><code>' + escapeHtml(file.storage?.relativePath || '—') + '</code></td>' +
          '<td>' + escapeHtml(String(Boolean(file.published))) + '</td>' +
          '<td>' + escapeHtml(formatBytes(file.sizeBytes)) + '</td>' +
          '<td>' + escapeHtml(formatBytes(file.disk?.sizeBytes)) + '</td>' +
          '<td><code>' + escapeHtml(shortHash(file.checksumSha256)) + '</code></td>' +
          '<td><code>' + escapeHtml(shortHash(file.disk?.checksumSha256)) + '</code></td>' +
          '<td><span class="status-pill status-pill--' + escapeHtml(statusForRow(file).toLowerCase().replace(/[^a-z]+/g, '-')) + '">' + escapeHtml(statusForRow(file)) + '</span></td>' +
        '</tr>'
      )).join(''),
      '</tbody></table>'
    ].join('');
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(function () { return { ok: false, error: 'invalid_json' }; });
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'request_failed');
    }
    return data;
  }

  let lastSyncSummary = null;

  async function loadFiles() {
    setStatus('pending', messages.loading);
    const payload = await fetchJson('/api/admin/files', {
      headers: authHeaders(),
      credentials: 'same-origin'
    });
    renderMeta(payload, lastSyncSummary);
    renderExtraFiles(payload.extraDiskFiles || []);
    renderFiles(payload.files || []);
    setStatus('success', messages.loadSuccess);
    return payload;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const token = getToken();
    if (!token) {
      setStatus('error', messages.tokenRequired);
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, token);
    setStatus('success', messages.connected);
  });

  loadBtn.addEventListener('click', async function () {
    try {
      await loadFiles();
    } catch (error) {
      setStatus('error', error.message === 'missing_token' ? messages.tokenRequired : error.message);
    }
  });

  syncBtn.addEventListener('click', async function () {
    try {
      setStatus('pending', messages.syncing);
      lastSyncSummary = await fetchJson('/api/admin/sync', {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'same-origin'
      });
      await loadFiles();
      setStatus('success', messages.syncSuccess);
    } catch (error) {
      setStatus('error', error.message === 'missing_token' ? messages.tokenRequired : error.message);
    }
  });

  reloadBtn.addEventListener('click', async function () {
    try {
      setStatus('pending', messages.reloading);
      await fetchJson('/api/admin/reload', {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'same-origin'
      });
      await loadFiles();
      setStatus('success', messages.reloadSuccess);
    } catch (error) {
      setStatus('error', error.message === 'missing_token' ? messages.tokenRequired : error.message);
    }
  });
})();
