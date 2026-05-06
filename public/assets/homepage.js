/* homepage.js — client-side rendering for DOWNLOAD HUB homepage */
(function () {
  'use strict';

  /* ── Config from data attributes ─────────────────────────────── */
  const script = document.currentScript;
  const LOCALE = script.dataset.locale || 'en';
  const TURNSTILE_KEY = script.dataset.turnstileKey || '';
  const VERIFY_PATH = script.dataset.verifyPath || '/api/verify/';

  const L = {
    files: script.dataset.labelFiles || 'files',
    total: script.dataset.labelTotal || 'total',
    downloads: script.dataset.labelDownloads || 'downloads',
    searchEmpty: script.dataset.labelSearchEmpty || 'No files matched.',
    noFiles: script.dataset.labelNoFiles || 'No published files yet.',
    name: script.dataset.labelName || 'Name',
    type: script.dataset.labelType || 'Type',
    size: script.dataset.labelSize || 'Size',
    modified: script.dataset.labelModified || 'Modified',
    dl: script.dataset.labelDl || 'DL',
    action: script.dataset.labelAction || 'Download',
    all: script.dataset.labelAll || 'all',
    documents: script.dataset.labelDocuments || 'documents',
    archives: script.dataset.labelArchives || 'archives',
    media: script.dataset.labelMedia || 'media',
    code: script.dataset.labelCode || 'code',
    other: script.dataset.labelOther || 'other',
    verifying: script.dataset.labelVerifying || 'Verifying…',
    verifyError: script.dataset.labelVerifyError || 'Verification failed. Please try again.',
    networkError: script.dataset.labelNetworkError || 'Network error. Please try again.',
  };

  /* ── Parse file data ──────────────────────────────────────────── */
  let ALL_FILES = [];
  try {
    const raw = document.getElementById('files-data');
    ALL_FILES = raw ? JSON.parse(raw.textContent) : [];
  } catch (e) {
    ALL_FILES = [];
  }

  /* ── State ────────────────────────────────────────────────────── */
  let activeFilter = 'all';
  let activeSort = 'recent';
  let searchQuery = '';

  /* ── Helpers ──────────────────────────────────────────────────── */
  function fmtBytes(n) {
    if (!n || n === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    const val = n / Math.pow(1024, i);
    return (i === 0 ? val.toFixed(0) : val.toFixed(1)) + ' ' + units[i];
  }

  function fmtCount(n) {
    if (!n || n === 0) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      const now = Date.now();
      const diff = now - d.getTime();
      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      if (LOCALE === 'vi') {
        if (mins < 2) return 'Vừa xong';
        if (mins < 60) return mins + ' phút trước';
        if (hours < 24) return hours + ' giờ trước';
        if (days < 30) return days + ' ngày trước';
        return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
      } else {
        if (mins < 2) return 'just now';
        if (mins < 60) return mins + 'm ago';
        if (hours < 24) return hours + 'h ago';
        if (days < 30) return days + 'd ago';
        const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
        return y + '-' + mo + '-' + da;
      }
    } catch (_) { return '—'; }
  }

  function categoryFor(ext) {
    const e = (ext || '').toLowerCase();
    if (['pdf', 'md', 'docx', 'doc', 'txt', 'rtf', 'odt', 'pages'].includes(e)) return 'documents';
    if (['zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'xz', 'tgz'].includes(e)) return 'archives';
    if (['mp4', 'mp3', 'mov', 'avi', 'mkv', 'wav', 'flac', 'ogg', 'webm', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(e)) return 'media';
    if (['json', 'js', 'ts', 'jsx', 'tsx', 'csv', 'yaml', 'yml', 'toml', 'sh', 'bash', 'py', 'rb', 'go', 'rs', 'c', 'cpp', 'h', 'java', 'xml', 'html', 'css', 'sql'].includes(e)) return 'code';
    return 'other';
  }

  function fileIcon(ext) {
    const cat = categoryFor(ext);
    if (cat === 'documents') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
    if (cat === 'archives') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';
    if (cat === 'media') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    if (cat === 'code') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  }

  function sourceBadge(src) {
    const cls = src === 'r2' ? 'badge-r2' : src === 'dropbox' ? 'badge-dropbox' : 'badge-local';
    const label = src === 'r2' ? 'R2' : src === 'dropbox' ? 'Dropbox' : 'Local';
    return '<span class="source-badge ' + cls + '" aria-label="Storage: ' + label + '">' + label + '</span>';
  }

  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── Fuzzy search ─────────────────────────────────────────────── */
  function matches(f, q) {
    if (!q) return true;
    const haystack = ((f.name || '') + ' ' + (f.desc || '') + ' ' + (f.ext || '')).toLowerCase();
    const needle = q.toLowerCase();
    // simple substring match; good enough without a dep
    return haystack.includes(needle);
  }

  /* ── Computed list ────────────────────────────────────────────── */
  function getFiltered() {
    let list = ALL_FILES.slice();
    if (activeFilter !== 'all') {
      list = list.filter(f => categoryFor(f.ext) === activeFilter);
    }
    if (searchQuery) {
      list = list.filter(f => matches(f, searchQuery));
    }
    switch (activeSort) {
      case 'popular': list.sort((a, b) => (b.downloads || 0) - (a.downloads || 0)); break;
      case 'size': list.sort((a, b) => (b.size || 0) - (a.size || 0)); break;
      case 'name': list.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
      default: // recent
        list.sort((a, b) => {
          const ta = a.modified ? new Date(a.modified).getTime() : 0;
          const tb = b.modified ? new Date(b.modified).getTime() : 0;
          return tb - ta;
        });
    }
    return list;
  }

  /* ── Hero stats ───────────────────────────────────────────────── */
  function updateStats() {
    const totalSize = ALL_FILES.reduce((acc, f) => acc + (f.size || 0), 0);
    const totalDl = ALL_FILES.reduce((acc, f) => acc + (f.downloads || 0), 0);
    const countEl = document.getElementById('stat-count');
    const sizeEl = document.getElementById('stat-size');
    const dlEl = document.getElementById('stat-dl');
    if (countEl) countEl.textContent = ALL_FILES.length + ' ' + L.files;
    if (sizeEl) sizeEl.textContent = fmtBytes(totalSize) + ' ' + L.total;
    if (dlEl) dlEl.textContent = fmtCount(totalDl) + ' ' + L.downloads;
  }

  /* ── Filter chips ─────────────────────────────────────────────── */
  function renderFilterChips() {
    const wrap = document.getElementById('filter-chips');
    if (!wrap) return;
    const cats = ['all', 'documents', 'archives', 'media', 'code', 'other'];
    const counts = { all: ALL_FILES.length };
    cats.slice(1).forEach(c => {
      counts[c] = ALL_FILES.filter(f => categoryFor(f.ext) === c).length;
    });
    wrap.innerHTML = cats
      .filter(c => c === 'all' || counts[c] > 0)
      .map(c => {
        const label = L[c] || c;
        const active = activeFilter === c ? ' active' : '';
        return '<button class="filter-chip' + active + '" data-cat="' + c + '" aria-pressed="' + (activeFilter === c) + '">'
          + esc(label) + '<span class="chip-count">' + counts[c] + '</span></button>';
      })
      .join('');

    wrap.querySelectorAll('.filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.cat;
        renderFilterChips();
        renderTable();
      });
    });
  }

  /* ── File table ───────────────────────────────────────────────── */
  function renderTable() {
    const wrap = document.getElementById('file-table-wrap');
    if (!wrap) return;
    const list = getFiltered();

    if (ALL_FILES.length === 0) {
      wrap.innerHTML = '<p class="empty-state">' + esc(L.noFiles) + '</p>';
      return;
    }
    if (list.length === 0) {
      wrap.innerHTML = '<p class="empty-state">' + esc(L.searchEmpty) + '</p>';
      return;
    }

    const rows = list.map(f => {
      const icon = fileIcon(f.ext);
      const badge = sourceBadge(f.source);
      const descHtml = f.desc
        ? '<span class="file-desc">' + esc(f.desc) + '</span>'
        : '';
      const extLabel = f.ext ? f.ext.toUpperCase() : '—';
      return '<tr>'
        + '<td class="col-name">'
        +   '<div class="file-name-cell">'
        +     '<span class="file-icon" aria-hidden="true">' + icon + '</span>'
        +     '<div class="file-name-info">'
        +       '<span class="file-name">' + esc(f.name) + '</span>'
        +       descHtml
        +       '<div class="file-badges">' + badge + '</div>'
        +     '</div>'
        +   '</div>'
        + '</td>'
        + '<td class="col-type"><span class="ext-label">' + esc(extLabel) + '</span></td>'
        + '<td class="col-size">' + esc(fmtBytes(f.size)) + '</td>'
        + '<td class="col-modified">' + esc(fmtDate(f.modified)) + '</td>'
        + '<td class="col-dl">' + esc(fmtCount(f.downloads)) + '</td>'
        + '<td class="col-action">'
        +   '<button class="btn-dl" data-slug="' + esc(f.slug) + '" data-name="' + esc(f.name) + '" data-size="' + esc(fmtBytes(f.size)) + '" data-ext="' + esc(f.ext) + '" data-source="' + esc(f.source) + '" aria-label="' + esc(L.action) + ': ' + esc(f.name) + '">'
        +     '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
        +     ' ' + esc(L.action)
        +   '</button>'
        + '</td>'
        + '</tr>';
    }).join('');

    wrap.innerHTML = '<div class="table-scroll"><table class="file-table" role="grid">'
      + '<thead><tr>'
      + '<th class="col-name" scope="col">' + esc(L.name) + '</th>'
      + '<th class="col-type" scope="col">' + esc(L.type) + '</th>'
      + '<th class="col-size" scope="col">' + esc(L.size) + '</th>'
      + '<th class="col-modified" scope="col">' + esc(L.modified) + '</th>'
      + '<th class="col-dl" scope="col">' + esc(L.dl) + '</th>'
      + '<th class="col-action" scope="col"><span class="sr-only">' + esc(L.action) + '</span></th>'
      + '</tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table></div>';

    // Attach download button listeners
    wrap.querySelectorAll('.btn-dl').forEach(btn => {
      btn.addEventListener('click', () => openModal(btn.dataset));
    });
  }

  /* ── Download modal ───────────────────────────────────────────── */
  let tsWidgetId = null;
  let currentSlug = null;
  let currentToken = null;
  let pendingDownloadName = null;

  function openModal(data) {
    currentSlug = data.slug;
    currentToken = null;
    pendingDownloadName = data.name;

    const modal = document.getElementById('dl-modal');
    const filenameEl = document.getElementById('dl-modal-filename');
    const metaEl = document.getElementById('dl-modal-meta');
    const errorEl = document.getElementById('dl-modal-error');
    const proceedBtn = document.getElementById('dl-modal-proceed');

    if (filenameEl) filenameEl.textContent = data.name || '—';
    if (metaEl) metaEl.textContent = [data.size, data.ext ? data.ext.toUpperCase() : '', data.source].filter(Boolean).join(' · ');
    if (errorEl) { errorEl.textContent = ''; errorEl.hidden = true; }

    // Reset Turnstile widget
    const tsWrap = document.getElementById('dl-turnstile-wrap');
    if (tsWrap) {
      tsWrap.innerHTML = '';
      tsWidgetId = null;
    }

    if (proceedBtn) {
      proceedBtn.disabled = true;
      proceedBtn.textContent = proceedBtn.getAttribute('data-label-proceed') ||
        (LOCALE === 'vi' ? 'Tải xuống' : 'Proceed');
    }

    modal.hidden = false;
    document.body.style.overflow = 'hidden';

    // Inject Turnstile widget after modal is visible
    if (TURNSTILE_KEY && tsWrap && window.turnstile) {
      tsWidgetId = window.turnstile.render(tsWrap, {
        sitekey: TURNSTILE_KEY,
        theme: document.documentElement.getAttribute('data-theme') || 'dark',
        callback: function (token) {
          currentToken = token;
          if (proceedBtn) proceedBtn.disabled = false;
        },
        'expired-callback': function () {
          currentToken = null;
          if (proceedBtn) proceedBtn.disabled = true;
        },
        'error-callback': function () {
          currentToken = null;
          if (proceedBtn) proceedBtn.disabled = true;
        }
      });
    } else if (!TURNSTILE_KEY && proceedBtn) {
      // No Turnstile configured — allow direct proceed
      proceedBtn.disabled = false;
      currentToken = 'no-captcha';
    }
  }

  function closeModal() {
    const modal = document.getElementById('dl-modal');
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    if (tsWidgetId !== null && window.turnstile) {
      try { window.turnstile.remove(tsWidgetId); } catch (_) {}
      tsWidgetId = null;
    }
    currentSlug = null;
    currentToken = null;
    pendingDownloadName = null;
  }

  async function proceedDownload() {
    const proceedBtn = document.getElementById('dl-modal-proceed');
    const errorEl = document.getElementById('dl-modal-error');

    if (!currentSlug) return;
    if (!currentToken && TURNSTILE_KEY) return;

    if (proceedBtn) {
      proceedBtn.disabled = true;
      proceedBtn.textContent = L.verifying;
    }
    if (errorEl) { errorEl.textContent = ''; errorEl.hidden = true; }

    try {
      const body = new URLSearchParams();
      if (currentToken && currentToken !== 'no-captcha') {
        body.set('cf-turnstile-response', currentToken);
      }

      const resp = await fetch(VERIFY_PATH + encodeURIComponent(currentSlug), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });

      const json = await resp.json();

      if (!resp.ok || !json.ok || !json.downloadUrl) {
        throw new Error(json.message || json.error || L.verifyError);
      }

      // Trigger download
      const a = document.createElement('a');
      a.href = json.downloadUrl;
      a.download = pendingDownloadName || '';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 1000);

      closeModal();
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err.message || L.networkError;
        errorEl.hidden = false;
      }
      // Re-enable button and reset Turnstile for retry
      if (proceedBtn) {
        proceedBtn.disabled = false;
        proceedBtn.textContent = LOCALE === 'vi' ? 'Tải xuống' : 'Proceed';
      }
      if (tsWidgetId !== null && window.turnstile) {
        try { window.turnstile.reset(tsWidgetId); } catch (_) {}
        currentToken = null;
        if (proceedBtn) proceedBtn.disabled = true;
      }
    }
  }

  /* ── Search ───────────────────────────────────────────────────── */
  function initSearch() {
    const input = document.getElementById('search-input');
    if (!input) return;
    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        searchQuery = input.value.trim();
        renderTable();
      }, 120);
    });
    // Press '/' anywhere (outside input) to focus search
    document.addEventListener('keydown', e => {
      if (e.key === '/' && document.activeElement !== input
          && document.activeElement.tagName !== 'INPUT'
          && document.activeElement.tagName !== 'TEXTAREA'
          && document.activeElement.tagName !== 'SELECT') {
        e.preventDefault();
        input.focus();
      }
      if (e.key === 'Escape' && document.activeElement === input) {
        input.blur();
        searchQuery = '';
        input.value = '';
        renderTable();
      }
    });
  }

  /* ── Sort ─────────────────────────────────────────────────────── */
  function initSort() {
    const sel = document.getElementById('sort-select');
    if (!sel) return;
    sel.addEventListener('change', () => {
      activeSort = sel.value;
      renderTable();
    });
  }

  /* ── Modal event listeners ────────────────────────────────────── */
  function initModal() {
    const modal = document.getElementById('dl-modal');
    const closeBtn = document.getElementById('dl-modal-close');
    const cancelBtn = document.getElementById('dl-modal-cancel');
    const proceedBtn = document.getElementById('dl-modal-proceed');

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (proceedBtn) proceedBtn.addEventListener('click', proceedDownload);

    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) closeModal();
      });
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal && !modal.hidden) closeModal();
    });
  }

  /* ── Boot ─────────────────────────────────────────────────────── */
  function init() {
    updateStats();
    renderFilterChips();
    renderTable();
    initSearch();
    initSort();
    initModal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
