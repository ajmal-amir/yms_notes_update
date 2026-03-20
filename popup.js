const runBtn      = document.getElementById('runBtn');
const stopBtn     = document.getElementById('stopBtn');
const statusEl    = document.getElementById('status');
const progressWrap= document.getElementById('progressWrap');
const progressFill= document.getElementById('progressFill');

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

runBtn.addEventListener('click', async () => {
  setRunning(true);
  setStatus('Scanning page for blank notes…', 'running');
  progressWrap.style.display = 'none';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
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
      const carrier = msg.carrier ? ` [${msg.carrier}]` : '';
      setStatus(`Processing row ${msg.done} of ${msg.total} → ${msg.note}${carrier}`, 'running');
      setProgress(msg.done, msg.total);
    }

    if (msg.type === 'DONE') {
      setStatus(`✅ Done! Filled ${msg.filled} note(s). Skipped ${msg.skipped} (already had notes).`, 'done');
      setProgress(msg.filled + msg.skipped, msg.filled + msg.skipped);
      setRunning(false);
      chrome.runtime.onMessage.removeListener(handler);
    }

    if (msg.type === 'STOPPED') {
      setStatus(`⏹ Stopped after ${msg.filled} filled. ${msg.remaining} row(s) left untouched.`, 'error');
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
  chrome.tabs.sendMessage(tab.id, { type: 'RUN' });
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  setStatus('⏳ Stopping after current row…', 'running');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'STOP' });
});
