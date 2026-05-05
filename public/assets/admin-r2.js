/**
 * admin-r2.js — R2-oriented admin UI
 * Manages R2 file inventory: list, upload, delete, publish/unpublish, edit metadata.
 * All strings from data-* attributes on this script tag for bilingual support.
 */
(function () {
  'use strict';

  const script = document.currentScript;
  if (!script) return;

  const locale = script.dataset.locale || 'en';
  const csrf = script.dataset.csrf || '';
  let r2ConfiguredFlag = false;
  let localAvailableFlag = false;

  const msgs = {
    r2Ok: script.dataset.msgR2Ok,
    r2Missing: script.dataset.msgR2Missing,
    r2LocalOnly: script.dataset.msgR2LocalOnly,
    loading: script.dataset.msgLoading,
    loaded: script.dataset.msgLoaded,
    syncing: script.dataset.msgSyncing,
    synced: script.dataset.msgSynced,
    uploading: script.dataset.msgUploading,
    uploadOk: script.dataset.msgUploadOk,
    uploadErr: script.dataset.msgUploadErr,
    uploadBlocked: script.dataset.msgUploadBlocked || 'Upload blocked by config/CORS',
    deleting: script.dataset.msgDeleting,
    deleted: script.dataset.msgDeleted,
    deleteConfirm: script.dataset.msgDeleteConfirm,
    saved: script.dataset.msgSaved,
    published: script.dataset.msgPublished,
    unpublished: script.dataset.msgUnpublished,
    noFiles: script.dataset.msgNoFiles,
    r2Unavail: script.dataset.msgR2Unavail,
    r2PutFailed: script.dataset.msgR2PutFailed || 'R2 upload failed',
    r2CORS: script.dataset.msgR2Cors || 'Check R2 CORS config and accountId/bucket'
  };

  const labels = {
    key: script.dataset.colKey || 'R2 Key',
    size: script.dataset.colSize || 'Size',
    modified: script.dataset.colModified || 'Modified',
    published: script.dataset.colPublished || 'Published',
    actions: script.dataset.colActions || 'Actions',
    edit: script.dataset.labelEdit || 'Edit',
    delete: script.dataset.labelDelete || 'Delete',
    publish: script.dataset.labelPublish || 'Publish',
    unpublish: script.dataset.labelUnpublish || 'Unpublish',
    titleVi: script.dataset.labelTitleVi || 'Title (VI)',
    titleEn: script.dataset.labelTitleEn || 'Title (EN)',
    summaryVi: script.dataset.labelSummaryVi || 'Summary (VI)',
    summaryEn: script.dataset.labelSummaryEn || 'Summary (EN)',
    version: script.dataset.labelVersion || 'Version',
    platform: script.dataset.labelPlatform || 'Platform',
    save: script.dataset.labelSave || 'Save',
    cancel: script.dataset.labelCancel || 'Cancel',
    files: script.dataset.labelFiles || 'files',
    chooseFile: script.dataset.labelChooseFile || 'Choose files to upload',
    r2Path: script.dataset.labelR2Path || 'R2 path (leave blank = original filename)',
    uploadBtn: script.dataset.labelUploadBtn || 'Start upload'
  };

  // --- DOM refs ---
  const r2StatusCard = document.getElementById('r2-config-status');
  const adminToolbar = document.getElementById('admin-toolbar');
  const inventoryWrap = document.getElementById('r2-inventory-wrap');
  const fileBadge = document.getElementById('file-count-badge');
  const toolbarStatus = document.getElementById('toolbar-status');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnSyncIndex = document.getElementById('btn-sync-index');
  const uploadInput = document.getElementById('r2-upload-input');
  const localUploadInput = document.getElementById('local-upload-input');
  const uploadModal = document.getElementById('upload-modal');
  const uploadModalBody = document.getElementById('upload-modal-body');
  const uploadModalClose = document.getElementById('upload-modal-close');
  const uploadModalTitle = document.getElementById('upload-modal-title');
  const editModal = document.getElementById('edit-modal');
  const editModalBody = document.getElementById('edit-modal-body');
  const editModalClose = document.getElementById('edit-modal-close');

  // Accessibility helpers
  function focusTrap(modalEl) {
    if (!modalEl) return;
    const focusable = modalEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    modalEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    // Move focus to modal when opened
    first.focus();
  }

  // --- Utility ---
  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
    const val = bytes / Math.pow(1024, i);
    return (i === 0 ? val : val.toFixed(1)) + ' ' + units[i];
  }

  function formatDate(isoString) {
    if (!isoString) return '—';
    try {
      return new Date(isoString).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (_) { return isoString; }
  }

  function setStatus(type, text) {
    if (!toolbarStatus) return;
    toolbarStatus.className = 'result';
    if (type === 'error') toolbarStatus.classList.add('result-error');
    if (type === 'success') toolbarStatus.classList.add('result-success');
    if (type === 'pending') toolbarStatus.classList.add('result-pending');
    toolbarStatus.textContent = text;
  }

  // --- API helpers ---
  async function apiFetch(url, options) {
    const defaults = {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }
    };
    const merged = Object.assign({}, defaults, options);
    if (options && options.headers) {
      merged.headers = Object.assign({}, defaults.headers, options.headers);
    }
    if (!merged.method && /^\/api\/admin\/(r2|local)\/files\//.test(url)) {
      merged.method = 'DELETE';
    }
    const resp = await fetch(url, merged);
    let data;
    try { data = await resp.json(); } catch (_) { data = { ok: false, error: 'invalid_json' }; }
    if (!resp.ok || !data.ok) throw new Error(data.error || 'request_failed');
    return data;
  }

  // --- R2 config check ---
  async function checkR2Config() {
    try {
      const data = await apiFetch('/api/admin/r2/status');
      r2ConfiguredFlag = Boolean(data.r2Configured);
      localAvailableFlag = Boolean(data.localAvailable);
      if (data.r2Configured || data.localAvailable) {
        r2StatusCard.innerHTML = '<div class="alert alert-success"><span aria-hidden="true">✅</span> ' + esc(data.r2Configured ? msgs.r2Ok : msgs.r2LocalOnly) + '</div>';
        if (adminToolbar) adminToolbar.style.display = '';
        loadInventory({ r2Configured: r2ConfiguredFlag, localAvailable: localAvailableFlag });
      } else {
        r2StatusCard.innerHTML = '<div class="alert alert-warn"><span aria-hidden="true">⚠️</span> ' + esc(msgs.r2Missing) + '</div>';
        if (inventoryWrap) {
          inventoryWrap.innerHTML = '<div class="empty-state"><span class="empty-state-icon" aria-hidden="true">🔧</span>' +
            '<h3 class="empty-state-heading">' + esc(msgs.r2Unavail) + '</h3></div>';
        }
      }
    } catch (err) {
      r2StatusCard.innerHTML = '<div class="alert alert-error"><span aria-hidden="true">❌</span> ' + esc(err.message) + '</div>';
    }
  }

  // --- Load R2 inventory ---
  let currentFiles = [];

  async function loadInventory(options = {}) {
    // Allow callers to override but persist flags from config check.
    const r2Configured = options.r2Configured !== undefined ? Boolean(options.r2Configured) : r2ConfiguredFlag;
    const localAvailable = options.localAvailable !== undefined ? Boolean(options.localAvailable) : localAvailableFlag;
    r2ConfiguredFlag = r2Configured;
    localAvailableFlag = localAvailable;
    setStatus('pending', msgs.loading);
    try {
      const promises = [];
      if (r2Configured) {
        promises.push(apiFetch('/api/admin/r2/files'));
      } else {
        promises.push(Promise.resolve(null));
      }
      if (localAvailable) {
        promises.push(apiFetch('/api/admin/local/files'));
      } else {
        promises.push(Promise.resolve(null));
      }

      promises.push(apiFetch('/api/admin/dropbox/files').catch(function () { return null; }));

      const [r2Data, localData, dropboxData] = await Promise.all(promises);
      const merged = [];
      const seen = new Set();

      if (r2Data?.files?.length) {
        r2Data.files.forEach((f) => {
          const key = 'r2:' + (f.slug || f.r2Key || f.storage?.relativePath || '');
          if (seen.has(key)) return;
          seen.add(key);
          merged.push({ ...f, storageProvider: 'r2' });
        });
      }

      if (localData?.files?.length) {
        localData.files.forEach((f) => {
          const key = 'local:' + (f.slug || f.storage?.relativePath || '');
          if (seen.has(key)) return;
          seen.add(key);
          merged.push({ ...f, storageProvider: 'local' });
        });
      }

      if (dropboxData?.files?.length) {
        dropboxData.files.forEach((f) => {
          const key = 'dropbox:' + (f.slug || f.storage?.dropboxPath || '');
          if (seen.has(key)) return;
          seen.add(key);
          merged.push({ ...f, storageProvider: 'dropbox' });
        });
      }

      currentFiles = merged;
      renderInventory(currentFiles, { r2Configured, localAvailable });
      if (fileBadge) {
        fileBadge.style.display = '';
        fileBadge.textContent = currentFiles.length + ' ' + labels.files;
      }
      setStatus('success', msgs.loaded);
    } catch (err) {
      setStatus('error', err.message);
      window.__r2Diag?.set?.(err);
    }
  }

  function renderInventory(files, opts = {}) {
    const r2Configured = Boolean(opts.r2Configured);
    if (!inventoryWrap) return;
    if (!files.length) {
      inventoryWrap.innerHTML = '<div class="empty-state"><span class="empty-state-icon" aria-hidden="true">📭</span>' +
        '<h3 class="empty-state-heading">' + esc(msgs.noFiles) + '</h3></div>';
      return;
    }

    const rows = files.map((file) => {
      const isPublished = Boolean(file.published);
      const publishedCell = isPublished
        ? '<span class="status-pill status-pill--match">✓</span>'
        : '<span class="status-pill status-pill--missing">—</span>';
      const slugOrKey = file.slug || file.r2Key || file.storage?.relativePath || file.storage?.dropboxPath;
      const storageProvider = file.storageProvider || file.storage?.provider || (r2Configured ? 'r2' : 'local');
      const badge = storageProvider === 'dropbox'
        ? '<span class="r2-badge r2-badge--dropbox">Dropbox</span>'
        : storageProvider === 'local'
        ? '<span class="r2-badge">LOCAL</span>'
        : '<span class="r2-badge">R2</span>';
      const keyCellValue = storageProvider === 'dropbox'
        ? (file.storage?.dropboxPath || file.slug || '—')
        : storageProvider === 'local'
        ? (file.storage?.relativePath || file.slug || '—')
        : (file.r2Key || file.storage?.objectKey || '—');

      const publishBtn = isPublished
        ? '<button type="button" class="button button-ghost button-xs btn-unpublish" data-slug="' + esc(slugOrKey) + '" data-provider="' + esc(storageProvider) + '">' + esc(labels.unpublish) + '</button>'
        : '<button type="button" class="button button-ghost button-xs btn-publish" data-slug="' + esc(slugOrKey) + '" data-provider="' + esc(storageProvider) + '">' + esc(labels.publish) + '</button>';

      return '<tr>' +
        '<td>' + badge + ' <code class="r2-key-cell" title="' + esc(keyCellValue) + '">' + esc(keyCellValue) + '</code></td>' +
        '<td class="num-cell">' + esc(formatBytes(file.sizeBytes)) + '</td>' +
        '<td class="date-cell">' + esc(formatDate(file.updatedAt || file.lastModified)) + '</td>' +
        '<td class="center-cell">' + publishedCell + '</td>' +
        '<td><div class="actions-cell">' +
          '<button type="button" class="button button-secondary button-xs btn-edit" data-slug="' + esc(slugOrKey) + '" data-provider="' + esc(storageProvider) + '">' + esc(labels.edit) + '</button>' +
          publishBtn +
          '<button type="button" class="button button-danger button-xs btn-delete" data-slug="' + esc(slugOrKey) + '" data-key="' + esc(file.r2Key || file.storage?.relativePath || '') + '" data-provider="' + esc(storageProvider) + '">' + esc(labels.delete) + '</button>' +
        '</div></td>' +
      '</tr>';
    });

    inventoryWrap.innerHTML = '<table class="admin-table r2-table">' +
      '<thead><tr>' +
        '<th>' + esc(labels.key) + '</th>' +
        '<th class="num-cell">' + esc(labels.size) + '</th>' +
        '<th class="date-cell">' + esc(labels.modified) + '</th>' +
        '<th class="center-cell">' + esc(labels.published) + '</th>' +
        '<th>' + esc(labels.actions) + '</th>' +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';

    // Bind row actions
    inventoryWrap.querySelectorAll('.btn-edit').forEach(function (btn) {
      btn.addEventListener('click', function () { openEditModal(btn.dataset.slug, btn.dataset.provider || 'r2'); });
    });
    inventoryWrap.querySelectorAll('.btn-delete').forEach(function (btn) {
      btn.addEventListener('click', function () { deleteFile(btn.dataset.slug, btn.dataset.key, btn.dataset.provider || 'r2'); });
    });
    inventoryWrap.querySelectorAll('.btn-publish').forEach(function (btn) {
      btn.addEventListener('click', function () { togglePublish(btn.dataset.slug, true, btn.dataset.provider || 'r2'); });
    });
    inventoryWrap.querySelectorAll('.btn-unpublish').forEach(function (btn) {
      btn.addEventListener('click', function () { togglePublish(btn.dataset.slug, false, btn.dataset.provider || 'r2'); });
    });
  }

  // --- Sync index ---
  async function syncIndex() {
    setStatus('pending', msgs.syncing);
    try {
      await apiFetch('/api/admin/r2/sync', { method: 'POST' });
      await loadInventory({ r2Configured: r2ConfiguredFlag, localAvailable: localAvailableFlag });
      setStatus('success', msgs.synced);
    } catch (err) {
      setStatus('error', err.message);
      window.__r2Diag?.set?.(err);
    }
  }

  // --- Delete ---
  async function deleteFile(slug, key, storageProvider = 'r2') {
    if (!confirm(msgs.deleteConfirm)) return;
    setStatus('pending', msgs.deleting);
    try {
      const endpoint = storageProvider === 'local' ? '/api/admin/local/files/' : '/api/admin/r2/files/';
      await apiFetch(endpoint + encodeURIComponent(slug || key), { method: 'DELETE' });
      await loadInventory({ r2Configured: r2ConfiguredFlag, localAvailable: localAvailableFlag });
      setStatus('success', msgs.deleted);
    } catch (err) {
      setStatus('error', err.message);
      window.__r2Diag?.set?.(err);
    }
  }

  // --- Toggle publish ---
  async function togglePublish(slug, publish, storageProvider = 'r2') {
    setStatus('pending', msgs.loading);
    try {
      const endpoint = storageProvider === 'local' ? '/api/admin/local/files/' : '/api/admin/r2/files/';
      // dropbox uses /api/admin/r2/files/ — routes are slug-based and work for any provider
      await apiFetch(endpoint + encodeURIComponent(slug) + '/publish', {
        method: 'PATCH',
        body: JSON.stringify({ published: publish })
      });
      await loadInventory({ r2Configured: r2ConfiguredFlag, localAvailable: localAvailableFlag });
      setStatus('success', publish ? msgs.published : msgs.unpublished);
    } catch (err) {
      setStatus('error', err.message);
    }
  }

  // --- Edit modal ---
  function openEditModal(slug, provider = 'r2') {
    const file = currentFiles.find(function (f) { return (f.slug || f.r2Key || f.storage?.relativePath) === slug; });
    if (!file || !editModal || !editModalBody) return;
    const storageProvider = provider || file.storageProvider || file.storage?.provider || 'r2';

    const titleVi = (file.title && file.title.vi) || '';
    const titleEn = (file.title && file.title.en) || '';
    const summaryVi = (file.summary && file.summary.vi) || '';
    const summaryEn = (file.summary && file.summary.en) || '';
    const version = file.version || '1.0.0';
    const platform = file.platform || 'Generic';

    editModalBody.innerHTML =
      '<form id="edit-file-form" class="edit-form">' +
        '<input type="hidden" name="slug" value="' + esc(slug) + '" />' +
        '<div class="field-group"><label class="field-label">' + esc(labels.titleVi) + '</label>' +
          '<input class="text-input" name="titleVi" value="' + esc(titleVi) + '" required /></div>' +
        '<div class="field-group"><label class="field-label">' + esc(labels.titleEn) + '</label>' +
          '<input class="text-input" name="titleEn" value="' + esc(titleEn) + '" required /></div>' +
        '<div class="field-group"><label class="field-label">' + esc(labels.summaryVi) + '</label>' +
          '<textarea class="text-input text-area" name="summaryVi" rows="2">' + esc(summaryVi) + '</textarea></div>' +
        '<div class="field-group"><label class="field-label">' + esc(labels.summaryEn) + '</label>' +
          '<textarea class="text-input text-area" name="summaryEn" rows="2">' + esc(summaryEn) + '</textarea></div>' +
        '<div class="form-row">' +
          '<div class="field-group"><label class="field-label">' + esc(labels.version) + '</label>' +
            '<input class="text-input" name="version" value="' + esc(version) + '" /></div>' +
          '<div class="field-group"><label class="field-label">' + esc(labels.platform) + '</label>' +
            '<select class="text-input" name="platform">' +
              ['Generic','Windows','macOS','Linux','Android','iOS'].map(function (p) {
                return '<option value="' + esc(p) + '"' + (platform === p ? ' selected' : '') + '>' + esc(p) + '</option>';
              }).join('') +
            '</select></div>' +
        '</div>' +
        '<div class="modal-actions">' +
          '<button type="submit" class="button">' + esc(labels.save) + '</button>' +
          '<button type="button" class="button button-ghost" id="edit-cancel-btn">' + esc(labels.cancel) + '</button>' +
        '</div>' +
        '<p id="edit-form-status" class="result" role="status" aria-live="polite"></p>' +
      '</form>';

    editModal.hidden = false;
    focusTrap(editModal);
    document.getElementById('edit-cancel-btn').addEventListener('click', closeEditModal);

    document.getElementById('edit-file-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const statusEl = document.getElementById('edit-form-status');
      statusEl.className = 'result result-pending';
      statusEl.textContent = msgs.loading;
      try {
        const endpoint = storageProvider === 'local' ? '/api/admin/local/files/' : '/api/admin/r2/files/';
        // dropbox uses /api/admin/r2/files/ — routes are slug-based and work for any provider
        await apiFetch(endpoint + encodeURIComponent(slug) + '/metadata', {
          method: 'PATCH',
          body: JSON.stringify({
            title: { vi: fd.get('titleVi'), en: fd.get('titleEn') },
            summary: { vi: fd.get('summaryVi'), en: fd.get('summaryEn') },
            version: fd.get('version'),
            platform: fd.get('platform')
          })
        });
        closeEditModal();
        await loadInventory({ r2Configured: r2ConfiguredFlag, localAvailable: localAvailableFlag });
        setStatus('success', msgs.saved);
      } catch (err) {
        statusEl.className = 'result result-error';
        statusEl.textContent = err.message;
        window.__r2Diag?.set?.(err);
      }
    });
  }

  function closeEditModal() {
    if (editModal) editModal.hidden = true;
    if (editModalBody) editModalBody.innerHTML = '';
  }

  // --- Upload modal ---
  // Local upload modal reuse (if local enabled)
  function openUploadModal(files, useLocal = false) {
    if (!uploadModal || !uploadModalBody) return;

    const fileList = Array.from(files);
    uploadModalBody.innerHTML =
      '<div class="upload-file-list">' +
        fileList.map(function (f, i) {
          return '<div class="upload-file-row">' +
            '<span class="upload-filename">' + esc(f.name) + '</span>' +
            '<span class="upload-filesize">(' + esc(formatBytes(f.size)) + ')</span>' +
            (useLocal ? '' : '<input class="text-input text-input-sm" placeholder="' + esc(labels.r2Path) + '" id="r2-path-' + i + '" />') +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="button" id="start-upload-btn">' + esc(labels.uploadBtn) + '</button>' +
        '<button type="button" class="button button-ghost" id="upload-cancel-btn">' + esc(labels.cancel) + '</button>' +
      '</div>' +
      '<p class="note" style="margin-top:8px;font-size:13px;color:var(--color-muted,#6b7280);">' + (useLocal
        ? (locale === 'vi'
          ? 'Upload nội bộ (bỏ qua CORS). Dùng cho server có ổ đĩa.'
          : 'Direct server upload (bypasses CORS). Use when local storage is available.')
        : (locale === 'vi'
          ? 'Ưu tiên proxy upload qua server để tránh lỗi CORS. Nếu vẫn fail sẽ thử presigned PUT như cũ. (Admin only)'
          : 'Uses server-proxied upload first to avoid CORS. Falls back to presigned PUT if needed. (Admin only)')) + '</p>' +
      '<div id="upload-results" class="upload-results"></div>';

    if (uploadModalTitle) {
      uploadModalTitle.textContent = useLocal ? (locale === 'vi' ? 'Upload lưu cục bộ' : 'Upload to local storage') : (locale === 'vi' ? 'Upload lên R2' : 'Upload to R2');
    }

    uploadModal.hidden = false;
    focusTrap(uploadModal);

    document.getElementById('upload-cancel-btn').addEventListener('click', closeUploadModal);

    const startUploadHandler = async function () {
      const startBtn = document.getElementById('start-upload-btn');
      const resultsEl = document.getElementById('upload-results');
      if (startBtn) startBtn.disabled = true;
      if (resultsEl) resultsEl.innerHTML = '';

      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const customPath = useLocal ? '' : (document.getElementById('r2-path-' + i) || {}).value || '';
        const row = document.createElement('div');
        row.className = 'upload-result-row result-pending';
        row.textContent = f.name + ' — ' + msgs.uploading;
        resultsEl.appendChild(row);

        try {
          if (useLocal) {
            // Direct POST to backend for local storage
            const relativePath = customPath || f.name;
            const uploadRes = await fetch('/api/admin/local/upload?relativePath=' + encodeURIComponent(relativePath), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/octet-stream',
                'X-CSRF-Token': csrf,
                'X-Filename': f.name
              },
              body: f
            });
            const uploadText = await uploadRes.text();
            let uploadData = {};
            try { uploadData = JSON.parse(uploadText); } catch (_) { /* noop */ }
            if (!uploadRes.ok || !uploadData.ok) {
              throw new Error(uploadData.error || ('local_upload_failed (' + (uploadRes.status || 'network') + ')'));
            }

            await apiFetch('/api/admin/local/confirm', {
              method: 'POST',
              body: JSON.stringify({
                relativePath: uploadData.relativePath,
                sizeBytes: uploadData.sizeBytes,
                checksumSha256: uploadData.checksumSha256,
                mimeType: uploadData.contentType,
                filename: f.name
              })
            });
          } else {
            // 1. Try direct server-proxied upload to bypass browser→R2 CORS
            let directUploadOk = false;
            try {
              const directResp = await fetch('/api/admin/r2/upload-direct?key=' + encodeURIComponent(customPath || f.name), {
                method: 'POST',
                headers: {
                  'Content-Type': f.type || 'application/octet-stream',
                  'Content-Length': String(f.size || 0),
                  'X-CSRF-Token': csrf,
                  'X-R2-Key': customPath || f.name,
                  'X-Filename': f.name
                },
                body: f
              });
              const directText = await directResp.text();
              let directData = {};
              try { directData = JSON.parse(directText); } catch (_) { /* noop */ }
              if (!directResp.ok || !directData.ok) {
                throw new Error(directData.error || ('r2_direct_failed (' + (directResp.status || 'network') + ')'));
              }
              // Confirm catalog
              await apiFetch('/api/admin/r2/upload-confirm', {
                method: 'POST',
                body: JSON.stringify({ r2Key: directData.r2Key, filename: f.name, sizeBytes: f.size, contentType: f.type || 'application/octet-stream' })
              });
              directUploadOk = true;
            } catch (directErr) {
              window.__r2Diag?.set?.(directErr, msgs.r2CORS);
            }

            if (!directUploadOk) {
              // 2. Fallback to presigned PUT
              let presignData;
              try {
                presignData = await apiFetch('/api/admin/r2/upload-url', {
                  method: 'POST',
                  body: JSON.stringify({ filename: customPath || f.name, contentType: f.type || 'application/octet-stream' })
                });
              } catch (presignErr) {
                throw new Error(msgs.uploadBlocked + ' [presign failed: ' + (presignErr?.message || 'unknown') + ']');
              }

              let putResp;
              try {
                putResp = await fetch(presignData.uploadUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': f.type || 'application/octet-stream' },
                  body: f
                });
              } catch (networkErr) {
                window.__r2Diag?.set?.(networkErr, msgs.r2CORS);
                throw new Error(msgs.r2PutFailed + ' [network/CORS error: ' + (networkErr?.message || 'failed to fetch') + ']');
              }

              if (!putResp.ok) {
                let statusHint = putResp.status ? 'status ' + putResp.status : 'network_error';
                let bodySnippet = '';
                try {
                  if (putResp.type !== 'opaque') {
                    const text = await putResp.text();
                    if (text) bodySnippet = ' body: ' + text.slice(0, 200);
                  } else {
                    statusHint += ' (opaque/CORS)';
                  }
                } catch (_) { /* ignore */ }
                const errorObj = new Error(msgs.r2PutFailed + ' [' + statusHint + ']' + (bodySnippet || ''));
                window.__r2Diag?.set?.(errorObj, msgs.r2CORS);
                throw errorObj;
              }

              await apiFetch('/api/admin/r2/upload-confirm', {
                method: 'POST',
                body: JSON.stringify({ r2Key: presignData.r2Key, filename: f.name, sizeBytes: f.size, contentType: f.type || 'application/octet-stream' })
              });
            }
          }

          row.className = 'upload-result-row result-success';
          row.textContent = f.name + ' — ' + msgs.uploadOk;
        } catch (err) {
          row.className = 'upload-result-row result-error';
          row.textContent = f.name + ' — ' + msgs.uploadErr + ' (' + err.message + ')';
          window.__r2Diag?.set?.(err, msgs.r2CORS);
        }
      }

      await loadInventory({ r2Configured: r2ConfiguredFlag, localAvailable: localAvailableFlag });
    };

    const startBtnEl = document.getElementById('start-upload-btn');
    if (startBtnEl) startBtnEl.addEventListener('click', startUploadHandler);

    // For local uploads, auto-start upload after file selection to avoid dead-click UX.
    if (useLocal && startBtnEl) {
      startUploadHandler();
    }
  }

  function closeUploadModal() {
    if (uploadModal) uploadModal.hidden = true;
    if (uploadModalBody) uploadModalBody.innerHTML = '';
  }

  function openDropboxUploadModal(files) {
    if (!uploadModal || !uploadModalBody) return;
    var titleEl = document.getElementById('upload-modal-title');
    if (titleEl) titleEl.textContent = locale === 'vi' ? 'Upload lên Dropbox' : 'Upload to Dropbox';

    var fileList = Array.from(files);
    uploadModalBody.innerHTML =
      '<div class="upload-file-list">' +
        fileList.map(function (f, i) {
          var defaultPath = '/dl888/' + f.name;
          return '<div class="upload-file-row">' +
            '<span class="upload-filename">' + esc(f.name) + '</span>' +
            '<span class="upload-filesize">(' + esc(formatBytes(f.size)) + ')</span>' +
            '<input class="text-input text-input-sm" placeholder="' + esc(locale === 'vi' ? 'Đường dẫn Dropbox' : 'Dropbox path') + '" id="dbx-path-' + i + '" value="' + esc(defaultPath) + '" />' +
          '</div>';
        }).join('') +
      '</div>' +
      '<p style="font-size:12px;color:var(--color-muted,#6b7280);margin:6px 0 10px;">' +
        (locale === 'vi' ? 'Đường dẫn đích trong Dropbox (bắt đầu bằng /). File sẽ được ghi đè nếu đã tồn tại.' : 'Destination path in Dropbox (starts with /). Existing files will be overwritten.') +
      '</p>' +
      '<div class="modal-actions">' +
        '<button type="button" class="button" id="start-dropbox-upload-btn">' + esc(labels.uploadBtn || (locale === 'vi' ? 'Bắt đầu Upload' : 'Start Upload')) + '</button>' +
        '<button type="button" class="button button-ghost" id="upload-cancel-btn">' + esc(labels.cancel) + '</button>' +
      '</div>' +
      '<div id="upload-results" class="upload-results"></div>';

    uploadModal.hidden = false;
    focusTrap(uploadModal);
    document.getElementById('upload-cancel-btn').addEventListener('click', closeUploadModal);

    document.getElementById('start-dropbox-upload-btn').addEventListener('click', async function () {
      var startBtn = document.getElementById('start-dropbox-upload-btn');
      var resultsEl = document.getElementById('upload-results');
      if (startBtn) startBtn.disabled = true;
      if (resultsEl) resultsEl.innerHTML = '';

      for (var i = 0; i < fileList.length; i++) {
        var f = fileList[i];
        var dropboxPath = (document.getElementById('dbx-path-' + i) || {}).value || ('/dl888/' + f.name);
        var row = document.createElement('div');
        row.className = 'upload-result-row result-pending';
        row.textContent = f.name + ' — ' + msgs.uploading;
        resultsEl.appendChild(row);

        try {
          var resp = await fetch('/api/admin/dropbox/upload', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-CSRF-Token': csrf,
              'X-Filename': encodeURIComponent(f.name),
              'X-Dropbox-Path': encodeURIComponent(dropboxPath),
              'X-Content-Type': f.type || 'application/octet-stream'
            },
            body: f
          });
          var text = await resp.text();
          var data = {};
          try { data = JSON.parse(text); } catch (_) { /* noop */ }
          if (!resp.ok || !data.ok) {
            throw new Error(data.error || ('dropbox_upload_failed (' + (resp.status || 'network') + ')'));
          }
          row.className = 'upload-result-row result-success';
          row.textContent = f.name + ' — ' + msgs.uploadOk + ' (' + esc(data.dropboxPath) + ')';
        } catch (err) {
          row.className = 'upload-result-row result-error';
          row.textContent = f.name + ' — ' + msgs.uploadErr + ' (' + esc(err.message) + ')';
        }
      }

      await loadInventory({ r2Configured: r2ConfiguredFlag, localAvailable: localAvailableFlag });
    });
  }

  // --- Modal close buttons ---
  if (uploadModalClose) uploadModalClose.addEventListener('click', closeUploadModal);
  if (editModalClose) editModalClose.addEventListener('click', closeEditModal);

  // Close on overlay click
  [uploadModal, editModal].forEach(function (modal) {
    if (!modal) return;
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        modal.hidden = true;
      }
    });
  });

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closeUploadModal();
    closeEditModal();
  });

  // --- Toolbar button bindings ---
  if (btnRefresh) btnRefresh.addEventListener('click', function () { loadInventory({ r2Configured: r2ConfiguredFlag, localAvailable: localAvailableFlag }); });
  if (btnSyncIndex) btnSyncIndex.addEventListener('click', syncIndex);
  var dropboxUploadInput = document.getElementById('dropbox-upload-input');
  if (dropboxUploadInput) {
    dropboxUploadInput.addEventListener('change', function () {
      if (dropboxUploadInput.files && dropboxUploadInput.files.length) {
        openDropboxUploadModal(dropboxUploadInput.files);
        dropboxUploadInput.value = '';
      }
    });
  }

  if (uploadInput) {
    uploadInput.addEventListener('change', function () {
      if (uploadInput.files && uploadInput.files.length) {
        openUploadModal(uploadInput.files, false);
        uploadInput.value = '';
      }
    });
  }

  if (localUploadInput) {
    localUploadInput.addEventListener('change', function () {
      if (localUploadInput.files && localUploadInput.files.length) {
        openUploadModal(localUploadInput.files, true);
        localUploadInput.value = '';
      }
    });
  }

  // Label text based on storage option
  if (uploadInput && uploadInput.labels && uploadInput.labels[0]) {
    uploadInput.labels[0].querySelector('.upload-label-text');
  }

  // Expose small diagnostics helper for operators to inspect last error
  window.__r2Diag = {
    lastError: null,
    lastHint: null,
    set(err, hint) {
      this.lastError = err;
      this.lastHint = hint || null;
      console.error('[R2]', err, hint || '');
      renderDiagPanel(err, hint);
    },
    get() { return this.lastError; },
    hint() { return this.lastHint; }
  };

  function renderDiagPanel(err, hint) {
    const panel = document.getElementById('r2-diag-panel');
    const body = document.getElementById('r2-diag-body');
    if (!panel || !body) return;
    if (!err) {
      panel.style.display = 'none';
      body.innerHTML = '';
      return;
    }
    const hintText = hint || msgs.r2CORS;
    panel.style.display = '';
    body.innerHTML = '<div>' + esc(err.message || String(err)) + '</div>' +
      '<div style="margin-top:4px;color:var(--color-muted,#6b7280);">' + esc(hintText) + '</div>' +
      '<div style="margin-top:6px;font-family:monospace;font-size:13px;word-break:break-all;">' + esc(String(err.stack || '')) + '</div>';
  }

  // --- Init ---
  checkR2Config();
})();
