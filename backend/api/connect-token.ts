import { authorized, json } from '../lib/common';
import { pluggy } from '../lib/pluggy';

export async function POST(req: Request) {
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  try {
    const { accessToken } = await pluggy('/connect_token', {
      method: 'POST',
      body: JSON.stringify(body?.itemId ? { itemId: body.itemId } : {}),
    });
    return json({ accessToken });
  } catch (e: any) {
    console.error(e);
    const down = /\s5\d\d:/.test(e.message);
    return json({ error: down ? 'A Pluggy está instável agora. Tente de novo em alguns minutos.' : e.message }, 502);
  }
}
