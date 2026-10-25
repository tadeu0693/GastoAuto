import * as Notifications from 'expo-notifications';
import { db, getMeta, merchantKey, NEUTRAL, setMeta, Tx } from './db';

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
  return {
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
