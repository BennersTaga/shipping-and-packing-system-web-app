# Google Sheets Webhook (「梱包＆出荷」)

1) シートにタブ名 **梱包＆出荷** を作り、ヘッダ:

   Timestamp | Action | TicketId | Batch | Line | Product | FromStatus | ToStatus | MovedQty | QtyRemainingAfter | StorageLocation | ShippingType | Operator | Note

2) Apps Script を作成し Webアプリとしてデプロイ（実行=自分、アクセス=全員）。`WEBHOOK_TOKEN` をスクリプトプロパティに設定。

```javascript
const SHEET_NAME = '梱包＆出荷';
const TOKEN = PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN');
function doPost(e){try{
  const headerToken = e?.headers?.['x-webhook-token'];
  if(!TOKEN || headerToken!==TOKEN){return ContentService.createTextOutput('Unauthorized').setMimeType(ContentService.MimeType.TEXT)}
  const d = JSON.parse(e.postData.contents);
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  sh.appendRow([new Date(), d.action||'', d.ticketId||'', d.batchNo||'', d.lineNo||'', d.productName||'',
    d.fromStatus||'', d.toStatus||'', Number(d.movedQty)||0, Number(d.qtyRemainingAfter) ?? '',
    d.storageLocation||'', d.shippingType||'', d.operator||'', d.note||'' ]);
  return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
}catch(err){return ContentService.createTextOutput(JSON.stringify({ok:false,error:String(err)})).setMimeType(ContentService.MimeType.JSON)}}
```

