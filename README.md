# 🚛 YMS Note Auto-Fill

> A Chrome Extension that automatically fills blank notes on the Amazon Yard Management System (YMS) dashboard — saving time and reducing manual data entry errors.

**Developed by [Ajmal Amir](mailto:amiajmal@amazon.com)**

---

## 📋 Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Fill Rules](#fill-rules)
- [Installation](#installation)
- [Usage](#usage)
- [Safety Guarantees](#safety-guarantees)
- [File Structure](#file-structure)
- [Troubleshooting](#troubleshooting)

---

## Overview

Working on the YMS Yard Management dashboard means manually reviewing dozens — sometimes hundreds — of trailer rows and typing the same note codes over and over: `IBLOAD`, `OBLOAD`, `IBEMPTY`, `OBEMPTY`.

**YMS Note Auto-Fill** eliminates that entirely. With one click it scans every row on the page, figures out the correct note based on the trailer's carrier code, vehicle status, and visit reason, then opens each annotation dialog, types the note, and saves — automatically, one row at a time.

Rows that **already have a note are never touched**. Ever.

---

## How It Works

The extension reads three pieces of data directly from the YMS table for each row:

| Data Point | Where It Comes From | Example |
|---|---|---|
| **Vehicle Status** | CSS class on the trailer icon | `yardasset-full` / `yardasset-empty` |
| **Visit Reason** | Column 5 text | `OUTBOUND` / blank |
| **Carrier Code** | Column 8 owner label | `AZNG (ARFAN)` → `AZNG` |

It then applies the rules below, opens the annotation dialog (`#noteTextArea`), fills in the correct value using Angular-compatible event triggering, and clicks the `Save` button (`updateAsset()`).

---

## Fill Rules

### 🚛 Empty Trailers — decided by **Carrier Code only**
> Visit Reason is completely ignored for empty trailers.

| Carrier Code | Note Applied |
|---|---|
| `AZNG` `AZNU` `HGBI` `HGBU` `JBHU` `HGIU` `SWIFT` | **`OBEMPTY`** |
| Any other carrier | **`IBEMPTY`** |

### 📦 Loaded Trailers — decided by **Visit Reason only**
> Carrier is completely ignored for loaded trailers.

| Visit Reason | Note Applied |
|---|---|
| `INBOUND` | **`IBLOAD`** |
| `OUTBOUND` | **`OBLOAD`** |

### 🔒 Already Has a Note?
> **Skipped. Always. No exceptions.**

The extension checks twice — once before queuing the row, and again inside the dialog itself — to make sure existing notes are never overwritten.

---

## Installation

> **No store required.** Install directly in Chrome using Developer Mode.

### Chrome

1. Download and **unzip** the extension folder
2. Open Chrome and navigate to:
   ```
   chrome://extensions
   ```
3. Toggle **Developer Mode** on (top-right corner)
4. Click **"Load unpacked"**
5. Select the unzipped `yms-extension` folder
6. The 🚛 icon will appear in your Chrome toolbar

### Firefox

1. Open Firefox and navigate to:
   ```
   about:debugging
   ```
2. Click **"This Firefox"** → **"Load Temporary Add-on"**
3. Select any file inside the `yms-extension` folder
4. The extension will be active until Firefox is restarted

> ⚠️ **Note:** Firefox temporary add-ons are removed on restart. For permanent Firefox installation, the `chrome.*` API calls need to be replaced with `browser.*`.

---

## Usage

1. **Open** the YMS Yard Management dashboard in Chrome
2. **Click** the 🚛 YMS Note Auto-Fill icon in your toolbar
3. **Click** the `▶ Run Auto-Fill Now` button
4. Watch the progress bar fill as each row is processed
5. Use the `⏹ Stop` button at any time to halt after the current row completes

### What You'll See

```
Found 24 blank row(s) — filling…
Processing row 3 of 24 → OBEMPTY [AZNG]
✅ Done! Filled 24 note(s). Skipped 18 (already had notes).
```

---

## Safety Guarantees

| Guarantee | How It's Enforced |
|---|---|
| Never overwrites existing notes | Checked via `<p>` text content AND icon CSS class before queuing |
| Second layer of protection | Note value inside dialog is re-checked before saving |
| Stops cleanly on request | Stop button waits for the current row to finish before halting |
| No data sent anywhere | Extension runs 100% locally — no network requests, no logging |

---

## File Structure

```
yms-extension/
│
├── manifest.json       # Extension config, permissions, content script rules
├── content.js          # Core logic — row scanning, dialog automation, fill rules
├── popup.html          # Extension popup UI
├── popup.js            # Popup button wiring and progress display
└── README.md           # This file
```

---

## Troubleshooting

### "No blank notes found" but there are blank rows
- Make sure you are on the **YMS Yard Management** dashboard page (not a sub-page)
- Try scrolling down so all rows are rendered in the DOM before running
- Open Chrome DevTools → Console and look for `[YMS Auto-Fill]` log lines to see what each row is detecting

### A row got the wrong note
- Open the Console and find the row ID log — it will show exactly what was read:
  ```
  [YMS Auto-Fill] row V1234 → QUEUE OBEMPTY | reason: BLANK | vehicle: EMPTY | carrier: AZNG
  ```
- If the carrier code looks wrong, the cell text may be formatted differently on your site version — share the row HTML and it can be fixed

### Extension doesn't open the dialog
- The page may need a moment to fully load — wait a few seconds after the page loads before running
- If the dialog opens but doesn't save, check that `#noteTextArea` and `button[ng-click="updateAsset()"]` are present in the modal HTML

### After a Chrome update the extension stops working
- Go to `chrome://extensions` and click the **🔄 refresh icon** on the extension
- If that doesn't help, remove it and re-add it using **Load unpacked**

---

## Adding More Carrier Codes

To add a new carrier to the OBEMPTY list, open `content.js` and find this line:

```javascript
const OB_CARRIERS = new Set(['AZNG', 'AZNU', 'HGBI', 'HGBU', 'JBHU', 'HGIU', 'SWIFT']);
```

Add the new code inside the brackets:

```javascript
const OB_CARRIERS = new Set(['AZNG', 'AZNU', 'HGBI', 'HGBU', 'JBHU', 'HGIU', 'SWIFT', 'NEWCODE']);
```

Then reload the extension at `chrome://extensions`.

---

## Version History

| Version | Date | Changes |
|---|---|---|
| `1.0` | May 2025 | Initial release — IBLOAD, OBLOAD, IBEMPTY, OBEMPTY logic |

---

<div align="center">
  <sub>Built with ❤️ for the CLT2 team · Developed by <strong>Ajmal Amir</strong></sub>
</div>
