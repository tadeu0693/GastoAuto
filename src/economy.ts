import * as Notifications from 'expo-notifications';
import { db, getBalances, getMeta, merchantKey, NEUTRAL, setMeta, Tx } from './db';

export const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

// ---------- Orçamentos ----------
export async function ensureTables() {
  await (await db()).execAsync(`CREATE TABLE IF NOT EXISTS budgets (category TEXT PRIMARY KEY, amount REAL NOT NULL);`);
}
export async function getBudgets(): Promise<Record<string, number>> {
  await ensureTables();
  const rows = await (await db()).getAllAsync<{ category: string; amount: number }>('SELECT * FROM budgets');
  return Object.fromEntries(rows.map(r => [r.category, r.amount]));
}
export async function setBudget(category: string, amount: number | null) {
  await ensureTables();
  const d = await db();
  if (!amount || amount <= 0) await d.runAsync('DELETE FROM budgets WHERE category=?', category);
  else await d.runAsync('INSERT OR REPLACE INTO budgets(category,amount) VALUES(?,?)', category, amount);
}

// Gastos por categoria de um mês (sem transferências/fatura/investimentos)
export async function spentByCategory(month: string): Promise<Record<string, number>> {
  const rows = await (await db()).getAllAsync<{ category: string; total: number }>(
    `SELECT category, SUM(amount) total FROM tx WHERE type='expense' AND substr(date,1,7)=? GROUP BY category`, month);
  return Object.fromEntries(rows.filter(r => !NEUTRAL.has(r.category)).map(r => [r.category, r.total]));
}

export async function incomeOf(month: string): Promise<number> {
  const rows = await (await db()).getAllAsync<{ category: string; total: number }>(
    `SELECT category, SUM(amount) total FROM tx WHERE type='income' AND substr(date,1,7)=? GROUP BY category`, month);
  return rows.filter(r => !NEUTRAL.has(r.category)).reduce((a, r) => a + r.total, 0);
}

// Média dos 3 meses anteriores (para sugerir limites e estimar renda)
export async function averages(ref: Date) {
  const cats: Record<string, number> = {};
  let income = 0, n = 0;
  for (let i = 1; i <= 3; i++) {
    const m = ym(addMonths(ref, -i));
    const s = await spentByCategory(m);
    const inc = await incomeOf(m);
    if (!Object.keys(s).length && !inc) continue;
    n++;
    income += inc;
    for (const [k, v] of Object.entries(s)) cats[k] = (cats[k] || 0) + v;
  }
  if (!n) return { cats: {} as Record<string, number>, income: 0, months: 0 };
  for (const k of Object.keys(cats)) cats[k] /= n;
  return { cats, income: income / n, months: n };
}

// ---------- Meta de economia ----------
export async function getGoal() { return Number((await getMeta('savingsGoal')) || 0); }
export async function setGoal(v: number) { await setMeta('savingsGoal', String(Math.max(0, v || 0))); }

export async function goalStatus(ref = new Date()) {
  const month = ym(ref);
  const goal = await getGoal();
  const spent = Object.values(await spentByCategory(month)).reduce((a, b) => a + b, 0);
  const incomeNow = await incomeOf(month);
  const avg = await averages(ref);
  const income = Math.max(incomeNow, avg.income); // renda esperada do mês
  const today = new Date();
  const isCurrent = month === ym(today);
  const lastDay = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
  const daysLeft = isCurrent ? lastDay - today.getDate() + 1 : 0;
  const canSpend = income - goal - spent;
  return { goal, spent, income, incomeEstimated: incomeNow < avg.income, canSpend, daysLeft, perDay: daysLeft > 0 ? canSpend / daysLeft : 0 };
}

