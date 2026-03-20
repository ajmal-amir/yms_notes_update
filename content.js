/**
 * YMS Note Auto-Fill — Content Script
 *
 * ══════════════════════════════════════════════════════
 *  EMPTY TRAILERS  →  decided by CARRIER CODE only
 *  (Visit Reason / blank is irrelevant for empty trailers)
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
 * ══════════════════════════════════════════════════════
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Waits for a DOM element matching `selector` to appear (using MutationObserver).
 * Resolves with the element when found, or resolves with null after `timeout` ms.
 */
function waitForElement(selector, timeout = 5000) {
  return new Promise(resolve => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });
}

/**
 * Waits for a DOM element to disappear from the DOM.
 */
function waitForElementGone(element, timeout = 6000) {
  return new Promise(resolve => {
    if (!document.contains(element)) return resolve();
    const observer = new MutationObserver(() => {
      if (!document.contains(element)) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(); }, timeout);
  });
}

/**
 * Sets a value on a textarea/input in a way that Angular 1.x picks it up.
 * Angular watches for the 'input' event and syncs its model from the DOM value.
 */
function setNativeValue(element, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  ) || Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  );
  if (nativeSetter && nativeSetter.set) {
    nativeSetter.set.call(element, value);
  } else {
    element.value = value;
  }
  // Fire events so Angular's ng-model picks it up
  element.dispatchEvent(new Event('input',  { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
}

// ─── Row Scanning ─────────────────────────────────────────────────────────────

/**
 * Amazon/partner carrier codes that mean OUTBOUND for empty trailers.
 * Everything else is treated as INBOUND (third-party / external carriers).
 */
const OB_CARRIERS = new Set(['AZNG', 'AZNU', 'HGBI', 'HGBU', 'JBHU', 'HGIU', 'SWIFT']);

/**
 * Gets the vehicle status for a given row.
 * col2 uses `rowspan` so it may only exist in the FIRST row of a group.
 * We walk backwards through siblings to find the row that owns col2.
 *
 * Returns 'FULL' if ANY icon is full/in-progress, 'EMPTY' if all are empty.
 */
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

/**
 * Gets the Visit Reason for a row from col5.
 *
 * IMPORTANT: In the YMS DOM, INBOUND rows often render a BLANK col5 —
 * the text "INBOUND" is not always injected by Angular.
 * Only OUTBOUND rows consistently show explicit text.
 *
 * Returns: 'OUTBOUND' | 'INBOUND' | 'BLANK'
 */
function getVisitReason(row) {
  const div = row.querySelector('td.col5 .shipclerk-bold-label');
  if (!div) return 'BLANK';

  const raw = div.textContent.trim().toUpperCase().replace(/\s+/g, ' ');
  console.log('[YMS Auto-Fill] row', row.id, '| Visit Reason raw: "' + raw + '"');

  if (raw.includes('OUTBOUND')) return 'OUTBOUND';
  if (raw.includes('INBOUND'))  return 'INBOUND';
  return 'BLANK'; // blank = no visit reason set (Amazon-owned trailers staging OB)
}

/**
 * Gets the carrier code from col8.
 * The cell text looks like: "AZNG (ARFAN)" or "HGIU (HUBG)"
 * We extract just the first uppercase token before any space/parenthesis.
 */
function getCarrierCode(row) {
  const span = row.querySelector('td.col8 .ownerOperatorCodeGroup .shipclerk-bold-label');
  if (!span) return '';
  // Extract first word — e.g. "AZNG (ARFAN)" → "AZNG"
  const raw = span.textContent.trim().toUpperCase();
  const match = raw.match(/^([A-Z0-9]+)/);
  const code = match ? match[1] : '';
  console.log('[YMS Auto-Fill] row', row.id, '| Carrier raw: "' + raw + '" → code: "' + code + '"');
  return code;
}

/**
 * ════════════════════════════════════════════════════════
 *  DECISION RULES
 * ════════════════════════════════════════════════════════
 *
 *  VEHICLE EMPTY  →  carrier code decides, visit reason is IGNORED
 *    OB carriers (AZNG/AZNU/HGBI/HGBU/JBHU/HGIU/SWIFT) → OBEMPTY
 *    Any other carrier                                   → IBEMPTY
 *
 *  VEHICLE LOADED →  visit reason decides, carrier is IGNORED
 *    OUTBOUND  → OBLOAD
 *    INBOUND   → IBLOAD
 *
 *  Note: a blank visit reason on a LOADED trailer defaults to IBLOAD.
 *        A blank visit reason on an EMPTY trailer still uses carrier rule above.
 * ════════════════════════════════════════════════════════
 */
function determineNote(visitReason, vehicleStatus, carrierCode) {
  if (vehicleStatus === 'EMPTY') {
    // Carrier-only rule — visit reason does NOT matter for empty trailers
    return OB_CARRIERS.has(carrierCode) ? 'OBEMPTY' : 'IBEMPTY';
  }
  if (vehicleStatus === 'FULL') {
    // Visit reason rule — carrier does NOT matter for loaded trailers
    return visitReason === 'OUTBOUND' ? 'OBLOAD' : 'IBLOAD';
  }
  return null;
}

/**
 * Scans all YMS table rows and returns an array of work items.
 * Only rows with a BLANK note are included.
 */
function buildWorkQueue() {
  const rows = document.querySelectorAll('tr[ng-repeat="yardAsset in yardAssetGroup"]');
  console.log('[YMS Auto-Fill] Total rows found:', rows.length);
  const queue = [];

  rows.forEach(row => {
    // ── 1. Skip if note is already filled (two checks) ──────────────────────
    const noteP = row.querySelector('td.col11 p.block-with-text.testclass');
    if (!noteP) {
      console.log('[YMS Auto-Fill] row', row.id, '→ SKIP (no note cell)');
      return;
    }
    const existingNote = noteP.textContent.trim();
    if (existingNote !== '') {
      console.log('[YMS Auto-Fill] row', row.id, '→ SKIP (has note: "' + existingNote + '")');
      return;
    }

    const noteIcon = row.querySelector('td.col11 div[ng-click*="openAnnotationDialog"]');
    if (!noteIcon) {
      console.log('[YMS Auto-Fill] row', row.id, '→ SKIP (no note icon)');
      return;
    }
    if (noteIcon.classList.contains('note-present-icon')) {
      console.log('[YMS Auto-Fill] row', row.id, '→ SKIP (note-present-icon class)');
      return;
    }

    // ── 2. Read vehicle status ──────────────────────────────────────────────
    const vehicleStatus = getVehicleStatus(row);
    if (!vehicleStatus) {
      console.log('[YMS Auto-Fill] row', row.id, '→ SKIP (vehicle status unknown)');
      return;
    }

    // ── 3. Read visit reason and carrier ───────────────────────────────────
    const visitReason = getVisitReason(row);
    const carrierCode = getCarrierCode(row);

    // ── 4. Determine note ──────────────────────────────────────────────────
    const note = determineNote(visitReason, vehicleStatus, carrierCode);
    if (!note) {
      console.log('[YMS Auto-Fill] row', row.id, '→ SKIP (no rule matched:', visitReason, vehicleStatus, carrierCode, ')');
      return;
    }

    console.log('[YMS Auto-Fill] row', row.id, '→ QUEUE', note,
      '| reason:', visitReason, '| vehicle:', vehicleStatus, '| carrier:', carrierCode);

    queue.push({ row, note, noteIcon, visitReason, vehicleStatus, carrierCode });
  });

  console.log('[YMS Auto-Fill] Work queue:', queue.length, 'rows');
  return queue;
}

// ─── Dialog Automation ───────────────────────────────────────────────────────

/**
 * Clicks the note icon for a row, waits for the YMS annotation dialog to open,
 * fills in the note using the exact #noteTextArea + updateAsset() button, then saves.
 */
async function fillNote(item) {
  const { noteIcon, note } = item;

  // ── Click the note pencil/icon to open the dialog ───────────────────────
  noteIcon.click();

  // ── Wait for the exact YMS annotation modal to appear ───────────────────
  // The modal contains: #yms-annotation-modal > form#noteEditForm > #noteTextArea
  const textarea = await waitForElement('#noteTextArea', 6000);

  if (!textarea) {
    console.warn('[YMS Auto-Fill] #noteTextArea not found — dialog did not open for row', item.row.id);
    // Dismiss any partial overlay with Escape
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(600);
    return false;
  }

  // ── Make sure the textarea is empty before writing ──────────────────────
  // (safety: if the dialog opened on a row that somehow already had a note,
  //  we do NOT overwrite it — we close and skip)
  const existingValue = textarea.value.trim();
  if (existingValue !== '') {
    console.log('[YMS Auto-Fill] Dialog textarea has content — skipping and closing.', existingValue);
    // Click the close (×) button
    const closeBtn = document.querySelector('#closeButton, #yms-annotation-modal #closeButton');
    if (closeBtn) closeBtn.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);
    return false; // skip — already has a note
  }

  // ── Focus and fill the textarea ─────────────────────────────────────────
  textarea.focus();
  await sleep(150);

  // Use Angular-compatible value setter so ng-model syncs
  setNativeValue(textarea, note);
  await sleep(250);

  // ── Click the exact Save button: button[ng-click="updateAsset()"] ───────
  const saveBtn = document.querySelector(
    'button[ng-click="updateAsset()"].yms-button-primary, ' +
    '#noteEditForm button[ng-click="updateAsset()"], ' +
    '#yms-annotation-modal button[ng-click="updateAsset()"]'
  );

  if (!saveBtn) {
    // Fallback: find any visible button with text "Save" inside the modal
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

  // ── Wait for dialog to close (textarea leaves the DOM) ──────────────────
  await waitForElementGone(textarea, 6000);
  await sleep(400); // brief pause before next row

  return true;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

let isRunning  = false;
let stopSignal = false;  // set to true when user clicks Stop

chrome.runtime.onMessage.addListener(async (msg) => {

  // ── STOP signal ──────────────────────────────────────────────────────────
  if (msg.type === 'STOP') {
    stopSignal = true;
    return;
  }

  if (msg.type !== 'RUN') return;
  if (isRunning) return;

  isRunning  = true;
  stopSignal = false;

  try {
    // Build work queue
    const queue = buildWorkQueue();

    chrome.runtime.sendMessage({ type: 'FOUND', count: queue.length });

    if (queue.length === 0) {
      chrome.runtime.sendMessage({ type: 'DONE', filled: 0, skipped: 0 });
      isRunning = false;
      return;
    }

    let filled = 0;
    let failed = 0;

    for (let i = 0; i < queue.length; i++) {

      // ── Check stop signal BEFORE each row ────────────────────────────
      if (stopSignal) {
        chrome.runtime.sendMessage({
          type:      'STOPPED',
          filled,
          remaining: queue.length - i
        });
        isRunning  = false;
        stopSignal = false;
        return;
      }

      const item = queue[i];

      chrome.runtime.sendMessage({
        type:  'PROGRESS',
        done:  i + 1,
        total: queue.length,
        note:  item.note,
        rowId: item.row.id,
        carrier: item.carrierCode
      });

      const success = await fillNote(item);
      if (success) filled++;
      else         failed++;

      // Small pause between rows to avoid overwhelming the page
      await sleep(600);
    }

    // Count rows that already had notes (skipped before queue)
    const allRows = document.querySelectorAll('tr[ng-repeat="yardAsset in yardAssetGroup"]');
    let alreadyFilled = 0;
    allRows.forEach(row => {
      const p = row.querySelector('td.col11 p.block-with-text.testclass');
      if (p && p.textContent.trim() !== '') alreadyFilled++;
    });

    chrome.runtime.sendMessage({
      type:    'DONE',
      filled,
      skipped: alreadyFilled,
      failed
    });

  } catch (err) {
    chrome.runtime.sendMessage({ type: 'ERROR', message: err.message });
  } finally {
    isRunning  = false;
    stopSignal = false;
  }
});
