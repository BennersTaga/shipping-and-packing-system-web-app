import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "pack" | "ship" | "move" | "restore";

type Body = {
  action?: Action;
  action2?: Action;
  rowIndex?: number;
  packingData?: any;
  payload?: any;
  log?: any;
  requestId?: string;
  requestedId?: string;
};

function ridFrom(req: Request, body: Body): string {
  return (
    req.headers.get("x-request-id") ||
    body.requestId ||
    body.requestedId ||
    (globalThis as any)?.crypto?.randomUUID?.() ||
    Math.random().toString(36).slice(2)
  );
}

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Request-Id"
  );
  return res;
}

export async function GET() {
  return withCors(
    NextResponse.json({ ok: true, route: "/api/packing/update" })
  );
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(req: Request) {
  const endpoint = process.env.GAS_WEBHOOK_URL || process.env.GAS_UPDATE_URL;
  if (!endpoint) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "Missing GAS_UPDATE_URL" },
        { status: 500 }
      )
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return withCors(
      NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 })
    );
  }

  const action = (body.action ?? body.action2) as Action | undefined;
  const rowIndex = body.rowIndex;
  if (!action || typeof rowIndex !== "number") {
    return withCors(
      NextResponse.json(
        { ok: false, error: "Missing action or rowIndex" },
        { status: 400 }
      )
    );
  }

  const requestId = ridFrom(req, body);
  const payload = body.packingData ?? body.payload ?? null;

  const out = {
    action,
    rowIndex,
    requestId,
    payload,
    log: body.log ?? null,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Request-Id": requestId,
  };
  if (process.env.GAS_API_KEY)
    headers["X-Api-Key"] = String(process.env.GAS_API_KEY);
  if (process.env.GAS_WEBHOOK_TOKEN)
    headers["X-Webhook-Token"] = String(process.env.GAS_WEBHOOK_TOKEN);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(out),
    });

    const text = await res.text().catch(() => "");
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text || null;
    }

    const upstream = { status: res.status, body: data };

    if (!res.ok) {
      return withCors(
        NextResponse.json({ ok: false, requestId, upstream }, { status: 502 })
      );
    }

    return withCors(
      NextResponse.json({ ok: true, requestId, upstream }, { status: 200 })
    );
  } catch (e: any) {
    return withCors(
      NextResponse.json(
        { ok: false, error: String(e) },
        { status: 502 }
      )
    );
  }
}

