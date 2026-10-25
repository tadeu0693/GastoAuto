import { authorized, json } from '../lib/common';
import { pluggy } from '../lib/pluggy';

// Retorna transações normalizadas de todos os items (contas e cartões) desde `from`.
export async function POST(req: Request) {
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);
  const { itemIds = [], from } = await req.json();
  const out: any[] = [];
  const errors: string[] = [];

  for (const itemId of itemIds as string[]) {
    try {
      // dispara atualização (assíncrona) para a próxima sincronização vir mais fresca
      pluggy(`/items/${itemId}`, { method: 'PATCH', body: '{}' }).catch(() => {});
      const { results: accounts } = await pluggy(`/accounts?itemId=${itemId}`);
      for (const acc of accounts) {
        let page = 1, totalPages = 1;
        do {
          const q = new URLSearchParams({ accountId: acc.id, from, pageSize: '500', page: String(page) });
          const d = await pluggy(`/transactions?${q}`);
          totalPages = d.totalPages ?? 1;
          for (const t of d.results ?? []) {
            const isCard = acc.type === 'CREDIT';
            // Conta: valor negativo = saída. Cartão: valor positivo = compra.
            const out_ = isCard ? t.amount > 0 : t.amount < 0;
            out.push({
              externalId: t.id,
              date: t.date,
              amount: Math.abs(t.amount),
              type: out_ ? 'expense' : 'income',
              description: t.description,
              merchant: t.merchant?.businessName || t.merchant?.name || null,
              hint: t.category || null,
              account: `${acc.name}${isCard ? ' (cartão)' : ''}`,
            });
          }
          page++;
        } while (page <= totalPages);
      }
    } catch (e: any) {
      errors.push(`${itemId}: ${e.message}`);
    }
  }
  return json({ transactions: out, errors });
}
