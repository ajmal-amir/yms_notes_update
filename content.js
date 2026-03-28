/**
 * YMS Note Auto-Fill — Content Script  v2.0
 *
 * ══════════════════════════════════════════════════════
 *  EMPTY TRAILERS  →  decided by CARRIER CODE only
 *
 *    Carrier = AZNG | AZNU | HGBI | HGBU | JBHU | HGIU | SWIFT  →  OBEMPTY
 *    Carrier = anything else                                       →  IBEMPTY
 *
 *  LOADED TRAILERS  →  decided by VISIT REASON only
 *
 *    Visit Reason = INBOUND   →  IBLOAD
 *    Visit Reason = OUTBOUND  →  OBLOAD
 *
 *  Rows that already have a note are NEVER touched.
 *
 *  v2.0 change: Switched from a pre-built DOM-reference queue to a
 *  "find next target fresh every iteration" loop. This survives Angular
 *  re-renders that previously staled out the queue after 1–2 fills.
 *  Also supports Continuous Mode — auto-retries after all visible rows
 *  are done so the user never has to manually refresh and re-click.
 * ══════════════════════════════════════════════════════
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForElement(selector, timeout = 5000) {
  return new Promise(resolve => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });
}

function waitForElementGone(element, timeout = 6000) {
  return new Promise(resolve => {
    if (!document.contains(element)) return resolve();
    const observer = new MutationObserver(() => {
      if (!document.contains(element)) { observer.disconnect(); resolve(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(); }, timeout);
  });
}

function setNativeValue(element, value) {
  const nativeSetter =
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value') ||
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  if (nativeSetter && nativeSetter.set) {
    nativeSetter.set.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input',  { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
}

// ─── Row Reading ──────────────────────────────────────────────────────────────

const OB_CARRIERS = new Set(['AZNG', 'AZNU', 'HGBI', 'HGBU', 'JBHU', 'HGIU', 'SWIFT']);

function getVehicleStatus(row) {
  let searchRow = row;
  while (searchRow) {
    const col2 = searchRow.querySelector('td.col2');
    if (col2) {
      const icons = col2.querySelectorAll('.yard-asset-icon');
      if (icons.length > 0) {
        for (const icon of icons) {
          const cls = icon.className;
          if (cls.includes('yardasset-full'))        return 'FULL';
          if (cls.includes('yardasset-in-progress')) return 'FULL';
        }
        for (const icon of icons) {
          if (icon.className.includes('yardasset-empty')) return 'EMPTY';
        }
      }
      break;
    }
    searchRow = searchRow.previousElementSibling;
  }
  return null;
}

function getVisitReason(row) {
  const div = row.querySelector('td.col5 .shipclerk-bold-label');
  if (!div) return 'BLANK';
  const raw = div.textContent.trim().toUpperCase().replace(/\s+/g, ' ');
  if (raw.includes('OUTBOUND')) return 'OUTBOUND';
  if (raw.includes('INBOUND'))  return 'INBOUND';
  return 'BLANK';
}

function getCarrierCode(row) {
  const span = row.querySelector('td.col8 .ownerOperatorCodeGroup .shipclerk-bold-label');
  if (!span) return '';
  const raw = span.textContent.trim().toUpperCase();
  const match = raw.match(/^([A-Z0-9]+)/);
  return match ? match[1] : '';
}

function determineNote(visitReason, vehicleStatus, carrierCode) {
  if (vehicleStatus === 'EMPTY') {
    return OB_CARRIERS.has(carrierCode) ? 'OBEMPTY' : 'IBEMPTY';
  }
  if (vehicleStatus === 'FULL') {
    return visitReason === 'OUTBOUND' ? 'OBLOAD' : 'IBLOAD';
  }
  return null;
}

// ─── Core Change: Find Next Target Fresh Every Iteration ─────────────────────
//
// OLD approach: buildWorkQueue() — scanned the DOM once, stored an array of
// live DOM node references ({ row, noteIcon, … }). Angular re-renders the
// table after each save, replacing those nodes, so references went stale after
// 1–2 fills.
//
// NEW approach: findNextBlankRow() — re-queries the DOM every call, returns the
// first qualifying row that still has a blank note. Because we never cache node
// refs across iterations, Angular re-renders can't stale them out.

function findNextBlankRow() {
  const rows = document.querySelectorAll('tr[ng-repeat="yardAsset in yardAssetGroup"]');

  for (const row of rows) {
    const noteP = row.querySelector('td.col11 p.block-with-text.testclass');
    if (!noteP) continue;
    if (noteP.textContent.trim() !== '') continue;

    const noteIcon = row.querySelector('td.col11 div[ng-click*="openAnnotationDialog"]');
    if (!noteIcon) continue;
    if (noteIcon.classList.contains('note-present-icon')) continue;

    const vehicleStatus = getVehicleStatus(row);
    if (!vehicleStatus) continue;

    const visitReason = getVisitReason(row);
    const carrierCode = getCarrierCode(row);
    const note = determineNote(visitReason, vehicleStatus, carrierCode);
    if (!note) continue;

    console.log('[YMS Auto-Fill] Next target:', row.id,
      '→', note, '| reason:', visitReason, '| vehicle:', vehicleStatus, '| carrier:', carrierCode);

    return { row, noteIcon, note, visitReason, vehicleStatus, carrierCode };
  }

  return null; // no more blank rows visible right now
}

/** Count all currently-blank rows (for initial total estimate). */
function countBlankRows() {
  let count = 0;
  const rows = document.querySelectorAll('tr[ng-repeat="yardAsset in yardAssetGroup"]');
  for (const row of rows) {
    const noteP = row.querySelector('td.col11 p.block-with-text.testclass');
    if (!noteP) continue;
    if (noteP.textContent.trim() !== '') continue;
    const noteIcon = row.querySelector('td.col11 div[ng-click*="openAnnotationDialog"]');
    if (!noteIcon || noteIcon.classList.contains('note-present-icon')) continue;
    count++;
  }
  return count;
}

