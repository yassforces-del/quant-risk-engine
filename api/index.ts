import { app } from '../src/app';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = `https://${req.headers.host}${req.url}`;
  const webReq = new Request(url, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
  });

  const response = await app.fetch(webReq);
  const body = await response.text();

  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.send(body);
}