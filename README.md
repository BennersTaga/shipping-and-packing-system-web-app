# shipping-and-packing-system-web-app

部分数量の梱包/出荷と Google Sheets へのログ送信を行う試作アプリです。

## 環境変数

`.env` に以下を設定します。

```
GAS_UPDATE_URL=...
GAS_API_KEY=...
GAS_WEBHOOK_URL=...
GAS_WEBHOOK_TOKEN=...
```

## 受け入れテスト

1. 任意のチケットに対し梱包 API を叩き、数量 `n` が移動し残数が `X-n` になること。
2. 出荷 API を叩き、数量 `m` が移動し残数が `残-m` になること。
3. qty が残と等しい場合のみ元チケットが非表示/アーカイブになること。
4. 無効な数量（0/負/超過）は 400 を返すこと。

詳細な Google Sheets 連携手順は `docs/sheets-webhook.md` を参照してください。

