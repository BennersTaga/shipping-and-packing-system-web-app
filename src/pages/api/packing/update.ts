// src/pages/api/packing/update.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { generateRequestId } from "../../../utils/requestId";

const updateSchema = z.object({
  action: z.enum(["pack", "ship", "move", "restore"]),
  rowIndex: z.number(),
  packingData: z.record(z.any()).optional(),
  payload: z.record(z.any()).optional(),
  log: z.record(z.any()).optional(),
  requestId: z.string().optional(),
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ success: false, error: "Method Not Allowed" });
    }

    const parsed = updateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.message });
    }

    const url = process.env.GAS_UPDATE_URL;
    const apiKey = process.env.GAS_API_KEY;

    const reqId = (req.headers["x-request-id"] as string) || parsed.data.requestId || generateRequestId();
    res.setHeader("X-Request-Id", reqId);

    if (!url) {
      return res.status(200).json({ success: true, mock: true });
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Request-Id": reqId,
    };
    if (apiKey) headers["X-Api-Key"] = apiKey;

    const body = JSON.stringify({ ...parsed.data, requestId: reqId });

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, { method: "POST", headers, body });
        const ct = r.headers.get("content-type") || "";
        const resp = ct.includes("application/json") ? await r.json() : await r.text();
        if (!r.ok) {
          const err = typeof resp === "string" ? resp : resp?.error || `GAS error ${r.status}`;
          if (r.status >= 500 && attempt < 2) {
            await sleep(2 ** attempt * 200);
            continue;
          }
          return res.status(r.status).json({ success: false, error: err });
        }
        return res.status(200).json(typeof resp === "string" ? { success: true, raw: resp } : resp);
      } catch (e: any) {
        if (attempt < 2) {
          await sleep(2 ** attempt * 200);
          continue;
        }
        return res.status(500).json({ success: false, error: e?.message || "proxy error" });
      }
    }
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || "proxy error" });
  }
}
