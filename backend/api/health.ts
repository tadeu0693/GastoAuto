import { authorized, json } from '../lib/common';
import { apiKey } from '../lib/pluggy';
import { POST as classify } from './classify';
import { flashModels } from '../lib/gemini';

export async function GET(req: Request) {
  const u = new URL(req.url);
  const t = process.env.APP_TOKEN;
  if (!authorized(req) && u.searchParams.get('t') !== t) return json({ ok: true });
  const out: Record<string, unknown> = {};
  try { await apiKey(); out.pluggy = 'ok'; } catch (e: any) { out.pluggy = e.message; }
  const sample = [
    { id: 'a', app: 'com.nu.production', title: 'Compra no crédito aprovada', text: 'Compra de R$ 47,90 APROVADA em IFOOD *RESTAURANTE para o cartão com final 1234.' },
    { id: 'b', app: 'br.com.intermedium', title: 'Pix recebido', text: 'Você recebeu um Pix de R$ 1.250,00 de JOAO DA SILVA.' },
    { id: 'c', app: 'com.itau', title: 'Itaú', text: 'Sua fatura de R$ 2.310,55 vence dia 10.' },
  ];
  const r = await classify(new Request(req.url, {
    method: 'POST',
    headers: { 'x-app-token': t!, 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'notification', items: sample }),
  }));
  out.gemini = await r.json();
  out.models = await flashModels().catch(e => String(e));
  return json(out);
}
