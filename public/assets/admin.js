/**
 * admin.js — Admin panel frontend
 * Session auth: no bearer token needed (cookie-based session from /admin/login).
 * R2 workflow: presign-upload endpoint → direct browser PUT to R2.
 */
(function () {
  'use strict';

  const script = document.currentScript;
  const locale = script.dataset.locale || 'en';
  const r2Enabled = script.dataset.r2Enabled === 'true';
  const msg = {
    loading: script.dataset.msgLoading || 'Loading…',
    loadSuccess: script.dataset.msgLoadSuccess || 'Loaded.',
    syncing: script.dataset.msgSyncing || 'Syncing…',
    syncSuccess: script.dataset.msgSyncSuccess || 'Synced.',
    reloading: script.dataset.msgReloading || 'Reloading…',
    reloadSuccess: script.dataset.msgReloadSuccess || 'Reloaded.',
    noExtra: script.dataset.msgNoExtra || 'No extra files.',
    noFiles: script.dataset.msgNoFiles || 'No files.'
  };
  const labels = {
    storagePath: script.dataset.labelStoragePath || 'Storage path',
    indexPath: script.dataset.labelIndexPath || 'Index path',
    totalFiles: script.dataset.labelTotalFiles || 'Total entries',
    extraFiles: script.dataset.labelExtraFiles || 'Extra disk files',
    created: script.dataset.labelCreated || 'Created',
    updated: script.dataset.labelUpdated || 'Updated',
    unchanged: script.dataset.labelUnchanged || 'Unchanged'
  };
  const cols = {
    slug: script.dataset.colSlug || 'slug',
    relativePath: script.dataset.colRelativePath || 'relativePath',
    published: script.dataset.colPublished || 'published',
    catalogSize: script.dataset.colCatalogSize || 'sizeBytes (json)',
    diskSize: script.dataset.colDiskSize || 'sizeBytes (disk)',
    catalogSha: script.dataset.colCatalogSha || 'SHA-256 (json)',
    diskSha: script.dataset.colDiskSha || 'SHA-256 (disk)',
    status: script.dataset.colStatus || 'Status',
    statusMatch: script.dataset.statusMatch || 'Match',
    statusMismatch: script.dataset.statusMismatch || 'Mismatch',
    statusMissing: script.dataset.statusMissing || 'Missing'
  };

  const $ = (id) => document.getElementById(id);
  const statusEl = $('admin-status');

  function setStatus(text, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = isError ? 'var(--color-error,#ef4444)' : '';
  }

  // ── API helpers (session cookie sent automatically by browser) ─────────────

  async function apiGet(path) {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (res.status === 401) {
      window.location.href = '/admin/login';
      throw new Error('session_expired');
    }
    return res.json();
  }

  async function apiPost(path, body = {}) {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body)
    });
    if (res.status === 401) {
      window.location.href = '/admin/login';
      throw new Error('session_expired');
    }
    return res.json();
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderMeta(data) {
    const el = $('admin-meta');
    if (!el) return;
    const entries = [
      [labels.storagePath, data.storagePath],
      [labels.indexPath, data.filesIndexPath],
      [labels.totalFiles, data.files?.length ?? 0],
      [labels.extraFiles, data.extraDiskFiles?.length ?? 0]
    ];
    el.innerHTML = entries
      .map(([k, v]) => `<div class="kv-row"><dt>${k}</dt><dd>${v}</dd></div>`)
      .join('');
  }

  function renderExtraFiles(extraDiskFiles) {
    const el = $('admin-extra-files');
    if (!el) return;
    if (!extraDiskFiles || extraDiskFiles.length === 0) {
      el.innerHTML = `<p class="empty-note">${msg.noExtra}</p>`;
      return;
    }
    const rows = extraDiskFiles.map((f) =>
      `<tr>
        <td>${f.relativePath}</td>
        <td>${f.sizeBytes ?? '—'}</td>
        <td title="${f.checksumSha256 || ''}">${f.checksumSha256 ? f.checksumSha256.slice(0, 12) + '…' : '—'}</td>
      </tr>`
    ).join('');
    el.innerHTML = `<table class="admin-table"><thead><tr>
      <th>${cols.relativePath}</th><th>${cols.diskSize}</th><th>${cols.diskSha}</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderFilesTable(files) {
    const el = $('admin-files-table');
    if (!el) return;
    if (!files || files.length === 0) {
      el.innerHTML = `<p class="empty-note">${msg.noFiles}</p>`;
      return;
    }

    const rows = files.map((f) => {
      let statusLabel = cols.statusMatch;
      let statusClass = 'status-match';
      if (!f.disk?.exists) {
        statusLabel = cols.statusMissing;
        statusClass = 'status-missing';
      } else if (
        f.disk.sizeBytes !== f.sizeBytes ||
        f.disk.checksumSha256 !== f.checksumSha256
      ) {
        statusLabel = cols.statusMismatch;
        statusClass = 'status-mismatch';
      }

      return `<tr>
        <td>${f.slug}</td>
        <td>${f.storage?.relativePath || f.storage?.r2Key || '—'}</td>
        <td>${f.published ? '✓' : '—'}</td>
        <td>${f.sizeBytes ?? '—'}</td>
        <td>${f.disk?.sizeBytes ?? '—'}</td>
        <td title="${f.checksumSha256 || ''}">${f.checksumSha256 ? f.checksumSha256.slice(0, 10) + '…' : '—'}</td>
        <td title="${f.disk?.checksumSha256 || ''}">${f.disk?.checksumSha256 ? f.disk.checksumSha256.slice(0, 10) + '…' : '—'}</td>
        <td class="${statusClass}">${statusLabel}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `<table class="admin-table">
      <thead><tr>
        <th>${cols.slug}</th>
        <th>${cols.relativePath}</th>
        <th>${cols.published}</th>
        <th>${cols.catalogSize}</th>
        <th>${cols.diskSize}</th>
        <th>${cols.catalogSha}</th>
        <th>${cols.diskSha}</th>
        <th>${cols.status}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  // ── Load files ─────────────────────────────────────────────────────────────

  const loadBtn = $('load-files-btn');
  if (loadBtn) {
    loadBtn.addEventListener('click', async () => {
      setStatus(msg.loading);
      try {
        const data = await apiGet('/api/admin/files');
        if (!data.ok) throw new Error(data.error || 'load_failed');
        renderMeta(data);
        renderExtraFiles(data.extraDiskFiles);
        renderFilesTable(data.files);
        setStatus(msg.loadSuccess);
      } catch (err) {
        if (err.message !== 'session_expired') setStatus(err.message, true);
      }
    });
  }

  // ── Sync files ─────────────────────────────────────────────────────────────

  const syncBtn = $('sync-files-btn');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      setStatus(msg.syncing);
      try {
        const data = await apiPost('/api/admin/sync');
        if (!data.ok) throw new Error(data.error || 'sync_failed');
        setStatus(
          `${msg.syncSuccess} ${labels.created}: ${data.created?.length ?? 0}, ${labels.updated}: ${data.updated?.length ?? 0}, ${labels.unchanged}: ${data.unchanged?.length ?? 0}`
        );
      } catch (err) {
        if (err.message !== 'session_expired') setStatus(err.message, true);
      }
    });
  }

  // ── Reload index ───────────────────────────────────────────────────────────

  const reloadBtn = $('reload-files-btn');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', async () => {
      setStatus(msg.reloading);
      try {
        const data = await apiPost('/api/admin/reload');
        if (!data.ok) throw new Error(data.error || 'reload_failed');
        setStatus(`${msg.reloadSuccess} (${data.count} files)`);
      } catch (err) {
        if (err.message !== 'session_expired') setStatus(err.message, true);
      }
    });
  }

  // ── R2 upload ─────────────────────────────────────────────────────────────

  const r2UploadBtn = $('r2-upload-btn');
  if (r2UploadBtn && r2Enabled) {
    r2UploadBtn.addEventListener('click', async () => {
      const key = prompt(locale === 'vi' ? 'Nhập R2 key (vd: windows/myfile.zip):' : 'Enter R2 key (e.g. windows/myfile.zip):');
      if (!key) return;

      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        setStatus(locale === 'vi' ? 'Đang lấy presigned URL…' : 'Getting presigned URL…');
        try {
          const params = new URLSearchParams({ key, contentType: file.type || 'application/octet-stream' });
          const data = await apiGet(`/api/admin/r2/presign-upload?${params}`);
          if (!data.ok || !data.url) throw new Error(data.error || 'presign_failed');

          setStatus(locale === 'vi' ? `Đang upload ${file.name} lên R2…` : `Uploading ${file.name} to R2…`);
          const uploadRes = await fetch(data.url, {
            method: 'PUT',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file
          });
          if (!uploadRes.ok) throw new Error(`R2 upload failed: ${uploadRes.status}`);
          setStatus(locale === 'vi' ? `✓ Upload thành công: ${key}` : `✓ Upload successful: ${key}`);
        } catch (err) {
          if (err.message !== 'session_expired') setStatus(err.message, true);
        }
      };
      input.click();
    });
  }
})();
