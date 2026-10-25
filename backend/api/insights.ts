import { authorized, json } from '../lib/common';
import { geminiJSON } from '../lib/gemini';

// Análise mensal: compara categorias com meses anteriores e sugere cortes com valor estimado
export async function POST(req: Request) {
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);
  const data = await req.json();
  const prompt = `Você é um consultor financeiro pessoal brasileiro, direto e prático.
Analise os gastos abaixo (valores em R$, por mês "AAAA-MM"; o mês atual é "${data.mes}"${data.diaAtual ? `, estamos no dia ${data.diaAtual} de ${data.diasNoMes} — projete o mês inteiro ao comparar` : ''}).
Responda SOMENTE em JSON:
{"resumo": string (2-3 frases sobre o mês vs. a média dos anteriores),
 "alertas": string[] (até 3: categorias bem acima do normal, assinaturas que subiram, orçamento/meta em risco),
 "sugestoes": [{"titulo": string, "economia": number (R$ por mês, realista), "detalhe": string (ação concreta, citando estabelecimentos quando fizer sentido)}] (3 a 5, ordenadas pela maior economia)}
Não sugira cortar Moradia, Saúde ou Educação essenciais sem motivo claro. Use números reais dos dados.
Dados: ${JSON.stringify(data)}`;
  try {
    const r = await geminiJSON<any>(prompt);
    return json({
      resumo: String(r.resumo ?? ''),
      alertas: Array.isArray(r.alertas) ? r.alertas.slice(0, 3).map(String) : [],
      sugestoes: Array.isArray(r.sugestoes) ? r.sugestoes.slice(0, 5).map((x: any) => ({
        titulo: String(x.titulo ?? ''), economia: Math.max(0, Number(x.economia) || 0), detalhe: String(x.detalhe ?? ''),
      })) : [],
    });
  } catch (e: any) {
    return json({ error: e.message }, 502);
  }
}
