# GAS 追記（search_ に出荷済みカードを返す）

対象: Apps Script プロジェクトの `search_` 関数  
場所: 製造行ごとの在庫/未処理を push している for ループの末尾

```js
// ---- 出荷済み（合計）
// logs.byRow[m.__rowNumber].shippedTotal が集計済み
if (by.shippedTotal > 0) {
  out.push({
    rowIndex: m.__rowNumber,
    manufactureDate: m.manufactureDate,
    batchNo: m.batchNo,
    seasoningType: m.seasoningType,
    fishType: m.fishType,
    origin: m.origin,
    quantity: by.shippedTotal,            // 出荷合計
    manufactureProduct: m.manufactureProduct,
    status: '出荷済み',
    packingInfo: { location: '', quantity: String(by.shippedTotal) }
  });
}
```

