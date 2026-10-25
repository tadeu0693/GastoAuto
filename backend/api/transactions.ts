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
      info.balances = accounts.map((a: any) => ({
        id: a.id, name: (a.marketingName || a.name || '').trim(), type: a.type, subtype: a.subtype,
        balance: a.balance ?? null,
        creditLimit: a.creditData?.creditLimit ?? null,
        available: a.creditData?.availableCreditLimit ?? null,
        dueDate: a.creditData?.balanceDueDate ?? null,
      }));
      for (const acc of accounts) {
        // API v2 (cursor): /v2/transactions?accountId=&dateFrom= ; segue `next` até acabar
        let path: string | null = `/v2/transactions?${new URLSearchParams({ accountId: acc.id, dateFrom: from })}`;
        let guard = 0;
        while (path && guard++ < 50) {
          const d: any = await pluggy(path);
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
          if (!d.next) { path = null; break; }
          const n = new URL(d.next, 'https://api.pluggy.ai');
          if (!n.pathname.includes('transactions')) {
            n.pathname = '/v2/transactions';
            if (!n.searchParams.get('accountId')) n.searchParams.set('accountId', acc.id);
            if (!n.searchParams.get('dateFrom')) n.searchParams.set('dateFrom', from);
          }
          path = n.pathname + n.search;
        }
      }
    } catch (e: any) {
      errors.push(`${itemId}: ${e.message}`);
    }
    items.push(info);
  }
  console.log('transactions', JSON.stringify({ from, items, errors }));
  return json({ transactions: out, errors, items });
}
