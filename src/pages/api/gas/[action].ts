import type { NextApiRequest, NextApiResponse } from 'next';

const GAS = process.env.GAS_WEBAPP_URL!; // 例: https://script.google.com/macros/s/XXXX/exec

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { action } = req.query as { action: string };

  if (req.method === 'GET') {
    const src = new URL(req.url!, 'http://localhost');
    const dst = new URL(GAS);
    dst.searchParams.set('action', action);
    src.searchParams.forEach((v, k) => k !== 'action' && dst.searchParams.append(k, v));

    const r = await fetch(dst.toString(), { cache: 'no-store' });
    const text = await r.text();
    res.status(r.status).setHeader('content-type', 'application/json');
    try { res.send(JSON.parse(text)); } catch { res.send(text); }
    return;
  }

  if (req.method === 'POST') {
    const r = await fetch(GAS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(req.body || {}), action }),
      cache: 'no-store',
    });
    const text = await r.text();
    res.status(r.status).setHeader('content-type', 'application/json').send(text);
    return;
  }

  res.status(405).end();
}

