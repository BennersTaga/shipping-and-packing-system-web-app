import type { NextApiRequest, NextApiResponse } from 'next';
import { defaultEnv, pickGasBaseUrl, EnvKey } from '../../../lib/env';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const q = req.query.env || (req.body && (req.body as any).env);
  const env: EnvKey = q === 'prod' ? 'prod' : q === 'test' ? 'test' : defaultEnv();
  const base = pickGasBaseUrl(env);
  if (!base) {
    return res.status(500).json({ error: 'Vercel 変数未設定', env });
  }

  const body = { ...(req.body || {}), env };
  try {
    const r = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const text = await r.text();
    try {
      const json = JSON.parse(text);
      if (typeof json === 'object' && json) {
        json.meta = { ...(json.meta || {}), gasUrl: base };
      }
      return res.status(r.status).json(json);
    } catch {
      return res.status(r.status).send(text);
    }
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'fetch error' });
  }
}
