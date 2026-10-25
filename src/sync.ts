import { NotifCapture } from '../modules/notif-capture/src/NotifCaptureModule';
import { api } from './api';
import { db, getMeta, insertTx, items, ruleFor, setMeta, Tx } from './db';

let running = false;

const iso = (d: Date) => d.toISOString();
const day = (d: Date) => d.toISOString().slice(0, 10);

// 1) Notificações dos bancos -> Gemini extrai valor/estabelecimento/categoria
export async function processNotifications() {
  const pending = NotifCapture.pending();
  if (!pending.length) return 0;
  const { results } = await api<{ results: any[] }>('classify', { mode: 'notification', items: pending });
  const byId = new Map(pending.map(p => [p.id, p]));
  const d = await db();
  let n = 0;
  for (const r of results) {
    const p = byId.get(r.id);
    if (!p || !r.isTransaction || !(r.amount > 0)) continue;
    const date = new Date(p.ts);
    // mesma compra notificada por 2 apps (ex.: banco + Google Wallet)
    const dup = await d.getFirstAsync(
      `SELECT id FROM tx WHERE type=? AND abs(amount-?)<0.01 AND abs(julianday(date)-julianday(?))*1440<10`,
      r.type, r.amount, iso(date),
    );
    if (dup) continue;
    await insertTx({
      id: `n:${p.id}`, source: 'notif', external_id: null, date: iso(date),
      amount: r.amount, type: r.type, description: `${p.title} — ${p.text}`.slice(0, 300),
      merchant: r.merchant ?? null, category: (await ruleFor(r.merchant)) ?? r.category,
      account: p.app,
    });
    n++;
  }
  NotifCapture.removePending(pending.map(p => p.id));
  return n;
}

// 2) Open Finance (MeuPluggy) -> concilia com o que veio por notificação
export async function syncOpenFinance() {
  const its = await items();
  if (!its.length) return 0;
  const last = await getMeta('lastSync');
  const from = last ? new Date(new Date(last).getTime() - 7 * 864e5) : new Date(Date.now() - 90 * 864e5);
  const { transactions, errors } = await api<{ transactions: any[]; errors: string[] }>('transactions', {
    itemIds: its.map(i => i.id), from: day(from),
  });
  if (errors?.length) console.warn(errors);
  const d = await db();
  const toClassify: any[] = [];
  for (const t of transactions) {
    if (await d.getFirstAsync('SELECT 1 FROM tx WHERE external_id=?', t.externalId)) continue;
    // já capturada por notificação? vincula em vez de duplicar
    const match = await d.getFirstAsync<{ id: string }>(
      `SELECT id FROM tx WHERE source='notif' AND external_id IS NULL AND type=?
       AND abs(amount-?)<0.01 AND abs(julianday(substr(date,1,10))-julianday(?))<=3 LIMIT 1`,
      t.type, t.amount, t.date.slice(0, 10),
    );
    if (match) {
      await d.runAsync('UPDATE tx SET external_id=?, account=? WHERE id=?', t.externalId, t.account, match.id);
      continue;
    }
    toClassify.push(t);
  }
  if (toClassify.length) {
    const { results } = await api<{ results: any[] }>('classify', {
      mode: 'transaction',
      items: toClassify.map(t => ({ id: t.externalId, text: t.description, type: t.type, hint: t.hint })),
    });
    const cls = new Map(results.map(r => [r.id, r]));
    for (const t of toClassify) {
      const c = cls.get(t.externalId) || {};
      const merchant = c.merchant ?? t.merchant ?? null;
      const tx: Tx = {
        id: `p:${t.externalId}`, source: 'pluggy', external_id: t.externalId, date: t.date,
        amount: t.amount, type: t.type, description: t.description, merchant,
        category: (await ruleFor(merchant ?? t.description)) ?? c.category ?? 'Outros', account: t.account,
      };
      await insertTx(tx);
    }
  }
  await setMeta('lastSync', iso(new Date()));
  return toClassify.length;
}

export async function syncAll() {
  if (running) return { notif: 0, of: 0 };
  running = true;
  try {
    const notif = await processNotifications();
    const of = await syncOpenFinance();
    return { notif, of };
  } finally {
    running = false;
  }
}
