import { authorized, json } from '../lib/common';
import { pluggy } from '../lib/pluggy';

export async function POST(req: Request) {
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  const { accessToken } = await pluggy('/connect_token', {
    method: 'POST',
    body: JSON.stringify(body?.itemId ? { itemId: body.itemId } : {}),
  });
  return json({ accessToken });
}
