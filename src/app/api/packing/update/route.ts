import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "pack" | "ship" | "move" | "restore";

type Body = {
  action?: Action;          // フロントは action を送る
  rowIndex?: number;
  packingData?: any;        // { location, quantity } など（旧名）
  payload?: any;            // { from, to, quantity } など（新名）
  log?: any;                // GAS に残すログ（任意）
  requestId?: string;       // フロントは requestId を送る
  // Codexが過去に出した誤名の互換用:
  // action2?: Action;
  // requestedId?: string;
};

function ridFrom(req: Request, body?: Body) {
  return (
    req.headers.get("x-request-id") ||
    body?.requestId ||
    // 互換（Codex誤名）
    // @ts-ignore
    body?.requestedId ||
    (globalThis as any)?.crypto?.randomUUID?.() ||
    Math.random().toString(36).slice(2)
  );
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // 名称互換（誤名 action2/requestedId を拾う）
  // @ts-ignore
  const compatAction = (body.action ?? body.action2) as Action | undefined;
  // @ts-ignore
  body.requestId = body.requestId ?? body.requestedId;

  if (!compatAction || typeof body.rowIndex !== "number") {
    return NextResponse.json({ ok: false, error: "Missing action or rowIndex" }, { status: 400 });
  }

  const requestId = ridFrom(req, body);

  // 送信先設定
  const updateUrl = process.env.GAS_UPDATE_URL;       // 直接エンドポイント
  const webhookUrl = process.env.GAS_WEBHOOK_URL;     // Webhook 経由
  const webhookToken = process.env.GAS_WEBHOOK_TOKEN; // 任意
  const apiKey = process.env.GAS_API_KEY;             // 任意

  if (!updateUrl && !webhookUrl) {
    return NextResponse.json(
      { ok: false, error: "GAS endpoint is not configured" },
      { status: 500 },
    );
  }

  // フロントの2系統（payload / packingData）をどちらでも受け取れるように統一
  const mergedPayload = body.payload ?? body.packingData ?? {};

  const forward = {
    action: compatAction,
    rowIndex: body.rowIndex,
    payload: mergedPayload,
    log: body.log ?? null,
    requestId,
  };

  const url = webhookUrl || updateUrl!;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["X-API-Key"] = String(apiKey);
  if (webhookToken) headers["X-Webhook-Token"] = String(webhookToken);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(forward),
    });

    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, upstreamStatus: res.status, upstream: json },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, requestId, upstream: json }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
