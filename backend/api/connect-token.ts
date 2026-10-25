import { authorized, json } from '../lib/common';
import { pluggy } from '../lib/pluggy';

let meuPluggyId: number | null = null;

// Conector "MeuPluggy": único permitido para conta trial/gratuita (dados do próprio CPF)
export async function meuPluggyConnector(): Promise<number | null> {
  if (meuPluggyId) return meuPluggyId;
  const { results = [] } = await pluggy(`/connectors?name=${encodeURIComponent('MeuPluggy')}`);
  const c = results.find((x: any) => /meu\s*pluggy/i.test(x.name)) ?? results[0];
  meuPluggyId = c?.id ?? null;
  return meuPluggyId;
}

export async function POST(req: Request) {
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  try {
    const [{ accessToken }, connectorId] = await Promise.all([
      pluggy('/connect_token', {
        method: 'POST',
        body: JSON.stringify(body?.itemId ? { itemId: body.itemId } : {}),
      }),
      meuPluggyConnector().catch(() => null),
    ]);
    return json({ accessToken, connectorId });
  } catch (e: any) {
    console.error(e);
    const down = /\s5\d\d:/.test(e.message);
    return json({ error: down ? 'A Pluggy está instável agora. Tente de novo em alguns minutos.' : e.message }, 502);
  }
}