// ---------- Sair do negativo ----------
// Categorias onde dá para cortar sem mexer no essencial (Moradia, Contas, Saúde, Educação)
const CUTTABLE = ['Lazer', 'Compras', 'Alimentação', 'Assinaturas', 'Viagem', 'Outros', 'Transporte', 'Combustível', 'Mercado'];
// fração máxima sugerida de corte por categoria
const MAX_CUT: Record<string, number> = { Lazer: 0.6, Compras: 0.6, Viagem: 0.8, Assinaturas: 0.5, Alimentação: 0.4, Outros: 0.4, Transporte: 0.25, Combustível: 0.2, Mercado: 0.15 };

export type DebtPlan = {
  divida: number;            // quanto está negativo nas contas
  taxa: number;              // % ao mês (cheque especial)
  jurosMes: number;          // custo estimado de ficar no negativo por 1 mês
  meses: number;             // prazo escolhido para sair
  parcela: number;           // quanto precisa sobrar por mês para quitar no prazo
  aEntrar: number;           // renda que ainda deve entrar este mês
  faturasMes: number;        // faturas de cartão que vencem até o fim do mês
  podeGastar: number;        // quanto ainda pode gastar no mês mantendo o plano (pode ser negativo)
  porDia: number;
  diasRestantes: number;
  sobraMedia: number;        // renda média − gastos médios (ritmo atual)
  mesesNoRitmoAtual: number | null; // null = no ritmo atual não sai (sobra ≤ juros)
  corteNecessario: number;   // quanto cortar por mês para caber a parcela
  cortes: { categoria: string; media: number; corte: number }[];
  recorrentes: number;       // total de assinaturas/recorrentes por mês
};

export async function getDebtMonths() { return Number(await getMeta('debtMonths')) || 3; }
export async function setDebtMonths(n: number) { await setMeta('debtMonths', String(n)); }
export async function getDebtRate() { return Number(await getMeta('debtRate')) || 8; }
export async function setDebtRate(v: number) { await setMeta('debtRate', String(Math.min(20, Math.max(0, v || 0)))); }

// Saldo somado das contas (sem cartões). null = nenhuma conta conectada.
export async function bankBalance(): Promise<number | null> {
  const { list } = await getBalances();
  const bank = list.filter(b => b.type !== 'CREDIT' && b.balance != null);
  return bank.length ? bank.reduce((a, b) => a + (b.balance ?? 0), 0) : null;
}

// Plano para sair do negativo. Só existe quando o saldo das contas está abaixo de zero.
export async function debtPlan(ref = new Date()): Promise<DebtPlan | null> {
  const saldo = await bankBalance();
  if (saldo == null || saldo >= -0.5) return null;
  const divida = -saldo;
  const taxa = await getDebtRate();
  const meses = await getDebtMonths();
  const i = taxa / 100;
  const parcela = i > 0 ? (divida * i) / (1 - Math.pow(1 + i, -meses)) : divida / meses;

  const today = new Date();
  const month = ym(today);
  const avg = await averages(today);
  const incomeNow = await incomeOf(month);
  const spentNow = Object.values(await spentByCategory(month)).reduce((a, b) => a + b, 0);
  const aEntrar = Math.max(0, avg.income - incomeNow);

  // faturas que vencem de hoje até o fim do mês
  const { list } = await getBalances();
  const fim = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59);
  const faturasMes = list
    .filter(b => b.type === 'CREDIT' && b.dueDate && (b.balance ?? 0) > 0)
    .filter(b => { const d = new Date(b.dueDate!); return d >= new Date(today.toDateString()) && d <= fim; })
    .reduce((a, b) => a + (b.balance ?? 0), 0);

  // Saldo no fim do mês = −dívida − juros + aEntrar − faturas − gastos.
  // Para amortizar a parcela: gastos ≤ aEntrar − faturas − parcela.
  // (gastos no cartão aparecem na fatura do mês seguinte; aqui contamos o que ainda vai sair)
  const podeGastar = aEntrar - faturasMes - parcela;
  const diasRestantes = fim.getDate() - today.getDate() + 1;

  const avgSpent = Object.values(avg.cats).reduce((a, b) => a + b, 0);
  const sobraMedia = avg.income - avgSpent;
  const jurosMes = divida * i;
  let mesesNoRitmoAtual: number | null = null;
  if (sobraMedia > jurosMes) {
    mesesNoRitmoAtual = i > 0
      ? Math.ceil(-Math.log(1 - (divida * i) / sobraMedia) / Math.log(1 + i))
      : Math.ceil(divida / sobraMedia);
  }

  // cortes sugeridos: começa pelas categorias com maior folga até cobrir o necessário
  const corteNecessario = Math.max(0, parcela - Math.max(0, sobraMedia));
  const cortes: DebtPlan['cortes'] = [];
  let falta = corteNecessario;
  const candidatos = CUTTABLE
    .map(c => ({ categoria: c, media: avg.cats[c] || 0, max: (avg.cats[c] || 0) * (MAX_CUT[c] ?? 0.3) }))
    .filter(c => c.max >= 10)
    .sort((a, b) => b.max - a.max);
  for (const c of candidatos) {
    if (falta <= 0) break;
    const corte = Math.min(c.max, falta);
    cortes.push({ categoria: c.categoria, media: c.media, corte: Math.ceil(corte / 10) * 10 });
    falta -= corte;
  }
  const recorrentes = (await findRecurring(today)).reduce((a, r) => a + r.last, 0);

  return {
    divida, taxa, jurosMes, meses, parcela, aEntrar, faturasMes, podeGastar,
    porDia: podeGastar > 0 && diasRestantes > 0 ? podeGastar / diasRestantes : 0,
    diasRestantes, sobraMedia, mesesNoRitmoAtual, corteNecessario, cortes, recorrentes,
  };
}

