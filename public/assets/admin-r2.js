/* admin-r2.js — Storage Management admin UI (new SIGNAL aesthetic) */
(function () {
  'use strict';

  const script = document.currentScript;
  if (!script) return;

  /* ── Config ───────────────────────────────────────────────────── */
  const locale = script.dataset.locale || 'en';
  const csrf = script.dataset.csrf || '';

  const msgs = {
    r2Ok: script.dataset.msgR2Ok || 'R2 connected.',
    r2Missing: script.dataset.msgR2Missing || 'R2 not configured.',
    r2LocalOnly: script.dataset.msgR2LocalOnly || 'Local storage only.',
    loading: script.dataset.msgLoading || 'Loading…',
    loaded: script.dataset.msgLoaded || 'Loaded.',
    syncing: script.dataset.msgSyncing || 'Syncing…',
    synced: script.dataset.msgSynced || 'Sync complete.',
    uploading: script.dataset.msgUploading || 'Uploading…',
    uploadOk: script.dataset.msgUploadOk || 'Upload successful.',
    uploadErr: script.dataset.msgUploadErr || 'Upload failed.',
    deleting: script.dataset.msgDeleting || 'Deleting…',
    deleted: script.dataset.msgDeleted || 'Deleted.',
    deleteConfirm: script.dataset.msgDeleteConfirm || 'Delete this file? This cannot be undone.',
    saved: script.dataset.msgSaved || 'Saved.',
    published: script.dataset.msgPublished || 'Published.',
    unpublished: script.dataset.msgUnpublished || 'Unpublished.',
    noFiles: script.dataset.msgNoFiles || 'No files yet.'
  };

  const L = {
    key: script.dataset.colKey || 'Path / Key',
    size: script.dataset.colSize || 'Size',
    modified: script.dataset.colModified || 'Modified',
    dl: script.dataset.colDl || 'DL',
    pub: script.dataset.colPublished || 'Pub',
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
    selected: script.dataset.labelSelected || 'selected',
    filtered: script.dataset.labelFiltered || 'shown',
    of: script.dataset.labelOf || 'of'
  };

  /* ── State ────────────────────────────────────────────────────── */
  let currentFiles = [];
  let filteredFiles = [];
  let selection = new Set(); // Set of slugs
  let r2ConfiguredFlag = false;
  let localAvailableFlag = false;
  let activeSource = 'all';
  let activeStatus = 'all';
  let searchQuery = '';
  let uploadDest = 'r2'; // 'r2' | 'local' | 'dropbox'
  let deleteTarget = null; // { slug, key, provider }

  /* ── DOM refs ─────────────────────────────────────────────────── */
  const inventoryWrap = document.getElementById('r2-inventory-wrap');
  const fileBadge = document.getElementById('file-count-badge');
  const toolbarStatus = document.getElementById('toolbar-status');
  const r2StatusChips = document.getElementById('r2-config-status');
  const tableFootEl = document.getElementById('table-foot');
  const footCountEl = document.getElementById('foot-count');
  const footSizeEl = document.getElementById('foot-size');

  // Stats strip
  const statTotalFiles = document.getElementById('stat-total-files');
  const statTotalSize = document.getElementById('stat-total-size');
  const statDownloads = document.getElementById('stat-downloads');
  const statPublished = document.getElementById('stat-published');
  const statSourceBar = document.getElementById('stat-source-bar');
  const statProgressBar = document.getElementById('stat-progress-bar');
  const statSparkline = document.getElementById('stat-sparkline');

  /* ── Utilities ────────────────────────────────────────────────── */
  function esc(v) {
    return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtBytes(n) {
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 3);
    return (i === 0 ? (n / Math.pow(1024, i)).toFixed(0) : (n / Math.pow(1024, i)).toFixed(1)) + ' ' + units[i];
  }

  function fmtCount(n) {
    if (!n) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
      return locale === 'vi' ? da + '/' + mo + '/' + y : y + '-' + mo + '-' + da;
    } catch (_) { return '—'; }
  }

  let _statusTimer = null;
  function setStatus(type, text) {
    if (!toolbarStatus) return;
    clearTimeout(_statusTimer);
    toolbarStatus.className = 'toolbar-status-inline';
    if (type === 'error') toolbarStatus.classList.add('status-error');
    else if (type === 'success') toolbarStatus.classList.add('status-success');
    else if (type === 'pending') toolbarStatus.classList.add('status-pending');
    toolbarStatus.textContent = text;
    if (type === 'success') {
      _statusTimer = setTimeout(() => { toolbarStatus.textContent = ''; }, 3000);
    }
  }

  /* ── API ──────────────────────────────────────────────────────── */
  async function apiFetch(url, opts = {}) {
    const merged = {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      ...opts
    };
    if (opts.headers) merged.headers = { ...merged.headers, ...opts.headers };
    const resp = await fetch(url, merged);
    let data;
    try { data = await resp.json(); } catch (_) { data = { ok: false, error: 'invalid_json' }; }
    if (!resp.ok || !data.ok) throw new Error(data.error || 'request_failed');
    return data;
  }

  /* ── Storage chips ────────────────────────────────────────────── */
  function renderStorageChips(r2ok, localOk, dropboxOk) {
    if (!r2StatusChips) return;
    const chip = (label, kind) => `<span class="storage-chip storage-chip--${kind}">${esc(label)}</span>`;
    let html = '';
    if (r2ok) html += chip('R2', 'ok');
    else html += chip('R2 off', 'off');
    if (dropboxOk) html += chip('Dropbox', 'ok');
    if (localOk) html += chip('Local', 'ok');
    r2StatusChips.innerHTML = html;
  }

  /* ── Stats strip ──────────────────────────────────────────────── */
  function updateStats() {
    const all = currentFiles;
    const totalSize = all.reduce((s, f) => s + (f.sizeBytes || 0), 0);
    const totalDl = all.reduce((s, f) => s + (f.downloads || 0), 0);
    const publishedCount = all.filter(f => f.published).length;
    const r2Count = all.filter(f => (f.storageProvider || f.storage?.provider) === 'r2').length;
    const dbxCount = all.filter(f => (f.storageProvider || f.storage?.provider) === 'dropbox').length;
    const localCount = all.length - r2Count - dbxCount;

    if (statTotalFiles) statTotalFiles.textContent = all.length;
    if (statTotalSize) statTotalSize.textContent = fmtBytes(totalSize);
    if (statDownloads) statDownloads.textContent = fmtCount(totalDl);
    if (statPublished) statPublished.textContent = publishedCount + ' / ' + all.length;

    if (statSourceBar && all.length > 0) {
      const r2Pct = ((r2Count / all.length) * 100).toFixed(1);
      const dbxPct = ((dbxCount / all.length) * 100).toFixed(1);
      const localPct = ((localCount / all.length) * 100).toFixed(1);
      statSourceBar.innerHTML =
        `<div class="src-bar-seg src-bar-r2" style="width:${r2Pct}%" title="R2: ${r2Count}"></div>` +
        `<div class="src-bar-seg src-bar-dropbox" style="width:${dbxPct}%" title="Dropbox: ${dbxCount}"></div>` +
        `<div class="src-bar-seg src-bar-local" style="width:${localPct}%" title="Local: ${localCount}"></div>`;
    }

    if (statProgressBar && all.length > 0) {
      statProgressBar.style.width = ((publishedCount / all.length) * 100).toFixed(1) + '%';
    }

    if (statSparkline) renderSparkline(statSparkline, totalDl);
  }

  function renderSparkline(svgEl, total) {
    // Generate a placeholder 30-day pseudo-sparkline from total
    const pts = Array.from({ length: 30 }, (_, i) => Math.max(0, Math.round((total / 30) * (0.5 + 0.5 * Math.sin(i / 3)))));
    const max = Math.max(...pts, 1);
    const W = 120, H = 28, pad = 2;
    const xs = pts.map((_, i) => pad + (i / (pts.length - 1)) * (W - 2 * pad));
    const ys = pts.map(v => H - pad - ((v / max) * (H - 2 * pad)));
    const line = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
    const area = line + ` L${xs[xs.length - 1].toFixed(1)},${H - pad} L${xs[0].toFixed(1)},${H - pad} Z`;
    svgEl.innerHTML =
      `<path d="${area}" fill="var(--accent-soft)" stroke="none"/>` +
      `<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  /* ── Filter/search ────────────────────────────────────────────── */
  function applyFilters() {
    filteredFiles = currentFiles.filter(f => {
      const provider = f.storageProvider || f.storage?.provider || 'r2';
      if (activeSource !== 'all' && provider !== activeSource) return false;
      if (activeStatus === 'published' && !f.published) return false;
      if (activeStatus === 'draft' && f.published) return false;
      if (searchQuery) {
        const slug = f.slug || f.r2Key || f.storage?.relativePath || f.storage?.dropboxPath || '';
        const titleVi = f.title?.vi || '';
        const titleEn = f.title?.en || '';
        const hay = (slug + ' ' + titleVi + ' ' + titleEn).toLowerCase();
        if (!hay.includes(searchQuery.toLowerCase())) return false;
      }
      return true;
    });
  }

  /* ── Table rendering ──────────────────────────────────────────── */
  function sourceBadge(provider) {
    if (provider === 'r2') return '<span class="source-badge badge-r2">R2</span>';
    if (provider === 'dropbox') return '<span class="source-badge badge-dropbox">Dropbox</span>';
    return '<span class="source-badge badge-local">Local</span>';
  }

  function renderTable() {
    if (!inventoryWrap) return;
    applyFilters();

    if (currentFiles.length === 0) {
      inventoryWrap.innerHTML = '<div class="empty-state"><p class="empty-state-msg">' + esc(msgs.noFiles) + '</p></div>';
      if (tableFootEl) tableFootEl.hidden = true;
      if (fileBadge) fileBadge.textContent = '';
      return;
    }

    if (filteredFiles.length === 0) {
      inventoryWrap.innerHTML = '<div class="empty-state"><p class="empty-state-msg">' + esc(locale === 'vi' ? 'Không tìm thấy file phù hợp.' : 'No files matched.') + '</p></div>';
      updateTableFoot(0);
      return;
    }

    const allChecked = filteredFiles.length > 0 && filteredFiles.every(f => selection.has(fileId(f)));

    const rows = filteredFiles.map(f => {
      const id = fileId(f);
      const provider = f.storageProvider || f.storage?.provider || 'r2';
      const key = provider === 'dropbox'
        ? (f.storage?.dropboxPath || f.slug || '—')
        : provider === 'local'
        ? (f.storage?.relativePath || f.slug || '—')
        : (f.r2Key || f.storage?.objectKey || f.slug || '—');
      const displayName = f.title?.[locale] || f.title?.en || key;
      const badge = sourceBadge(provider);
      const pubIcon = f.published
        ? '<span class="pub-check" aria-label="Published">✓</span>'
        : '<span class="pub-dash" aria-label="Draft">—</span>';
      const checked = selection.has(id) ? ' checked' : '';
      const rowSelected = selection.has(id) ? ' class="row-selected"' : '';
      const publishBtn = f.published
        ? `<button class="row-act-btn row-act-unpublish" data-id="${esc(id)}" data-provider="${esc(provider)}" title="${esc(L.unpublish)}" aria-label="${esc(L.unpublish)}">${esc(L.unpublish)}</button>`
        : `<button class="row-act-btn row-act-publish" data-id="${esc(id)}" data-provider="${esc(provider)}" title="${esc(L.publish)}" aria-label="${esc(L.publish)}">${esc(L.publish)}</button>`;

      return `<tr${rowSelected}>` +
        `<td class="col-check"><input type="checkbox" class="row-check" data-id="${esc(id)}" aria-label="Select ${esc(displayName)}"${checked}/></td>` +
        `<td class="col-path">${badge}<code class="path-key" title="${esc(key)}">${esc(key)}</code></td>` +
        `<td class="col-size num-cell">${esc(fmtBytes(f.sizeBytes))}</td>` +
        `<td class="col-modified date-cell">${esc(fmtDate(f.updatedAt || f.lastModified))}</td>` +
        `<td class="col-dl num-cell">${esc(fmtCount(f.downloads || 0))}</td>` +
        `<td class="col-pub center-cell">${pubIcon}</td>` +
        `<td class="col-actions"><div class="actions-cell">` +
          `<button class="row-act-btn row-act-edit" data-id="${esc(id)}" data-provider="${esc(provider)}" aria-label="${esc(L.edit)} ${esc(displayName)}">${esc(L.edit)}</button>` +
          publishBtn +
          `<button class="row-act-btn row-act-delete" data-id="${esc(id)}" data-key="${esc(key)}" data-provider="${esc(provider)}" aria-label="${esc(L.delete)} ${esc(displayName)}">` +
            `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>` +
          `</button>` +
        `</div></td>` +
      `</tr>`;
    }).join('');

    inventoryWrap.innerHTML =
      `<div class="table-scroll"><table class="storage-table" role="grid">` +
      `<thead><tr>` +
        `<th class="col-check"><input type="checkbox" id="check-all" aria-label="Select all"${allChecked ? ' checked' : ''}/></th>` +
        `<th class="col-path">${esc(L.key)}</th>` +
        `<th class="col-size num-cell">${esc(L.size)}</th>` +
        `<th class="col-modified date-cell">${esc(L.modified)}</th>` +
        `<th class="col-dl num-cell">${esc(L.dl)}</th>` +
        `<th class="col-pub center-cell">${esc(L.pub)}</th>` +
        `<th class="col-actions">${esc(L.actions)}</th>` +
      `</tr></thead>` +
      `<tbody>${rows}</tbody>` +
      `</table></div>`;

    // Select-all checkbox
    const checkAll = inventoryWrap.querySelector('#check-all');
    if (checkAll) {
      checkAll.addEventListener('change', () => {
        if (checkAll.checked) filteredFiles.forEach(f => selection.add(fileId(f)));
        else filteredFiles.forEach(f => selection.delete(fileId(f)));
        renderTable();
        updateBulkBar();
      });
    }

    // Row checkboxes (with shift-click range)
    let lastCheckedIdx = -1;
    inventoryWrap.querySelectorAll('.row-check').forEach((chk, idx) => {
      chk.addEventListener('click', e => {
        const id = chk.dataset.id;
        if (e.shiftKey && lastCheckedIdx >= 0) {
          const lo = Math.min(idx, lastCheckedIdx), hi = Math.max(idx, lastCheckedIdx);
          for (let i = lo; i <= hi; i++) {
            const fId = fileId(filteredFiles[i]);
            chk.checked ? selection.add(fId) : selection.delete(fId);
          }
        } else {
          chk.checked ? selection.add(id) : selection.delete(id);
        }
        lastCheckedIdx = idx;
        renderTable();
        updateBulkBar();
      });
    });

    // Row action buttons
    inventoryWrap.querySelectorAll('.row-act-edit').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(btn.dataset.id, btn.dataset.provider));
    });
    inventoryWrap.querySelectorAll('.row-act-publish').forEach(btn => {
      btn.addEventListener('click', () => togglePublish(btn.dataset.id, true, btn.dataset.provider));
    });
    inventoryWrap.querySelectorAll('.row-act-unpublish').forEach(btn => {
      btn.addEventListener('click', () => togglePublish(btn.dataset.id, false, btn.dataset.provider));
    });
    inventoryWrap.querySelectorAll('.row-act-delete').forEach(btn => {
      btn.addEventListener('click', () => openDeleteModal(btn.dataset.id, btn.dataset.key, btn.dataset.provider));
    });

    updateTableFoot(filteredFiles.length);
    if (fileBadge) fileBadge.textContent = currentFiles.length + ' ' + L.files;
  }

  function fileId(f) {
    return f.slug || f.r2Key || f.storage?.relativePath || f.storage?.dropboxPath || '';
  }

  function fileById(id) {
    return currentFiles.find(f => fileId(f) === id);
  }

  function updateTableFoot(count) {
    if (!tableFootEl) return;
    tableFootEl.hidden = false;
    const filteredSize = filteredFiles.reduce((s, f) => s + (f.sizeBytes || 0), 0);
    if (footCountEl) footCountEl.textContent = count + ' ' + L.filtered + ' ' + L.of + ' ' + currentFiles.length + ' ' + L.files;
    if (footSizeEl) footSizeEl.textContent = fmtBytes(filteredSize);
  }

  /* ── Bulk bar ─────────────────────────────────────────────────── */
  function updateBulkBar() {
    const bulkBar = document.getElementById('bulk-bar');
    const bulkCount = document.getElementById('bulk-count');
    if (!bulkBar) return;
    bulkBar.hidden = selection.size === 0;
    if (bulkCount) bulkCount.textContent = selection.size + ' ' + L.selected;
  }

  async function bulkAction(action) {
    const ids = Array.from(selection);
    if (!ids.length) return;
    setStatus('pending', msgs.loading);

    // Optimistic: update local state immediately
    const prev = currentFiles.map(f => ({ ...f }));
    if (action === 'publish') currentFiles.forEach(f => { if (selection.has(fileId(f))) f.published = true; });
    if (action === 'unpublish') currentFiles.forEach(f => { if (selection.has(fileId(f))) f.published = false; });
    if (action === 'delete') currentFiles = currentFiles.filter(f => !selection.has(fileId(f)));
    renderTable();
    updateStats();

    try {
      await apiFetch('/api/admin/bulk', { method: 'POST', body: JSON.stringify({ ids, action }) });
      selection.clear();
      updateBulkBar();
      // Reload to reconcile
      await loadInventory();
      setStatus('success', action === 'delete' ? msgs.deleted : action === 'publish' ? msgs.published : msgs.unpublished);
    } catch (err) {
      // Roll back
      currentFiles = prev;
      renderTable();
      updateStats();
      setStatus('error', err.message);
    }
  }

  /* ── Inventory loading ────────────────────────────────────────── */
  async function loadInventory() {
    setStatus('pending', msgs.loading);
    try {
      const [r2Data, localData, dropboxData] = await Promise.all([
        r2ConfiguredFlag ? apiFetch('/api/admin/r2/files') : Promise.resolve(null),
        localAvailableFlag ? apiFetch('/api/admin/local/files') : Promise.resolve(null),
        apiFetch('/api/admin/dropbox/files').catch(() => null)
      ]);

      const merged = [];
      const seen = new Set();

      (r2Data?.files || []).forEach(f => {
        const k = 'r2:' + (f.slug || f.r2Key || '');
        if (seen.has(k)) return;
        seen.add(k);
        merged.push({ ...f, storageProvider: 'r2' });
      });
      (localData?.files || []).forEach(f => {
        const k = 'local:' + (f.slug || f.storage?.relativePath || '');
        if (seen.has(k)) return;
        seen.add(k);
        merged.push({ ...f, storageProvider: 'local' });
      });
      (dropboxData?.files || []).forEach(f => {
        const k = 'dropbox:' + (f.slug || f.storage?.dropboxPath || '');
        if (seen.has(k)) return;
        seen.add(k);
        merged.push({ ...f, storageProvider: 'dropbox' });
      });

      currentFiles = merged;
      renderTable();
      updateStats();
      setStatus('success', msgs.loaded);
    } catch (err) {
      setStatus('error', err.message);
    }
  }

  async function checkR2Config() {
    try {
      const data = await apiFetch('/api/admin/r2/status');
      r2ConfiguredFlag = Boolean(data.r2Configured);
      localAvailableFlag = Boolean(data.localAvailable);
      renderStorageChips(data.r2Configured, data.localAvailable, data.dropboxConfigured);
      await loadInventory();
    } catch (err) {
      renderStorageChips(false, false, false);
      setStatus('error', err.message);
    }
  }

  /* ── Sync index ───────────────────────────────────────────────── */
  async function syncIndex() {
    setStatus('pending', msgs.syncing);
    try {
      await apiFetch('/api/admin/r2/sync', { method: 'POST' });
      await loadInventory();
      setStatus('success', msgs.synced);
    } catch (err) { setStatus('error', err.message); }
  }

  /* ── Toggle publish ───────────────────────────────────────────── */
  async function togglePublish(id, publish, provider = 'r2') {
    setStatus('pending', msgs.loading);
    // Optimistic
    const f = fileById(id);
    if (f) f.published = publish;
    renderTable();
    updateStats();
    try {
      const endpoint = provider === 'local' ? '/api/admin/local/files/' : '/api/admin/r2/files/';
      await apiFetch(endpoint + encodeURIComponent(id) + '/publish', {
        method: 'PATCH',
        body: JSON.stringify({ published: publish })
      });
      setStatus('success', publish ? msgs.published : msgs.unpublished);
    } catch (err) {
      if (f) f.published = !publish; // roll back
      renderTable();
      updateStats();
      setStatus('error', err.message);
    }
  }

  /* ── Delete modal ─────────────────────────────────────────────── */
  function openDeleteModal(id, key, provider) {
    deleteTarget = { id, key, provider };
    const modal = document.getElementById('delete-modal');
    const msg = document.getElementById('delete-modal-msg');
    if (msg) msg.textContent = msgs.deleteConfirm + '\n' + (key || id);
    if (modal) modal.hidden = false;
  }

  function closeDeleteModal() {
    const modal = document.getElementById('delete-modal');
    if (modal) modal.hidden = true;
    deleteTarget = null;
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { id, key, provider } = deleteTarget;
    closeDeleteModal();
    setStatus('pending', msgs.deleting);
    // Optimistic
    const prev = currentFiles.slice();
    currentFiles = currentFiles.filter(f => fileId(f) !== id);
    renderTable();
    updateStats();
    try {
      const endpoint = provider === 'local' ? '/api/admin/local/files/' : '/api/admin/r2/files/';
      await apiFetch(endpoint + encodeURIComponent(id || key), { method: 'DELETE' });
      setStatus('success', msgs.deleted);
    } catch (err) {
      currentFiles = prev;
      renderTable();
      updateStats();
      setStatus('error', err.message);
    }
  }

  /* ── Edit modal ───────────────────────────────────────────────── */
  function openEditModal(id, provider = 'r2') {
    const f = fileById(id);
    const modal = document.getElementById('edit-modal');
    const body = document.getElementById('edit-modal-body');
    if (!f || !modal || !body) return;

    const titleVi = f.title?.vi || '';
    const titleEn = f.title?.en || '';
    const summaryVi = f.summary?.vi || '';
    const summaryEn = f.summary?.en || '';
    const version = f.version || '';
    const platform = f.platform || 'Generic';

    body.innerHTML =
      `<form id="edit-file-form" class="edit-form">` +
      `<input type="hidden" name="id" value="${esc(id)}" />` +
      `<div class="field-group"><label class="field-label">${esc(L.titleVi)}</label><input class="text-input" name="titleVi" value="${esc(titleVi)}" required /></div>` +
      `<div class="field-group"><label class="field-label">${esc(L.titleEn)}</label><input class="text-input" name="titleEn" value="${esc(titleEn)}" required /></div>` +
      `<div class="field-group"><label class="field-label">${esc(L.summaryVi)}</label><textarea class="text-input text-area" name="summaryVi" rows="2">${esc(summaryVi)}</textarea></div>` +
      `<div class="field-group"><label class="field-label">${esc(L.summaryEn)}</label><textarea class="text-input text-area" name="summaryEn" rows="2">${esc(summaryEn)}</textarea></div>` +
      `<div class="form-row">` +
        `<div class="field-group"><label class="field-label">${esc(L.version)}</label><input class="text-input" name="version" value="${esc(version)}" /></div>` +
        `<div class="field-group"><label class="field-label">${esc(L.platform)}</label><select class="text-input" name="platform">${
          ['Generic','Windows','macOS','Linux','Android','iOS'].map(p =>
            `<option value="${esc(p)}"${platform === p ? ' selected' : ''}>${esc(p)}</option>`
          ).join('')
        }</select></div>` +
      `</div>` +
      `<div class="modal-actions">` +
        `<button type="button" class="btn-ghost" id="edit-cancel-btn">${esc(L.cancel)}</button>` +
        `<button type="submit" class="btn-primary">${esc(L.save)}</button>` +
      `</div>` +
      `<p id="edit-form-status" class="toolbar-status-inline" role="status" aria-live="polite"></p>` +
      `</form>`;

    modal.hidden = false;
    body.querySelector('#edit-cancel-btn').addEventListener('click', closeEditModal);

    body.querySelector('#edit-file-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const statusEl = body.querySelector('#edit-form-status');
      if (statusEl) { statusEl.className = 'toolbar-status-inline status-pending'; statusEl.textContent = msgs.loading; }
      try {
        const endpoint = provider === 'local' ? '/api/admin/local/files/' : '/api/admin/r2/files/';
        await apiFetch(endpoint + encodeURIComponent(id) + '/metadata', {
          method: 'PATCH',
          body: JSON.stringify({
            title: { vi: fd.get('titleVi'), en: fd.get('titleEn') },
            summary: { vi: fd.get('summaryVi'), en: fd.get('summaryEn') },
            version: fd.get('version'),
            platform: fd.get('platform')
          })
        });
        closeEditModal();
        await loadInventory();
        setStatus('success', msgs.saved);
      } catch (err) {
        if (statusEl) { statusEl.className = 'toolbar-status-inline status-error'; statusEl.textContent = err.message; }
      }
    });
  }

  function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    const body = document.getElementById('edit-modal-body');
    if (modal) modal.hidden = true;
    if (body) body.innerHTML = '';
  }

  /* ── Upload zone ──────────────────────────────────────────────── */
  function initUploadZone() {
    const zone = document.getElementById('upload-zone-wrap');
    const btn = document.getElementById('btn-upload-toggle');
    const dropArea = document.getElementById('upload-drop-area');
    const fileInput = document.getElementById('upload-file-input');
    const browse = document.getElementById('drop-browse');
    const tabs = document.querySelectorAll('.zone-tab');

    if (!zone || !btn) return;

    btn.addEventListener('click', () => {
      zone.hidden = !zone.hidden;
    });

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        uploadDest = tab.dataset.dest;
      });
    });

    if (browse && fileInput) browse.addEventListener('click', () => fileInput.click());

    if (fileInput) {
      fileInput.addEventListener('change', () => {
        if (fileInput.files?.length) {
          uploadFiles(Array.from(fileInput.files));
          fileInput.value = '';
        }
      });
    }

    if (dropArea) {
      dropArea.addEventListener('dragover', e => {
        e.preventDefault();
        dropArea.classList.add('drag-over');
      });
      ['dragleave', 'dragend'].forEach(evt =>
        dropArea.addEventListener(evt, () => dropArea.classList.remove('drag-over'))
      );
      dropArea.addEventListener('drop', e => {
        e.preventDefault();
        dropArea.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer?.files || []);
        if (files.length) uploadFiles(files);
      });
    }
  }

  async function uploadFiles(fileList) {
    const activeListEl = document.getElementById('upload-active-list');
    if (!activeListEl) return;
    activeListEl.hidden = false;
    activeListEl.innerHTML = '';

    for (const f of fileList) {
      const rowEl = document.createElement('div');
      rowEl.className = 'upload-item';
      rowEl.innerHTML =
        `<div class="upload-item-head">` +
          `<span class="upload-item-name">${esc(f.name)}</span>` +
          `<span class="upload-item-size">${esc(fmtBytes(f.size))}</span>` +
        `</div>` +
        `<div class="upload-item-bar"><div class="upload-item-fill" style="width:0%"></div></div>` +
        `<span class="upload-item-status status-pending">${esc(msgs.uploading)}</span>`;
      activeListEl.appendChild(rowEl);

      const fill = rowEl.querySelector('.upload-item-fill');
      const statusEl = rowEl.querySelector('.upload-item-status');

      try {
        if (uploadDest === 'local') {
          await doLocalUpload(f, fill);
        } else if (uploadDest === 'dropbox') {
          await doDropboxUpload(f, fill);
        } else {
          await doR2Upload(f, fill);
        }
        if (fill) fill.style.width = '100%';
        if (statusEl) { statusEl.className = 'upload-item-status status-success'; statusEl.textContent = msgs.uploadOk; }
      } catch (err) {
        if (statusEl) { statusEl.className = 'upload-item-status status-error'; statusEl.textContent = msgs.uploadErr + ' — ' + err.message; }
      }
    }

    await loadInventory();
  }

  async function doR2Upload(f, fillEl) {
    // Try server-proxied direct upload first
    try {
      const resp = await fetch('/api/admin/r2/upload-direct?key=' + encodeURIComponent(f.name), {
        method: 'POST',
        headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-CSRF-Token': csrf },
        body: f
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) throw new Error(data.error || 'r2_direct_failed');
      await apiFetch('/api/admin/r2/upload-confirm', {
        method: 'POST',
        body: JSON.stringify({ r2Key: data.r2Key, filename: f.name, sizeBytes: f.size, contentType: f.type || 'application/octet-stream' })
      });
      if (fillEl) fillEl.style.width = '100%';
      return;
    } catch (_) { /* fall through to presigned */ }

    // Fallback: presigned PUT
    const presign = await apiFetch('/api/admin/r2/upload-url', {
      method: 'POST',
      body: JSON.stringify({ filename: f.name, contentType: f.type || 'application/octet-stream' })
    });
    const putResp = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': f.type || 'application/octet-stream' },
      body: f
    });
    if (!putResp.ok) throw new Error('R2 PUT failed (' + putResp.status + ')');
    if (fillEl) fillEl.style.width = '80%';
    await apiFetch('/api/admin/r2/upload-confirm', {
      method: 'POST',
      body: JSON.stringify({ r2Key: presign.r2Key, filename: f.name, sizeBytes: f.size, contentType: f.type || 'application/octet-stream' })
    });
  }

  async function doLocalUpload(f, fillEl) {
    const resp = await fetch('/api/admin/local/upload?relativePath=' + encodeURIComponent(f.name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrf },
      body: f
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) throw new Error(data.error || 'local_upload_failed');
    if (fillEl) fillEl.style.width = '70%';
    await apiFetch('/api/admin/local/confirm', {
      method: 'POST',
      body: JSON.stringify({
        relativePath: data.relativePath,
        sizeBytes: data.sizeBytes,
        checksumSha256: data.checksumSha256,
        mimeType: data.contentType,
        filename: f.name
      })
    });
  }

  async function doDropboxUpload(f, fillEl) {
    const path = '/dl888/' + f.name;
    const resp = await fetch('/api/admin/dropbox/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-CSRF-Token': csrf,
        'X-Filename': encodeURIComponent(f.name),
        'X-Dropbox-Path': encodeURIComponent(path),
        'X-Content-Type': f.type || 'application/octet-stream'
      },
      body: f
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) throw new Error(data.error || 'dropbox_upload_failed');
    if (fillEl) fillEl.style.width = '100%';
  }

  /* ── Search + filter toolbar ──────────────────────────────────── */
  function initToolbar() {
    const searchEl = document.getElementById('admin-search');
    if (searchEl) {
      let debounce;
      searchEl.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { searchQuery = searchEl.value.trim(); renderTable(); }, 150);
      });
    }

    document.querySelectorAll('.seg-btn[data-source]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.seg-btn[data-source]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeSource = btn.dataset.source;
        renderTable();
      });
    });

    document.querySelectorAll('.seg-btn[data-status]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.seg-btn[data-status]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeStatus = btn.dataset.status;
        renderTable();
      });
    });
  }

  /* ── Bulk bar bindings ────────────────────────────────────────── */
  function initBulkBar() {
    const publishBtn = document.getElementById('bulk-publish');
    const unpublishBtn = document.getElementById('bulk-unpublish');
    const deleteBtn = document.getElementById('bulk-delete');
    const clearBtn = document.getElementById('bulk-clear');

    if (publishBtn) publishBtn.addEventListener('click', () => bulkAction('publish'));
    if (unpublishBtn) unpublishBtn.addEventListener('click', () => bulkAction('unpublish'));
    if (deleteBtn) deleteBtn.addEventListener('click', () => bulkAction('delete'));
    if (clearBtn) clearBtn.addEventListener('click', () => { selection.clear(); updateBulkBar(); renderTable(); });
  }

  /* ── Modal global listeners ───────────────────────────────────── */
  function initModals() {
    const editModal = document.getElementById('edit-modal');
    const editClose = document.getElementById('edit-modal-close');
    const deleteModal = document.getElementById('delete-modal');
    const deleteClose = document.getElementById('delete-modal-close');
    const deleteCancel = document.getElementById('delete-modal-cancel');
    const deleteConfirmBtn = document.getElementById('delete-modal-confirm');

    if (editClose) editClose.addEventListener('click', closeEditModal);
    if (editModal) editModal.addEventListener('click', e => { if (e.target === editModal) closeEditModal(); });

    if (deleteClose) deleteClose.addEventListener('click', closeDeleteModal);
    if (deleteCancel) deleteCancel.addEventListener('click', closeDeleteModal);
    if (deleteConfirmBtn) deleteConfirmBtn.addEventListener('click', confirmDelete);
    if (deleteModal) deleteModal.addEventListener('click', e => { if (e.target === deleteModal) closeDeleteModal(); });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      closeEditModal();
      closeDeleteModal();
    });
  }

  /* ── Main buttons ─────────────────────────────────────────────── */
  function initButtons() {
    const btnRefresh = document.getElementById('btn-refresh');
    const btnSync = document.getElementById('btn-sync-index');
    if (btnRefresh) btnRefresh.addEventListener('click', loadInventory);
    if (btnSync) btnSync.addEventListener('click', syncIndex);
  }

  /* ── Boot ─────────────────────────────────────────────────────── */
  function init() {
    initButtons();
    initToolbar();
    initBulkBar();
    initUploadZone();
    initModals();
    checkR2Config();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
