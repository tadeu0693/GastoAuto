import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CATEGORIES, deleteTx, setCategory, Tx } from './db';
import { averages, getBudgets } from './economy';

const C = { bg: '#0E1116', card: '#171B22', line: '#232935', text: '#E8ECF2', dim: '#8A93A3', red: '#FF6B6B', green: '#3DDC97', accent: '#6C8CFF', yellow: '#FFC857' };
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Tudo de uma categoria no mês: total, comparação com a média, maiores estabelecimentos e lançamentos
export default function CategoryDetail({ category, txs, month, onClose, onChange }: {
  category: string | null; txs: Tx[]; month: Date; onClose: () => void; onChange: () => void;
}) {
  const [avg, setAvg] = useState<number | null>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [sel, setSel] = useState<Tx | null>(null);

  const list = useMemo(
    () => txs.filter(t => t.category === category && t.type === 'expense').sort((a, b) => b.date.localeCompare(a.date)),
    [txs, category],
  );
  const total = list.reduce((a, t) => a + t.amount, 0);

  const top = useMemo(() => {
    const m = new Map<string, { total: number; n: number }>();
    for (const t of list) {
      const k = (t.merchant || t.description || '—').trim();
      const v = m.get(k) ?? { total: 0, n: 0 };
      v.total += t.amount; v.n++;
      m.set(k, v);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  }, [list]);

  useEffect(() => {
    if (!category) return;
    averages(month).then(a => setAvg(a.cats[category] ?? null));
    getBudgets().then(b => setBudget(b[category] ?? null));
  }, [category, month]);

  const diff = avg ? total - avg : null;

  return (
    <Modal visible={!!category} animationType="slide" onRequestClose={() => (sel ? setSel(null) : onClose())}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Pressable onPress={onClose} hitSlop={12}><Text style={s.back}>‹</Text></Pressable>
          <Text style={s.title} numberOfLines={1}>{category}</Text>
          <View style={{ width: 28 }} />
        </View>

        <FlatList
          data={list}
          keyExtractor={t => t.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListHeaderComponent={
            <View style={{ gap: 12, marginBottom: 4 }}>
              <View style={s.card}>
                <Text style={s.dim}>Total no mês · {list.length} lançamento(s)</Text>
                <Text style={[s.big, { color: C.red }]}>{brl(total)}</Text>
                {avg != null && (
                  <Text style={[s.txt, { color: diff! > 0 ? C.yellow : C.green, marginTop: 4 }]}>
                    {diff! > 0 ? '▲' : '▼'} {brl(Math.abs(diff!))} {diff! > 0 ? 'acima' : 'abaixo'} da sua média ({brl(avg)}/mês)
                  </Text>
                )}
                {budget != null && (
                  <Text style={[s.dim, { marginTop: 4 }]}>
                    Orçamento {brl(budget)} · {total > budget ? `estourou ${brl(total - budget)}` : `resta ${brl(budget - total)}`}
                  </Text>
                )}
              </View>
              {top.length > 1 && (
                <View style={s.card}>
                  <Text style={[s.dim, { marginBottom: 6 }]}>Onde mais gastou</Text>
                  {top.map(([name, v]) => (
                    <View key={name} style={{ marginBottom: 8 }}>
                      <View style={s.rowBetween}>
                        <Text style={[s.txt, { flex: 1, marginRight: 8 }]} numberOfLines={1}>{name}</Text>
                        <Text style={s.txt}>{brl(v.total)}</Text>
                      </View>
                      <View style={s.barBg}><View style={[s.bar, { width: `${(v.total / top[0][1].total) * 100}%` }]} /></View>
                      <Text style={s.dim}>{v.n}x · {Math.round((v.total / total) * 100)}% da categoria</Text>
                    </View>
                  ))}
                </View>
              )}
              <Text style={[s.dim, { marginTop: 4 }]}>Lançamentos (toque para mudar a categoria)</Text>
            </View>
          }
          ListEmptyComponent={<Text style={[s.dim, { textAlign: 'center', marginTop: 24 }]}>Nenhum gasto nesta categoria no mês.</Text>}
          renderItem={({ item: t }) => (
            <Pressable style={s.row} onPress={() => setSel(t)}>
              <View style={{ flex: 1 }}>
                <Text style={s.txt} numberOfLines={1}>{t.merchant || t.description}</Text>
                <Text style={s.dim} numberOfLines={1}>
                  {new Date(t.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} · {t.account ?? ''}
                </Text>
              </View>
              <Text style={[s.txt, { color: C.red, fontWeight: '600' }]}>−{brl(t.amount)}</Text>
            </Pressable>
          )}
        />

        <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
          <Pressable style={s.overlay} onPress={() => setSel(null)}>
            <Pressable style={s.sheet}>
              <Text style={[s.mid, { marginBottom: 4 }]}>{sel?.merchant || sel?.description}</Text>
              <Text style={[s.dim, { marginBottom: 12 }]} numberOfLines={3}>{sel?.description}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {CATEGORIES.map(c => (
                  <Pressable key={c} style={[s.chip, sel?.category === c && { borderColor: C.accent }]}
                    onPress={async () => { await setCategory(sel!, c); setSel(null); onChange(); }}>
                    <Text style={s.txt}>{c}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={{ marginTop: 16 }} onPress={async () => { await deleteTx(sel!.id); setSel(null); onChange(); }}>
                <Text style={{ color: C.red }}>Excluir lançamento</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: C.text, fontSize: 32, width: 28 },
  title: { color: C.text, fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.line },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  big: { fontSize: 30, fontWeight: '700', marginTop: 4 },
  mid: { color: C.text, fontSize: 17, fontWeight: '600' },
  txt: { color: C.text, fontSize: 15 },
  dim: { color: C.dim, fontSize: 13 },
  barBg: { height: 6, backgroundColor: C.line, borderRadius: 3, marginVertical: 4 },
  bar: { height: 6, backgroundColor: C.accent, borderRadius: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.line },
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.card, padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
});
