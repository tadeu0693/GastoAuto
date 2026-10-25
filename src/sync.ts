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

// Categoria inicial a partir da categoria da Pluggy (antes do Gemini)
const HINTS: [RegExp, string][] = [
  [/credit card payment|pagamento de fatura/i, 'Pagamento de fatura'],
  [/transfer|pix|ted|doc/i, 'Transferência'],
  [/invest|savings|aplica/i, 'Investimentos'],
  [/salary|income|wage|renda|sal[aá]rio/i, 'Renda'],
  [/groceries|supermarket|mercado/i, 'Mercado'],
  [/food|restaurant|eating|delivery|aliment/i, 'Alimentação'],
  [/gas station|fuel|combust/i, 'Combustível'],
  [/transport|taxi|ride|uber|parking|toll|ped[aá]gio/i, 'Transporte'],
  [/rent|housing|aluguel|condom/i, 'Moradia'],
  [/utilities|electricity|water|internet|phone|telecom|bills/i, 'Contas'],
  [/health|pharmacy|drug|medical|sa[uú]de|farm/i, 'Saúde'],
  [/education|school|course|educa/i, 'Educação'],
  [/subscription|streaming|digital services|assinatura/i, 'Assinaturas'],
  [/travel|airline|hotel|accommodation|viagem/i, 'Viagem'],
  [/entertainment|leisure|lazer|games/i, 'Lazer'],
  [/shopping|clothing|electronics|compras/i, 'Compras'],
];
function fromHint(hint: string | null, type: string) {
  if (hint) for (const [re, c] of HINTS) if (re.test(hint)) return c;
  return type === 'income' ? 'Renda' : 'Outros';
}

// Refina categorias com o Gemini, 40 por vez (evita estourar o tempo do servidor)
export async function classifyPending(maxBatches = 8) {
  const d = await db();
  for (let b = 0; b < maxBatches; b++) {
    const rows = await d.getAllAsync<{ id: string; description: string; type: string; category: string }>(
      `SELECT tx.id, tx.description, tx.type, tx.category FROM pending_class p JOIN tx ON tx.id = p.id LIMIT 40`);
    if (!rows.length) return;
    const { results } = await api<{ results: any[] }>('classify', {
      mode: 'transaction',
      items: rows.map(r => ({ id: r.id, text: r.description, type: r.type, hint: r.category })),
    });
    for (const r of results ?? []) {
      if (!r?.id) continue;
      if (r.category) await d.runAsync('UPDATE tx SET category=?, merchant=COALESCE(?, merchant) WHERE id=?', r.category, r.merchant ?? null, r.id);
    }
    for (const r of rows) await d.runAsync('DELETE FROM pending_class WHERE id=?', r.id);
  }
}

// 2) Open Finance (MeuPluggy) -> concilia com o que veio por notificação
export type ItemStatus = { id: string; status: string | null; execution: string | null; accounts: number; transactions: number; error?: string | null; lastUpdatedAt?: string | null };

export async function syncOpenFinance(): Promise<{ count: number; errors: string[]; items: ItemStatus[] }> {
  const its = await items();
  if (!its.length) return { count: 0, errors: [], items: [] };
  // período por item: 90 dias até o item trazer dados pela primeira vez; depois, últimos 7 dias
  const transactions: any[] = [];
  const errors: string[] = [];
  const statuses: ItemStatus[] = [];
  for (const it of its) {
    const last = await getMeta(`lastSync2:${it.id}`);
    const from = last ? new Date(new Date(last).getTime() - 7 * 864e5) : new Date(Date.now() - 90 * 864e5);
    const r = await api<{ transactions: any[]; errors: string[]; items: ItemStatus[] }>('transactions', {
      itemIds: [it.id], from: day(from),
    });
    transactions.push(...r.transactions);
    errors.push(...(r.errors ?? []));
    for (const st of r.items ?? []) {
      statuses.push(st);
      await setMeta(`status:${st.id}`, JSON.stringify(st));
    }
  }
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
  // grava já com a categoria sugerida pelo banco; o Gemini refina depois em lotes
  for (const t of toClassify) {
    const id = `p:${t.externalId}`;
    await insertTx({
      id, source: 'pluggy', external_id: t.externalId, date: t.date,
      amount: t.amount, type: t.type, description: t.description, merchant: t.merchant ?? null,
      category: (await ruleFor(t.merchant ?? t.description)) ?? fromHint(t.hint, t.type), account: t.account,
    });
    if (!(await ruleFor(t.merchant ?? t.description))) await d.runAsync('INSERT OR IGNORE INTO pending_class(id) VALUES(?)', id);
  }
  for (const st of statuses) if (st.transactions > 0) await setMeta(`lastSync2:${st.id}`, iso(new Date()));
  await classifyPending().catch(() => {});
  return { count: toClassify.length, errors, items: statuses };
}

export async function syncAll() {
  if (running) return { notif: 0, of: 0, errors: [] as string[], items: [] as ItemStatus[] };
  running = true;
  try {
    const notif = await processNotifications();
    const r = await syncOpenFinance();
    return { notif, of: r.count, errors: r.errors, items: r.items };
  } finally {
    running = false;
  }
}
