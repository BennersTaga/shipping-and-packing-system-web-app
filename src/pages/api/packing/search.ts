import type { NextApiRequest, NextApiResponse } from 'next';

function originFromReq(req: NextApiRequest) {
  const proto =
    (req.headers['x-forwarded-proto'] as string) ||
    'https';
  const host =
    (req.headers['x-forwarded-host'] as string) ||
    (req.headers.host as string) ||
    'localhost:3000';
  return `${proto}://${host}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  // /api/gas/search を絶対URLにして呼び出す
  const qs = new URLSearchParams(req.query as any).toString();
  const url = `${originFromReq(req)}/api/gas/search${qs ? `?${qs}` : ''}`;

  const r = await fetch(url, { cache: 'no-store' });
  const text = await r.text();

  res.status(r.status).setHeader('content-type', 'application/json');
  try {
    res.send(JSON.parse(text));
  } catch {
    res.send(text);
  }
}

