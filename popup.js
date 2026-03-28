const runBtn       = document.getElementById('runBtn');
const stopBtn      = document.getElementById('stopBtn');
const statusEl     = document.getElementById('status');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const modeToggle   = document.getElementById('modeToggle');
const modeLabel    = document.getElementById('modeLabel');

// ── Mode toggle ───────────────────────────────────────────────────────────────
let continuousMode = false;

modeToggle.addEventListener('change', () => {
  continuousMode = modeToggle.checked;
  modeLabel.textContent = continuousMode
    ? '🔄 Continuous — keeps retrying as YMS loads rows'
    : '1× Single pass — stops when visible rows are done';
  modeLabel.className = continuousMode ? 'mode-label on' : 'mode-label';
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(msg, cls = '') {
  statusEl.className = cls;
  statusEl.textContent = msg;
}

function setProgress(done, total) {
  progressWrap.style.display = 'block';
  progressFill.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%';
}

function setRunning(running) {
  runBtn.disabled  =  running;
  stopBtn.disabled = !running;
}

// ── Run ───────────────────────────────────────────────────────────────────────
runBtn.addEventListener('click', async () => {
  setRunning(true);
  setStatus('Scanning page for blank notes…', 'running');
  progressWrap.style.display = 'none';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (e) {
    // Already injected — fine
  }

  const handler = (msg) => {
    if (msg.type === 'FOUND') {
      if (msg.count === 0) {
        setStatus('✅ No blank notes found to fill!', 'done');
        setRunning(false);
      } else {
        setStatus(`Found ${msg.count} blank row(s) — filling…`, 'running');
        setProgress(0, msg.count);
      }
    }

    if (msg.type === 'PROGRESS') {
      const carrier  = msg.carrier ? ` [${msg.carrier}]` : '';
      const passInfo = continuousMode && msg.pass > 1 ? ` (pass ${msg.pass})` : '';
      setStatus(`Row ${msg.done} of ${msg.total} → ${msg.note}${carrier}${passInfo}`, 'running');
      setProgress(msg.done, msg.total);
    }

    // New: Continuous Mode waiting state
    if (msg.type === 'WAITING') {
      setStatus(`⏳ Pass ${msg.pass} done (${msg.filled} filled) — waiting for YMS to load more rows…`, 'running');
      // Animate progress bar to pulse while waiting
      progressFill.style.width = '100%';
    }

    if (msg.type === 'DONE') {
      setStatus(`✅ Done! Filled ${msg.filled} note(s). Skipped ${msg.skipped} (already had notes).`, 'done');
      setProgress(msg.filled + msg.skipped, msg.filled + msg.skipped);
      setRunning(false);
      chrome.runtime.onMessage.removeListener(handler);
    }

    if (msg.type === 'STOPPED') {
      setStatus(`⏹ Stopped — ${msg.filled} filled, ${msg.remaining} blank row(s) left.`, 'error');
      setRunning(false);
      chrome.runtime.onMessage.removeListener(handler);
    }

    if (msg.type === 'ERROR') {
      setStatus(`❌ Error: ${msg.message}`, 'error');
      setRunning(false);
      chrome.runtime.onMessage.removeListener(handler);
    }
  };

  chrome.runtime.onMessage.addListener(handler);
  chrome.tabs.sendMessage(tab.id, { type: 'RUN', continuous: continuousMode });
});

// ── Stop ──────────────────────────────────────────────────────────────────────
stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  setStatus('⏳ Stopping after current row…', 'running');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'STOP' });
});
