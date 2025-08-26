// src/pages/api/packing/search.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

const querySchema = z.object({
  date: z.string().optional(),
  product: z.string().optional(),
  status: z.string().optional(),
  quantityMin: z.string().optional(),
  quantityMax: z.string().optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const parsed = querySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.message });
    }

    const base = process.env.NEXT_PUBLIC_GAS_BASE_URL;

    if (!base) {
      const date = parsed.data.date || new Date().toISOString().slice(0,10);
      // モック返却（user は任意）
      return res.status(200).json({
        success: true,
        data: [
          { rowIndex:1645, manufactureDate:date, batchNo:"B-645", seasoningType:"醤油(生食用)", fishType:"ホウボウ", origin:"福岡", quantity:200, manufactureProduct:"フィシュル商品", status:"未処理", packingInfo:{ location:"", quantity:"0" } },
          { rowIndex:1646, manufactureDate:date, batchNo:"B-646", seasoningType:"醤油(生食用)", fishType:"ホウボウ", origin:"福岡", quantity:443, manufactureProduct:"フィシュル商品", status:"完了", packingInfo:{ location:"パレット②", quantity:"443", user:"A" } },
          { rowIndex:1647, manufactureDate:date, batchNo:"B-647", seasoningType:"にんにく醤油(生食用)", fishType:"ホウボウ", origin:"福岡", quantity:200, manufactureProduct:"フィシュル商品", status:"完了", packingInfo:{ location:"パレット①", quantity:"200", user:"B" } },
        ],
      });
    }

    const qs = new URLSearchParams(parsed.data as Record<string,string>).toString();
    const r = await fetch(`${base}?action=search&${qs}`, { cache: "no-store" });
    const j = await r.json();
    return res.status(200).json(j);
  } catch (e:any) {
    return res.status(500).json({ success:false, error: e?.message || "proxy error" });
  }
}