// ---------- Assinaturas e recorrentes ----------
export type Recurring = { key: string; name: string; last: number; prev: number | null; months: number; category: string; increased: boolean; lastDate: string };

export async function findRecurring(ref = new Date()): Promise<Recurring[]> {
  const from = ym(addMonths(ref, -5));
  const rows = await (await db()).getAllAsync<Tx>(
    `SELECT * FROM tx WHERE type='expense' AND substr(date,1,7)>=? ORDER BY date ASC`, from);
  const groups = new Map<string, Tx[]>();
  for (const t of rows) {
    if (NEUTRAL.has(t.category)) continue;
    const k = merchantKey(t.merchant || t.description?.replace(/\d+\/\d+|parc.*$/i, ''));
    if (!k || k.length < 3) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
  }
  const out: Recurring[] = [];
  for (const [k, list] of groups) {
    // uma cobrança por mês (a maior), em meses diferentes
    const byMonth = new Map<string, Tx>();
    for (const t of list) {
      const m = t.date.slice(0, 7);
      const cur = byMonth.get(m);
      if (!cur || t.amount > cur.amount) byMonth.set(m, t);
    }
    const monthly = [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (monthly.length < 2) continue;
    // valores parecidos (±25% da mediana) = cobrança recorrente
    const vals = monthly.map(t => t.amount).sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)];
    const similar = monthly.filter(t => Math.abs(t.amount - med) <= med * 0.25);
    if (similar.length < 2 || list.length > monthly.length * 3) continue; // compras frequentes ≠ assinatura
    const last = similar[similar.length - 1];
    const prev = similar.length > 1 ? similar[similar.length - 2] : null;
    // só considera ativa se cobrou nos últimos 2 meses
    if (last.date.slice(0, 7) < ym(addMonths(ref, -1))) continue;
    out.push({
      key: k, name: last.merchant || last.description, last: last.amount, prev: prev?.amount ?? null,
      months: similar.length, category: last.category, lastDate: last.date,
      increased: !!prev && last.amount > prev.amount * 1.03,
    });
  }
  return out.sort((a, b) => b.last - a.last);
}

// ---------- Alertas de orçamento ----------
let channelReady = false;
async function notify(title: string, body: string) {
  try {
    if (!channelReady) {
      await Notifications.setNotificationChannelAsync('orcamento', { name: 'Orçamento', importance: Notifications.AndroidImportance.HIGH });
      channelReady = true;
    }
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: { channelId: 'orcamento' } as any });
  } catch {}
}

