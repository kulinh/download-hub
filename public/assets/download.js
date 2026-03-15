/**
 * download.js — External download gate script
 * Replaces inline <script> in download.ejs for better CSP compatibility.
 * All user-facing strings come from data-* attributes on this script tag.
 */
(function () {
  'use strict';

  const scriptEl = document.currentScript;
  if (!scriptEl) return;

  // --- Config from data attributes ---
  const msgs = {
    verifying:     scriptEl.dataset.msgVerifying     || 'Verifying…',
    successPrefix: scriptEl.dataset.msgSuccessPrefix || 'Verified! Link expires in ',
    successSuffix: scriptEl.dataset.msgSuccessSuffix || ' seconds.',
    error:         scriptEl.dataset.msgError         || 'Verification failed. Please try again.',
    network:       scriptEl.dataset.msgNetwork       || 'Network error. Please try again.',
    expired:       scriptEl.dataset.msgExpired       || 'Link expired. Please verify again.',
    expiryPrefix:  scriptEl.dataset.msgExpiryPrefix  || 'Expires in',
    expirySuffix:  scriptEl.dataset.msgExpirySuffix  || 'seconds',
    download:      scriptEl.dataset.msgDownload      || 'Download'
  };

  // --- DOM refs ---
  const form      = document.getElementById(scriptEl.dataset.formId    || 'verify-form');
  const resultEl  = document.getElementById(scriptEl.dataset.resultId  || 'result');
  const submitBtn = document.getElementById(scriptEl.dataset.submitId  || 'submit-btn');

  if (!form || !resultEl) return;

  const btnText    = submitBtn?.querySelector('.btn-text');
  const btnSpinner = submitBtn?.querySelector('.btn-spinner');

  // --- Helpers ---
  function setLoading(loading) {
    if (!submitBtn) return;
    submitBtn.disabled = loading;
    submitBtn.classList.toggle('btn-loading', loading);
    if (btnText)    btnText.hidden    = loading;
    if (btnSpinner) btnSpinner.hidden = !loading;
  }

  function clearResult() {
    resultEl.textContent = '';
    resultEl.className = 'result';
  }

  function showError(message) {
    clearResult();
    resultEl.className = 'result result-error';
    resultEl.textContent = message;
  }

  function showSuccess(downloadUrl, expiresInSeconds) {
    clearResult();
    resultEl.className = 'result result-success';

    const label = document.createElement('p');
    label.className = 'success-label';
    label.textContent = msgs.successPrefix + expiresInSeconds + msgs.successSuffix;

    const link = document.createElement('a');
    link.className = 'button button-download';
    link.href = downloadUrl;
    link.textContent = msgs.download;
    // Open in same tab — triggers download
    link.setAttribute('download', '');

    const countdown = document.createElement('span');
    countdown.className = 'expiry-countdown';

    resultEl.appendChild(label);
    resultEl.appendChild(link);
    resultEl.appendChild(countdown);

    // Countdown timer
    let remaining = expiresInSeconds;
    function tick() {
      if (remaining <= 0) {
        showError(msgs.expired);
        link.remove();
        return;
      }
      countdown.textContent = msgs.expiryPrefix + ' ' + remaining + ' ' + msgs.expirySuffix;
      remaining--;
      setTimeout(tick, 1000);
    }
    tick();
  }

  // --- Form submit handler ---
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    clearResult();
    setLoading(true);
    resultEl.className = 'result result-pending';
    resultEl.textContent = msgs.verifying;

    try {
      const payload = new URLSearchParams(new FormData(form));
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: payload.toString(),
        credentials: 'same-origin'
      });

      let data;
      try {
        data = await response.json();
      } catch (_) {
        throw new Error('parse_error');
      }

      if (!response.ok || !data.ok) {
        showError(data.error || msgs.error);
        return;
      }

      showSuccess(data.downloadUrl, data.expiresInSeconds);

    } catch (err) {
      if (err.message === 'parse_error') {
        showError(msgs.error);
      } else {
        showError(msgs.network);
      }
    } finally {
      setLoading(false);
    }
  });
})();
