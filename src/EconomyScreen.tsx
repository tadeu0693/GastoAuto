import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CATEGORIES, getMeta, NEUTRAL, setMeta } from './db';
import {
  averages, debtPlan, DebtPlan, findRecurring, getBudgets, goalStatus, insightsPayload, Recurring, requestNotifPermission,
  setBudget, setDebtMonths, setDebtRate, setGoal, spentByCategory, ym,
} from './economy';
import { api } from './api';

const C = { bg: '#0E1116', card: '#171B22', line: '#232935', text: '#E8ECF2', dim: '#8A93A3', red: '#FF6B6B', green: '#3DDC97', accent: '#6C8CFF', yellow: '#FFC857' };
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (s: string) => Number(s.replace(/[^\d,]/g, '').replace(',', '.')) || 0;

type Insights = { resumo: string; alertas: string[]; sugestoes: { titulo: string; economia: number; detalhe: string }[] };

export default function EconomyScreen({ month, version, onRefresh, syncing }: { month: Date; version: number; onRefresh: () => void; syncing: boolean }) {
  const m = ym(month);
  const [goal, setGoalState] = useState<Awaited<ReturnType<typeof goalStatus>> | null>(null);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [spent, setSpent] = useState<Record<string, number>>({});
  const [avg, setAvg] = useState<Record<string, number>>({});
  const [rec, setRec] = useState<Recurring[]>([]);
  const [debt, setDebt] = useState<DebtPlan | null>(null);
  const [edit, setEdit] = useState<{ kind: 'goal' } | { kind: 'rate' } | { kind: 'budget'; cat: string } | null>(null);
  const [value, setValue] = useState('');
  const [ai, setAi] = useState<Insights | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const load = useCallback(async () => {
    const [g, b, s, a, r, cached, dp] = await Promise.all([
      goalStatus(month), getBudgets(), spentByCategory(m), averages(month), findRecurring(month), getMeta(`insights:${m}`),
      m === ym(new Date()) ? debtPlan(month) : Promise.resolve(null),
    ]);
    setDebt(dp); setGoalState(g); setBudgets(b); setSpent(s); setAvg(a.cats); setRec(r);
    try { setAi(cached ? JSON.parse(cached) : null); } catch { setAi(null); }
  }, [m, version]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { requestNotifPermission(); }, []);

  const save = async () => {
    if (!edit) return;
    if (edit.kind === 'goal') await setGoal(num(value));
    else if (edit.kind === 'rate') await setDebtRate(Number(value.replace(',', '.').replace(/[^\d.]/g, '')));
    else await setBudget(edit.cat, num(value));
    setEdit(null);
    load();
  };

  const analyze = async () => {
    setAiLoading(true);
    try {
      const payload = await insightsPayload(month);
      const r = await api<Insights>('insights', payload);
      setAi(r);
      await setMeta(`insights:${m}`, JSON.stringify(r));
    } catch (e: any) {
      Alert.alert('Não foi possível analisar agora', e.message);
    } finally { setAiLoading(false); }
  };

  const cats = CATEGORIES.filter(c => !NEUTRAL.has(c) && c !== 'Renda');
  const withBudget = cats.filter(c => budgets[c]);
  const withoutBudget = cats.filter(c => !budgets[c] && (spent[c] || avg[c]));
  const recTotal = rec.reduce((a, r) => a + r.last, 0);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={onRefresh} tintColor={C.accent} />}>

      {/* Sair do negativo */}
      {debt && (
        <View style={[s.card, { borderColor: C.red }]}>
          <Text style={[s.h, { color: C.red }]}>🔴 Você está no negativo</Text>
          <Text style={[s.big, { color: C.red }]}>{brl(-debt.divida)}</Text>
          <Pressable onPress={() => { setValue(String(debt.taxa)); setEdit({ kind: 'rate' }); }}>
            <Text style={s.dim}>
              Custa cerca de <Text style={{ color: C.red }}>{brl(debt.jurosMes)}/mês</Text> de juros (cheque especial ~{debt.taxa}% a.m. · <Text style={{ color: C.accent }}>alterar</Text>)
            </Text>
          </Pressable>

          <Text style={[s.mid, { marginTop: 14 }]}>Sair do negativo em:</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {[1, 2, 3, 6, 12].map(n => (
              <Pressable key={n} onPress={async () => { await setDebtMonths(n); load(); }}
                style={[s.chip, debt.meses === n && { backgroundColor: C.accent, borderColor: C.accent }]}>
                <Text style={{ color: debt.meses === n ? '#fff' : C.text }}>{n} {n === 1 ? 'mês' : 'meses'}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[s.txt, { marginTop: 10 }]}>Precisa sobrar <Text style={{ fontWeight: '700' }}>{brl(debt.parcela)}</Text> por mês para quitar.</Text>

          <View style={[s.box, { marginTop: 12 }]}>
            <Text style={s.dim}>Ainda pode gastar este mês</Text>
            {debt.podeGastar > 0 ? (
              <>
                <Text style={[s.big, { color: C.yellow }]}>{brl(debt.porDia)}<Text style={s.dim}> /dia</Text></Text>
                <Text style={s.dim}>{brl(debt.podeGastar)} nos próximos {debt.diasRestantes} dias, já separando a parcela</Text>
              </>
            ) : (
              <>
                <Text style={[s.big, { color: C.red }]}>R$ 0</Text>
                <Text style={s.dim}>
                  {debt.aEntrar > 0
                    ? `O que ainda vai entrar (${brl(debt.aEntrar)}) não cobre ${debt.faturasMes > 0 ? 'a fatura e ' : ''}a parcela. Só o essencial até o próximo salário.`
                    : 'Não há mais renda prevista este mês. Qualquer gasto aumenta o negativo — só o essencial.'}
                  {debt.podeGastar < 0 ? ` Faltam ${brl(-debt.podeGastar)} para a parcela deste mês.` : ''}
                </Text>
              </>
            )}
            <Text style={[s.dim, { marginTop: 6 }]}>
              Renda a entrar: {brl(debt.aEntrar)}{debt.faturasMes > 0 ? ` · Faturas do mês: ${brl(debt.faturasMes)}` : ''}
            </Text>
          </View>

          <Text style={[s.mid, { marginTop: 14 }]}>No ritmo atual</Text>
          <Text style={s.dim}>
            {debt.mesesNoRitmoAtual != null
              ? `Sobram em média ${brl(debt.sobraMedia)}/mês → você sai do negativo em ~${debt.mesesNoRitmoAtual} ${debt.mesesNoRitmoAtual === 1 ? 'mês' : 'meses'}.`
              : debt.sobraMedia > 0
                ? `Sobram em média ${brl(debt.sobraMedia)}/mês, menos que os juros: o negativo só cresce.`
                : `Você gasta em média ${brl(-debt.sobraMedia)}/mês a mais do que ganha: o negativo só cresce.`}
          </Text>

          {debt.corteNecessario > 0 && (
            <>
              <Text style={[s.mid, { marginTop: 14 }]}>Corte {brl(debt.corteNecessario)}/mês para cumprir o prazo</Text>
              {debt.cortes.map(c => (
                <View key={c.categoria} style={[s.rowBetween, { paddingVertical: 6, borderTopWidth: 1, borderColor: C.line, marginTop: 4 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.txt}>{c.categoria}</Text>
                    <Text style={s.dim}>média {brl(c.media)} → limite {brl(Math.max(0, c.media - c.corte))}</Text>
                  </View>
                  <Pressable onPress={async () => { await setBudget(c.categoria, Math.max(0, Math.round(c.media - c.corte))); load(); }}>
                    <Text style={{ color: C.green }}>−{brl(c.corte)}  {budgets[c.categoria] ? '✓' : 'Aplicar'}</Text>
                  </Pressable>
                </View>
              ))}
              {debt.cortes.reduce((a, c) => a + c.corte, 0) < debt.corteNecessario - 1 && (
                <Text style={[s.dim, { marginTop: 6, color: C.yellow }]}>Os cortes possíveis não bastam para esse prazo. Escolha um prazo maior ou troque a dívida por uma mais barata.</Text>
              )}
            </>
          )}
          {debt.recorrentes > 0 && <Text style={[s.dim, { marginTop: 10 }]}>📺 Assinaturas/recorrentes somam {brl(debt.recorrentes)}/mês — veja abaixo o que dá para cancelar.</Text>}
          {(debt.meses > 1 || debt.mesesNoRitmoAtual == null) && (
            <Text style={[s.dim, { marginTop: 10 }]}>
              💡 O cheque especial é uma das linhas mais caras. Peça ao banco o parcelamento do limite ou um empréstimo pessoal/consignado com juros menores e quite o negativo de uma vez.
            </Text>
          )}
          <Text style={[s.dim, { marginTop: 10 }]}>Toque em "Analisar" abaixo para a IA sugerir cortes por estabelecimento.</Text>
        </View>
      )}

      {/* Meta de economia */}
      <View style={s.card}>
        <View style={s.rowBetween}>
          <Text style={s.h}>Meta de economia</Text>
          <Pressable onPress={() => { setValue(goal?.goal ? String(goal.goal) : ''); setEdit({ kind: 'goal' }); }}>
            <Text style={{ color: C.accent }}>{goal?.goal ? 'Alterar' : 'Definir'}</Text>
          </Pressable>
        </View>
        {debt ? (
          <Text style={[s.dim, { marginTop: 4 }]}>Pausada enquanto você estiver no negativo. Primeiro sair dele — o plano acima substitui a meta.</Text>
        ) : goal && goal.goal > 0 ? (
          <>
            <Text style={s.dim}>Guardar {brl(goal.goal)} este mês</Text>
            {goal.daysLeft > 0 ? (
              <>
                <Text style={[s.big, { color: goal.canSpend >= 0 ? C.green : C.red }]}>
                  {goal.canSpend >= 0 ? brl(goal.perDay) : brl(goal.canSpend)}
                </Text>
                <Text style={s.dim}>
                  {goal.canSpend >= 0
                    ? `por dia nos próximos ${goal.daysLeft} dias (${brl(goal.canSpend)} no total) para bater a meta`
                    : 'acima do limite para bater a meta este mês'}
                </Text>
              </>
            ) : (
              <Text style={[s.mid, { color: goal.canSpend >= 0 ? C.green : C.red, marginTop: 6 }]}>
                {goal.canSpend >= 0 ? `Meta batida! Sobrou ${brl(goal.canSpend)}` : `Faltaram ${brl(-goal.canSpend)} para a meta`}
              </Text>
            )}
            <Text style={[s.dim, { marginTop: 6 }]}>
              Renda {goal.incomeEstimated ? 'estimada (média 3 meses)' : 'do mês'}: {brl(goal.income)} · Gastos: {brl(goal.spent)}
            </Text>
          </>
        ) : <Text style={s.dim}>Defina quanto quer guardar por mês e o app mostra quanto ainda pode gastar por dia.</Text>}
      </View>

      {/* Orçamentos */}
      <View style={s.card}>
        <Text style={[s.h, { marginBottom: 8 }]}>Orçamento por categoria</Text>
        {withBudget.length === 0 && <Text style={[s.dim, { marginBottom: 8 }]}>Toque numa categoria abaixo para definir um limite mensal. Você recebe aviso em 80% e 100%.</Text>}
        {withBudget.map(c => {
          const sp = spent[c] || 0, lim = budgets[c];
          const pct = sp / lim;
          const color = pct >= 1 ? C.red : pct >= 0.8 ? C.yellow : C.green;
          return (
            <Pressable key={c} style={{ marginBottom: 12 }} onPress={() => { setValue(String(lim)); setEdit({ kind: 'budget', cat: c }); }}>
              <View style={s.rowBetween}>
                <Text style={[s.txt, { marginRight: 8 }]}>{c}</Text>
                <Text style={[s.txt, { color, flexShrink: 1, textAlign: 'right' }]} numberOfLines={1} adjustsFontSizeToFit>{brl(sp)} / {brl(lim)}</Text>
              </View>
              <View style={s.barBg}><View style={[s.bar, { width: `${Math.min(100, pct * 100)}%`, backgroundColor: color }]} /></View>
              <Text style={s.dim}>{pct >= 1 ? `Estourou ${brl(sp - lim)}` : `Resta ${brl(lim - sp)}`}</Text>
            </Pressable>
          );
        })}
        {withoutBudget.map(c => (
          <Pressable key={c} style={[s.rowBetween, { paddingVertical: 8, borderTopWidth: 1, borderColor: C.line }]}
            onPress={() => { setValue(avg[c] ? String(Math.round(avg[c])) : ''); setEdit({ kind: 'budget', cat: c }); }}>
            <Text style={[s.txt, { flexShrink: 0, marginRight: 8 }]}>{c}</Text>
            <Text style={[s.dim, { flexShrink: 1, textAlign: 'right' }]} numberOfLines={1} adjustsFontSizeToFit>{brl(spent[c] || 0)} · média {brl(avg[c] || 0)}  ＋</Text>
          </Pressable>
        ))}
      </View>

      {/* Assinaturas e recorrentes */}
      <View style={s.card}>
        <Text style={s.h}>Assinaturas e recorrentes</Text>
        {rec.length > 0 && <Text style={[s.mid, { color: C.red, marginTop: 2 }]}>{brl(recTotal)}/mês</Text>}
        {rec.length === 0 && <Text style={[s.dim, { marginTop: 6 }]}>Nenhuma cobrança recorrente encontrada ainda (precisa de pelo menos 2 meses de dados).</Text>}
        {rec.map(r => (
          <View key={r.key} style={[s.rowBetween, { paddingVertical: 8, borderTopWidth: 1, borderColor: C.line, marginTop: 6 }]}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={s.txt} numberOfLines={1}>{r.name}</Text>
              <Text style={s.dim}>{r.category} · {r.months} meses{r.increased && r.prev ? ` · subiu de ${brl(r.prev)}` : ''}</Text>
            </View>
            <Text style={[s.txt, { color: r.increased ? C.yellow : C.text }]}>{r.increased ? '▲ ' : ''}{brl(r.last)}</Text>
          </View>
        ))}
        {rec.length > 0 && <Text style={[s.dim, { marginTop: 6 }]}>{brl(recTotal * 12)} por ano. Cancele o que não usa.</Text>}
      </View>

      {/* Análise com IA */}
      <View style={s.card}>
        <View style={s.rowBetween}>
          <Text style={s.h}>Análise do mês (IA)</Text>
          <Pressable onPress={analyze} disabled={aiLoading}>
            {aiLoading ? <ActivityIndicator color={C.accent} /> : <Text style={{ color: C.accent }}>{ai ? 'Atualizar' : 'Analisar'}</Text>}
          </Pressable>
        </View>
        {!ai && !aiLoading && <Text style={[s.dim, { marginTop: 6 }]}>O Gemini compara este mês com os anteriores e sugere onde cortar, com valor estimado.</Text>}
        {ai && (
          <>
            <Text style={[s.txt, { marginTop: 8 }]}>{ai.resumo}</Text>
            {ai.alertas?.map((a, i) => <Text key={i} style={[s.txt, { color: C.yellow, marginTop: 6 }]}>⚠️ {a}</Text>)}
            {ai.sugestoes?.length > 0 && (
              <Text style={[s.mid, { marginTop: 12, color: C.green }]}>
                Economia possível: {brl(ai.sugestoes.reduce((a, x) => a + (x.economia || 0), 0))}/mês
              </Text>
            )}
            {ai.sugestoes?.map((x, i) => (
              <View key={i} style={{ marginTop: 10 }}>
                <View style={s.rowBetween}>
                  <Text style={[s.txt, { flex: 1, fontWeight: '600' }]}>💡 {x.titulo}</Text>
                  {!!x.economia && <Text style={[s.txt, { color: C.green }]}>−{brl(x.economia)}</Text>}
                </View>
                <Text style={s.dim}>{x.detalhe}</Text>
              </View>
            ))}
          </>
        )}
      </View>

      <Modal visible={!!edit} transparent animationType="fade" onRequestClose={() => setEdit(null)}>
        <Pressable style={s.overlay} onPress={() => setEdit(null)}>
          <Pressable style={s.sheet}>
            <Text style={[s.mid, { marginBottom: 4 }]}>{edit?.kind === 'goal' ? 'Quanto quer guardar por mês?' : edit?.kind === 'rate' ? 'Juros do cheque especial (% ao mês)' : `Limite mensal: ${edit?.kind === 'budget' ? edit.cat : ''}`}</Text>
            {edit?.kind === 'rate' && <Text style={s.dim}>Veja no app do banco. O teto legal é 8% a.m.</Text>}
            {edit?.kind === 'budget' && !!avg[edit.cat] && <Text style={s.dim}>Sua média: {brl(avg[edit.cat])}/mês</Text>}
            <TextInput
              value={value} onChangeText={setValue} keyboardType="decimal-pad" autoFocus placeholder={edit?.kind === 'rate' ? '8' : 'R$ 0'} placeholderTextColor={C.dim}
              style={s.input}
            />
            <View style={[s.rowBetween, { marginTop: 12 }]}>
              {edit?.kind === 'budget' && budgets[edit.cat]
                ? <Pressable onPress={async () => { await setBudget((edit as any).cat, null); setEdit(null); load(); }}><Text style={{ color: C.red }}>Remover limite</Text></Pressable>
                : <View />}
              <Pressable style={s.btn} onPress={save}><Text style={s.btnT}>Salvar</Text></Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.line },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  h: { color: C.text, fontSize: 17, fontWeight: '600' },
  big: { fontSize: 30, fontWeight: '700', marginTop: 6 },
  mid: { color: C.text, fontSize: 16, fontWeight: '600' },
  txt: { color: C.text, fontSize: 15 },
  dim: { color: C.dim, fontSize: 13 },
  barBg: { height: 6, backgroundColor: C.line, borderRadius: 3, marginVertical: 4 },
  bar: { height: 6, borderRadius: 3 },
  overlay: { flex: 1, backgroundColor: '#0009', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: C.card, padding: 20, borderRadius: 16 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, color: C.text, fontSize: 22, padding: 12, marginTop: 12 },
  btn: { backgroundColor: C.accent, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  btnT: { color: '#fff', fontWeight: '700' },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  box: { backgroundColor: C.bg, borderRadius: 10, padding: 12 },
});