export async function requestNotifPermission() {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    const st = await Notifications.getPermissionsAsync();
    if (!st.granted) await Notifications.requestPermissionsAsync();
  } catch {}
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Avisa uma vez por mês ao chegar em 80% e 100% de cada orçamento
export async function checkBudgetAlerts() {
  const month = ym(new Date());
  const budgets = await getBudgets();
  if (!Object.keys(budgets).length) return;
  const spent = await spentByCategory(month);
  for (const [cat, limit] of Object.entries(budgets)) {
    const s = spent[cat] || 0;
    for (const lvl of [100, 80]) {
      if (s >= (limit * lvl) / 100) {
        const key = `alert:${month}:${cat}:${lvl}`;
        if (!(await getMeta(key))) {
          await setMeta(key, '1');
          if (lvl === 100) await setMeta(`alert:${month}:${cat}:80`, '1');
          await notify(
            lvl === 100 ? `🚨 Orçamento estourado: ${cat}` : `⚠️ ${cat}: 80% do orçamento`,
            `Você já gastou ${brl(s)} de ${brl(limit)} este mês.`,
          );
        }
        break;
      }
    }
  }
  // entrou / saiu do negativo
  const saldo = await bankBalance();
  if (saldo != null) {
    const neg = await getMeta('negSince');
    if (saldo < -0.5 && !neg) {
      await setMeta('negSince', new Date().toISOString());
      await notify('🔴 Conta no negativo', `Seu saldo está em ${brl(saldo)}. Abra a aba Economia para ver o plano de saída.`);
    } else if (saldo >= 0 && neg) {
      await setMeta('negSince', '');
      await notify('🎉 Você saiu do negativo!', `Saldo atual: ${brl(saldo)}. Agora dá para voltar a guardar.`);
    }
    if (saldo < -0.5) return; // no negativo, a meta de economia fica pausada
  }
  // meta de economia em risco
  const g = await goalStatus();
  if (g.goal > 0 && g.canSpend < 0 && !(await getMeta(`alert:${month}:goal`))) {
    await setMeta(`alert:${month}:goal`, '1');
    await notify('💰 Meta de economia em risco', `Os gastos do mês já passaram do que dava para gastar mantendo a meta de ${brl(g.goal)}.`);
  }
}

// ---------- Dados para a análise com IA ----------
export async function insightsPayload(ref = new Date()) {
  const month = ym(ref);
  const hist: Record<string, Record<string, number>> = {};
  for (let i = 0; i <= 3; i++) {
    const m = ym(addMonths(ref, -i));
    hist[m] = await spentByCategory(m);
  }
  const top = await (await db()).getAllAsync<{ name: string; total: number; n: number }>(
    `SELECT COALESCE(merchant, description) name, SUM(amount) total, COUNT(*) n FROM tx
     WHERE type='expense' AND substr(date,1,7)=? AND category NOT IN ('Transferência','Pagamento de fatura','Investimentos')
     GROUP BY name ORDER BY total DESC LIMIT 15`, month);
  const recurring = (await findRecurring(ref)).map(r => ({ name: r.name, valor: r.last, anterior: r.prev, subiu: r.increased }));
  const g = await goalStatus(ref);
  const today = new Date();
  const plan = month === ym(today) ? await debtPlan(ref) : null;
  return {
    negativo: plan ? {
      saldoContas: -plan.divida, jurosEstimadosMes: plan.jurosMes, taxaMes: plan.taxa,
      prazoMeses: plan.meses, parcelaNecessaria: plan.parcela, sobraMediaMensal: plan.sobraMedia,
      corteNecessarioMes: plan.corteNecessario,
    } : null,
    mes: month,
    diaAtual: month === ym(today) ? today.getDate() : null,
    diasNoMes: new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate(),
    gastosPorCategoria: hist,
    maioresGastosDoMes: top,
    recorrentes: recurring,
    rendaEstimada: g.income,
    metaEconomia: g.goal,
    orcamentos: await getBudgets(),
  };
}
