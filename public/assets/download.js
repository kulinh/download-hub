/**
 * download.js — External download gate script (R2-aware revision)
 * Replaces inline <script> in download.ejs for better CSP compatibility.
 * All user-facing strings come from data-* attributes on this script tag.
 *
 * R2 flow: after captcha verification, server returns a presigned R2 URL
 * or a signed token URL. The download-ready-block is revealed with
 * a direct link and countdown.
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
  const form          = document.getElementById(scriptEl.dataset.formId        || 'verify-form');
  const resultEl      = document.getElementById(scriptEl.dataset.resultId      || 'result');
  const submitBtn     = document.getElementById(scriptEl.dataset.submitId      || 'submit-btn');
  const downloadBlock = document.getElementById(scriptEl.dataset.downloadBlockId || 'download-ready-block');
  const downloadLink  = document.getElementById(scriptEl.dataset.downloadLinkId  || 'download-link');
  const expiryEl      = document.getElementById(scriptEl.dataset.expiryId      || 'expiry-countdown');

  if (!form || !resultEl) return;

  const btnText    = submitBtn?.querySelector('.btn-text');
  const btnSpinner = submitBtn?.querySelector('.btn-spinner');

  let countdownTimer = null;

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
    if (downloadBlock) downloadBlock.hidden = true;
    resultEl.className = 'result result-error';
    resultEl.textContent = message;
  }

  function startCountdown(expiresInSeconds) {
    if (countdownTimer) clearInterval(countdownTimer);
    let remaining = expiresInSeconds;

    function tick() {
      if (!expiryEl) return;
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        if (downloadBlock) downloadBlock.hidden = true;
        if (downloadLink)  downloadLink.removeAttribute('href');
        showError(msgs.expired);
        return;
      }
      expiryEl.textContent = msgs.expiryPrefix + ' ' + remaining + ' ' + msgs.expirySuffix;
      remaining--;
    }

    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function showDownloadReady(downloadUrl, expiresInSeconds) {
    clearResult();
    if (downloadBlock) {
      downloadBlock.hidden = false;
      if (downloadLink) {
        downloadLink.href = downloadUrl;
      }
      startCountdown(expiresInSeconds);
    } else {
      // Fallback for older template without download-ready-block
      resultEl.className = 'result result-success';
      const label = document.createElement('p');
      label.textContent = msgs.successPrefix + expiresInSeconds + msgs.successSuffix;
      const link = document.createElement('a');
      link.className = 'button button-accent';
      link.href = downloadUrl;
      link.textContent = msgs.download;
      link.setAttribute('download', '');
      const countdown = document.createElement('span');
      countdown.className = 'expiry-countdown';
      resultEl.appendChild(label);
      resultEl.appendChild(link);
      resultEl.appendChild(countdown);

      let remaining = expiresInSeconds;
      const timer = setInterval(function () {
        if (remaining <= 0) {
          clearInterval(timer);
          showError(msgs.expired);
          link.remove();
          return;
        }
        countdown.textContent = msgs.expiryPrefix + ' ' + remaining + ' ' + msgs.expirySuffix;
        remaining--;
      }, 1000);
    }
  }

  // --- Form submit handler ---
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    clearResult();
    if (downloadBlock) downloadBlock.hidden = true;
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

      showDownloadReady(data.downloadUrl, data.expiresInSeconds);

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