// ─── Dialog Automation ───────────────────────────────────────────────────────

async function fillNote(item) {
  const { noteIcon, note } = item;

  noteIcon.click();

  const textarea = await waitForElement('#noteTextArea', 6000);
  if (!textarea) {
    console.warn('[YMS Auto-Fill] Dialog did not open for row', item.row.id);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(600);
    return false;
  }

  // Safety: don't overwrite an existing note even if we somehow got here
  if (textarea.value.trim() !== '') {
    console.log('[YMS Auto-Fill] Textarea already has content — skipping.', textarea.value.trim());
    const closeBtn = document.querySelector('#closeButton, #yms-annotation-modal #closeButton');
    if (closeBtn) closeBtn.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);
    return false;
  }

  textarea.focus();
  await sleep(150);
  setNativeValue(textarea, note);
  await sleep(250);

  const saveBtn = document.querySelector(
    'button[ng-click="updateAsset()"].yms-button-primary, ' +
    '#noteEditForm button[ng-click="updateAsset()"], ' +
    '#yms-annotation-modal button[ng-click="updateAsset()"]'
  );

  if (!saveBtn) {
    const allBtns = document.querySelectorAll('#yms-annotation-modal button, .modal-content button');
    let fallback = null;
    for (const btn of allBtns) {
      if (btn.textContent.trim().toLowerCase() === 'save') { fallback = btn; break; }
    }
    if (fallback) {
      fallback.click();
    } else {
      console.warn('[YMS Auto-Fill] Save button not found — pressing Enter as last resort.');
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    }
  } else {
    saveBtn.click();
  }

  await waitForElementGone(textarea, 6000);
  await sleep(400);
  return true;
}

// ─── Main Loop ───────────────────────────────────────────────────────────────

let isRunning  = false;
let stopSignal = false;

