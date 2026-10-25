import { authorized, json } from '../lib/common';
import { pluggy } from '../lib/pluggy';

// Retorna transações normalizadas de todos os items (contas e cartões) desde `from`,
// mais o status de cada item (o primeiro sync do Open Finance pode levar alguns minutos).
export async function POST(req: Request) {
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);
  const { itemIds = [], from } = await req.json();
  const out: any[] = [];
  const errors: string[] = [];
  const items: any[] = [];

  for (const itemId of itemIds as string[]) {
    const info: any = { id: itemId, status: null, execution: null, accounts: 0, transactions: 0, lastUpdatedAt: null };
    try {
      const item = await pluggy(`/items/${itemId}`);
      info.status = item.status;
      info.execution = item.executionStatus;
      info.lastUpdatedAt = item.lastUpdatedAt;
      info.error = item.error?.message ?? null;
      const { results: accounts = [] } = await pluggy(`/accounts?itemId=${itemId}`);
      info.accounts = accounts.length;
      info.accountNames = accounts.map((a: any) => `${a.name} (${a.type})`);
      for (const acc of accounts) {
        let page = 1, totalPages = 1;
        do {
          const q = new URLSearchParams({ accountId: acc.id, from, pageSize: '500', page: String(page) });
          const d = await pluggy(`/transactions?${q}`);
          totalPages = d.totalPages ?? 1;
          for (const t of d.results ?? []) {
            const isCard = acc.type === 'CREDIT';
            // Conta: valor negativo = saída. Cartão: valor positivo = compra.
            const isOut = isCard ? t.amount > 0 : t.amount < 0;
            out.push({
              externalId: t.id,
              date: t.date,
              amount: Math.abs(t.amount),
              type: isOut ? 'expense' : 'income',
              description: t.description,
              merchant: t.merchant?.businessName || t.merchant?.name || null,
              hint: t.category || null,
              account: `${acc.name}${isCard ? ' (cartão)' : ''}`,
            });
            info.transactions++;
          }
          page++;
        } while (page <= totalPages);
      }
    } catch (e: any) {
      errors.push(`${itemId}: ${e.message}`);
    }
    items.push(info);
  }
  console.log('transactions', JSON.stringify({ from, items, errors }));
  return json({ transactions: out, errors, items });
}
