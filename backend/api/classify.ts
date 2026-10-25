import { authorized, json, CATEGORIES } from '../lib/common';
import { geminiJSON } from '../lib/gemini';

const CHUNK = 60;
const cats = CATEGORIES.join(', ');

function notifPrompt(items: any[]) {
  return `Você recebe notificações de apps de banco brasileiros. Para cada uma, extraia a transação.
Responda SOMENTE um array JSON com um objeto por item, na mesma ordem:
{"id": string, "isTransaction": boolean, "type": "expense"|"income", "amount": number (reais, positivo), "merchant": string|null, "category": string}
- isTransaction=false para propaganda, código de segurança, fatura fechada/vencendo, limite, saldo, compra NEGADA/recusada, estorno pendente.
- Compra aprovada, Pix enviado, pagamento, débito, saque = expense. Pix/TED recebido, depósito, salário, estorno efetivado = income.
- Pagamento de fatura do cartão => category "Pagamento de fatura". Transferência entre contas próprias => "Transferência".
- category deve ser uma de: ${cats}.
Itens:
${JSON.stringify(items.map(i => ({ id: i.id, app: i.app, title: i.title, text: i.text })))}`;
}

function txPrompt(items: any[]) {
  return `Classifique transações bancárias brasileiras. Responda SOMENTE um array JSON na mesma ordem:
{"id": string, "category": string, "merchant": string|null}
- category deve ser uma de: ${cats}.
- "hint" é a categoria sugerida pelo banco (pode ajudar). Pagamento de fatura de cartão => "Pagamento de fatura". Transferências entre contas próprias / aplicações => "Transferência" ou "Investimentos".
- merchant: nome limpo do estabelecimento/pessoa (ex: "PAG*IFOOD 123" -> "iFood"), ou null.
Itens:
${JSON.stringify(items.map(i => ({ id: i.id, text: i.text, type: i.type, hint: i.hint })))}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);
  const { mode, items = [] } = await req.json();
  const chunks: any[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) chunks.push(items.slice(i, i + CHUNK));
  try {
    const parts = await Promise.all(
      chunks.map(c => geminiJSON<any[]>(mode === 'notification' ? notifPrompt(c) : txPrompt(c))),
    );
    const results = parts.flat().map(r => ({
      ...r,
      category: (CATEGORIES as readonly string[]).includes(r.category) ? r.category : 'Outros',
    }));
    return json({ results });
  } catch (e: any) {
    return json({ error: e.message, quota: e?.name === 'QuotaError' || /Limite gratuito/.test(e.message) }, e?.message?.includes('Limite gratuito') ? 429 : 502);
  }
}