chrome.runtime.onMessage.addListener(async (msg) => {

  if (msg.type === 'STOP') {
    stopSignal = true;
    return;
  }

  if (msg.type !== 'RUN') return;
  if (isRunning) return;

  isRunning  = true;
  stopSignal = false;

  const continuous       = !!msg.continuous;   // Continuous Mode flag from popup
  const maxRetryWait     = 8000;               // ms to wait for new rows to appear
  const retryPollEvery   = 500;               // polling interval while waiting
  const maxEmptyPasses   = 3;                 // stop after N consecutive passes with 0 new rows

  try {
    // ── Initial count for progress display ────────────────────────────────
    const initialBlank = countBlankRows();
    chrome.runtime.sendMessage({ type: 'FOUND', count: initialBlank });

    if (initialBlank === 0) {
      chrome.runtime.sendMessage({ type: 'DONE', filled: 0, skipped: 0 });
      isRunning = false;
      return;
    }

    let filled       = 0;
    let emptyPasses  = 0;  // consecutive passes where findNextBlankRow() returned null
    let passNumber   = 1;

    // ══════════════════════════════════════════════════════════════════════
    //  MAIN LOOP
    //
    //  Each iteration:
    //    1. Re-query the DOM for the next blank row (fresh refs every time)
    //    2. If found → fill it, update progress
    //    3. If not found:
    //       a. If Continuous Mode: wait up to maxRetryWait ms for new rows
    //          to appear (YMS lazy-loads after a save), then try again.
    //          After maxEmptyPasses consecutive waits with no rows → stop.
    //       b. If NOT Continuous Mode: stop immediately.
    // ══════════════════════════════════════════════════════════════════════

    while (true) {

      if (stopSignal) {
        chrome.runtime.sendMessage({ type: 'STOPPED', filled, remaining: countBlankRows() });
        break;
      }

      const item = findNextBlankRow();

      if (!item) {
        // No blank rows visible right now
        if (!continuous) break;  // single-pass mode: we're done

        // ── Continuous mode: wait and see if YMS loads more rows ─────────
        emptyPasses++;
        if (emptyPasses >= maxEmptyPasses) {
          console.log('[YMS Auto-Fill] No new rows after', maxEmptyPasses, 'retries — done.');
          break;
        }

        chrome.runtime.sendMessage({
          type: 'WAITING',
          pass: passNumber,
          filled,
          waitMs: maxRetryWait
        });

        // Poll for up to maxRetryWait ms
        const deadline = Date.now() + maxRetryWait;
        let newRowAppeared = false;
        while (Date.now() < deadline) {
          if (stopSignal) break;
          await sleep(retryPollEvery);
          if (findNextBlankRow()) { newRowAppeared = true; break; }
        }

        if (!newRowAppeared || stopSignal) break;

        passNumber++;
        emptyPasses = 0; // reset — new rows appeared
        continue;
      }

      // ── Row found — reset empty-pass counter and fill it ─────────────
      emptyPasses = 0;

      chrome.runtime.sendMessage({
        type:    'PROGRESS',
        done:    filled + 1,
        total:   initialBlank,   // fixed — never grows
        note:    item.note,
        carrier: item.carrierCode,
        pass:    passNumber
      });

      const success = await fillNote(item);
      if (success) filled++;

      await sleep(600);
    }

    // Final skipped count
    const allRows = document.querySelectorAll('tr[ng-repeat="yardAsset in yardAssetGroup"]');
    let alreadyFilled = 0;
    allRows.forEach(row => {
      const p = row.querySelector('td.col11 p.block-with-text.testclass');
      if (p && p.textContent.trim() !== '') alreadyFilled++;
    });

    chrome.runtime.sendMessage({ type: 'DONE', filled, skipped: alreadyFilled });

  } catch (err) {
    chrome.runtime.sendMessage({ type: 'ERROR', message: err.message });
  } finally {
    isRunning  = false;
    stopSignal = false;
  }
});
