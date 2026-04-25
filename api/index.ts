import { app } from '../src/app';

export default async function handler(req: Request) {
  return app.fetch(req);
}