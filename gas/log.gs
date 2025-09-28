const CFG = {
  IDS: {
    MAIN: PropertiesService.getScriptProperties().getProperty('SS_MAIN_ID'),
    MIRROR: PropertiesService.getScriptProperties().getProperty('SS_MIRROR_ID'),
  },
  NAMES: {
    LOG: PropertiesService.getScriptProperties().getProperty('LOG_SHEET_NAME') || 'log',
  },
};

const LOG_HEADERS = [
  'rowIndexRef',
  'seasoningType',  // B列: 修正用シート!G を参照（Webアプリからは書かない）
  'fishType',       // C列: 修正用シート!J を参照（Webアプリからは書かない）
  'eventDateTime',
  'eventType',
  'quantity',
  'fromLocation',
  'toLocation',
  'shipType',
  'user',
  'requestId',
];

function ensureSheetAndHeader_(ss, name, headers) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);

  // ヘッダ同期
  const now = sh.getRange(1, 1, 1, headers.length).getValues()[0].map(v => String(v || ''));
  const want = headers.map(String);
  let changed = now.length < want.length;
  if (!changed) {
    for (let i = 0; i < want.length; i++) {
      if (now[i] !== want[i]) { changed = true; break; }
    }
  }
  if (changed) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  // 見出しのスタイル
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  // ヘッダ名で列を特定
  const headRow = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const colOf = (label) => headRow.indexOf(label) + 1;

  // 日時列の表示形式（eventDateTime）
  const dtCol = colOf('eventDateTime');
  if (dtCol > 0) {
    sh.getRange(2, dtCol, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }

  // B/C の参照式（seasoningType / fishType）を常駐（未設定の場合のみ設定）
  const colRef = colOf('rowIndexRef');    // 期待: A列
  const colSeasoning = colOf('seasoningType'); // 期待: B列
  const colFish = colOf('fishType');           // 期待: C列

  if (colRef > 0 && colSeasoning > 0) {
    const f1 =
      '=ARRAYFORMULA(IF(' + columnLetter(colRef) + '2:' + columnLetter(colRef) + '="",,' +
      'IFNA(VLOOKUP(' + columnLetter(colRef) + '2:' + columnLetter(colRef) + ',' +
      '{ROW(\'修正用シート\'!A:A), \'修正用シート\'!G:G}, 2, FALSE),"")))';
    const tgt1 = sh.getRange(2, colSeasoning);
    if (!tgt1.getFormula()) tgt1.setFormula(f1);
  }

  if (colRef > 0 && colFish > 0) {
    const f2 =
      '=ARRAYFORMULA(IF(' + columnLetter(colRef) + '2:' + columnLetter(colRef) + '="",,' +
      'IFNA(VLOOKUP(' + columnLetter(colRef) + '2:' + columnLetter(colRef) + ',' +
      '{ROW(\'修正用シート\'!A:A), \'修正用シート\'!J:J}, 2, FALSE),"")))';
    const tgt2 = sh.getRange(2, colFish);
    if (!tgt2.getFormula()) tgt2.setFormula(f2);
  }

  return sh;
}

function columnLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const payload = e?.postData?.contents ? JSON.parse(e.postData.contents) : {};
    const rowIndexRef = payload.rowIndexRef || '';
    const when = payload.eventDateTime ? new Date(payload.eventDateTime) : new Date();
    const action = payload.eventType || payload.action || '';
    const quantity = Number(payload.quantity) || 0;
    const fromLocation = payload.fromLocation || '';
    const toLocation = payload.toLocation || '';
    const shipType = payload.shipType || '';
    const user = payload.user || '';
    const requestId = payload.requestId || '';

    const ssMainId = CFG.IDS.MAIN;
    if (!ssMainId) throw new Error('SS_MAIN_ID not configured');
    const ssMain = SpreadsheetApp.openById(ssMainId);
    const logSheetMain = ensureSheetAndHeader_(ssMain, CFG.NAMES.LOG, LOG_HEADERS);

    // 列名ベースで書き込み（B/C は式で自動埋めのため書かない）
    const head = logSheetMain.getRange(1, 1, 1, logSheetMain.getLastColumn()).getValues()[0];
    const col = (name) => head.indexOf(name) + 1;
    const r = logSheetMain.getLastRow() + 1;

    if (col('rowIndexRef') > 0)  logSheetMain.getRange(r, col('rowIndexRef')).setValue(rowIndexRef);
    if (col('eventDateTime') > 0) logSheetMain.getRange(r, col('eventDateTime')).setValue(when);
    if (col('eventType') > 0)    logSheetMain.getRange(r, col('eventType')).setValue(action);
    if (col('quantity') > 0)     logSheetMain.getRange(r, col('quantity')).setValue(quantity);
    if (col('fromLocation') > 0) logSheetMain.getRange(r, col('fromLocation')).setValue(fromLocation);
    if (col('toLocation') > 0)   logSheetMain.getRange(r, col('toLocation')).setValue(toLocation);
    if (col('shipType') > 0)     logSheetMain.getRange(r, col('shipType')).setValue(shipType);
    if (col('user') > 0)         logSheetMain.getRange(r, col('user')).setValue(user);
    if (col('requestId') > 0)    logSheetMain.getRange(r, col('requestId')).setValue(requestId);

    const mirrorId = CFG.IDS.MIRROR;
    if (mirrorId) {
      const ssMirror = SpreadsheetApp.openById(mirrorId);
      const mirrorSheet = ensureSheetAndHeader_(ssMirror, CFG.NAMES.LOG, LOG_HEADERS);
      mirrorAppend_(mirrorSheet, [rowIndexRef, when, action, quantity, fromLocation, toLocation, shipType, user, requestId]);
    }

    return jsonResponse_({ success: true });
  } catch (err) {
    return jsonResponse_({ success: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function mirrorAppend_(sheet, values) {
  if (!sheet) return;
  sheet.appendRow(values);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
