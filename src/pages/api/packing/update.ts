// src/pages/api/packing/update.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // 1) POST 以外は拒否（誤アクセスやヘルスチェック対策）
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ success: false, error: "Method Not Allowed" });
    }

    const base = process.env.NEXT_PUBLIC_GAS_BASE_URL;

    // 2) GAS 未設定時はモック成功（UI テストを止めない）
    if (!base) {
      return res.status(200).json({ success: true, mock: true });
    }

    // 3) GAS へ中継
    const r = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });

    // 4) 応答を丁寧に処理（JSON 以外でも落ちないように）
    const ct = r.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await r.json() : await r.text();

    if (!r.ok) {
      // GAS 側が 4xx/5xx の場合
      return res.status(r.status).json({
        success: false,
        error: typeof body === "string" ? body : (body?.error || `GAS error ${r.status}`),
      });
    }

    // 5) 正常レスポンス
    return res.status(200).json(typeof body === "string" ? { success: true, raw: body } : body);
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || "proxy error" });
  }
}
