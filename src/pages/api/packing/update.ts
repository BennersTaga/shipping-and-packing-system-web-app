import type { NextApiRequest, NextApiResponse } from "next";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const base = process.env.NEXT_PUBLIC_GAS_BASE_URL;
  if (!base) return res.status(200).json({ success: true }); // モック
  const r = await fetch(base, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(req.body || {}),
  });
  const j = await r.json();
  res.status(200).json(j);
}
