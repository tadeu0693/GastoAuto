import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { NotifCapture } from './modules/notif-capture/src/NotifCaptureModule';
import { addItem, getMeta, getBalances, Balance, CATEGORIES, deleteTx, items as listItems, listMonth, NEUTRAL, removeItem, setCategory, Tx } from './src/db';
import { syncAll } from './src/sync';
import { api } from './src/api';
import { registerBackground } from './src/background';
import EconomyScreen from './src/EconomyScreen';

const C = { bg: '#0E1116', card: '#171B22', line: '#232935', text: '#E8ECF2', dim: '#8A93A3', red: '#FF6B6B', green: '#3DDC97', accent: '#6C8CFF' };
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ymOf = (d: Date) => d.toISOString().slice(0, 7);
const APP_NAMES: Record<string, string> = {
  'com.nu.production': 'Nubank', 'com.itau': 'Itaú', 'com.itau.iti': 'iti', 'com.bradesco': 'Bradesco',
  'br.com.bradesco.next': 'Next', 'br.com.bb.android': 'Banco do Brasil', 'br.com.gabba.Caixa': 'Caixa',
  'com.santander.app': 'Santander', 'br.com.intermedium': 'Inter', 'com.c6bank.app': 'C6 Bank',
  'com.picpay': 'PicPay', 'com.mercadopago.wallet': 'Mercado Pago', 'br.com.uol.ps.myaccount': 'PagBank',
  'br.com.neon': 'Neon', 'com.btg.pactual.banking': 'BTG', 'br.com.original.bank': 'Original',
  'com.google.android.apps.walletnfcrel': 'Google Wallet',
};
let PluggyConnect: any = null; // carregado só ao conectar
const appName = (p: string | null) => (p && APP_NAMES[p]) || p || '';

export default function Root() {
  return <SafeAreaProvider><App /></SafeAreaProvider>;
}

function App() {
  const [tab, setTab] = useState<'resumo' | 'lanc' | 'economia' | 'ajustes'>('resumo');
  const [version, setVersion] = useState(0);
  const [month, setMonth] = useState(new Date());
  const [txs, setTxs] = useState<Tx[]>([]);
  const [syncing, setSyncing] = useState(false);

  const [balances, setBalances] = useState<{ list: Balance[]; at: string | null }>({ list: [], at: null });
  const load = useCallback(async () => {
    setTxs(await listMonth(ymOf(month)));
    setBalances(await getBalances());
  }, [month]);

  const sync = useCallback(async (silent = false) => {
    setSyncing(true);
    try {
      const r = await syncAll();
      if (!silent) {
        const pend = r.items.filter(i => i.execution && !/SUCCESS|PARTIAL_SUCCESS/.test(i.execution) || i.status === 'UPDATING');
        if (r.errors.length) Alert.alert('Erro ao sincronizar', r.errors.join('\n'));
        else if (r.items.length && r.items.every(i => i.transactions === 0))
          Alert.alert('Open Finance', pend.length
            ? 'Seus bancos ainda estão sincronizando no MeuPluggy. O primeiro carregamento pode levar alguns minutos — puxe para atualizar depois.'
            : 'Conectado, mas nenhuma movimentação foi encontrada nos últimos 90 dias. Confira em meu.pluggy.ai se seus bancos estão conectados e autorizados.');
      }
    } catch (e: any) { if (!silent) Alert.alert('Erro ao sincronizar', e.message); }
    finally { setSyncing(false); load(); setVersion(v => v + 1); }
  }, [load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    registerBackground().catch(() => {});
    sync(true);
    const s = AppState.addEventListener('change', st => st === 'active' && sync(true));
    return () => s.remove();
  }, []);

  const shift = (n: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const m = month.toLocaleDateString('pt-BR', { month: 'long' });
  const label = `${m.charAt(0).toUpperCase()}${m.slice(1)} ${month.getFullYear()}`;

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <View style={s.header}>
        <Pressable onPress={() => shift(-1)} hitSlop={12}><Text style={s.arrow}>‹</Text></Pressable>
        <Text style={s.month}>{label}</Text>
        <Pressable onPress={() => shift(1)} hitSlop={12}><Text style={s.arrow}>›</Text></Pressable>
        {syncing && <ActivityIndicator color={C.accent} style={{ position: 'absolute', right: 16 }} />}
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'resumo' && <Resumo txs={txs} balances={balances} onRefresh={() => sync()} syncing={syncing} />}
        {tab === 'lanc' && <Lancamentos txs={txs} onChange={load} onRefresh={() => sync()} syncing={syncing} />}
        {tab === 'economia' && <EconomyScreen month={month} version={version} onRefresh={() => sync()} syncing={syncing} />}
        {tab === 'ajustes' && <Ajustes onConnected={() => sync()} />}
      </View>

      <View style={s.tabs}>
        {([['resumo', 'Resumo'], ['lanc', 'Lançamentos'], ['economia', 'Economia'], ['ajustes', 'Ajustes']] as const).map(([k, t]) => (
          <Pressable key={k} style={s.tab} onPress={() => setTab(k)}>
            <Text style={[s.tabText, tab === k && { color: C.accent }]}>{t}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

function Resumo({ txs, balances, onRefresh, syncing }: { txs: Tx[]; balances: { list: Balance[]; at: string | null }; onRefresh: () => void; syncing: boolean }) {
  const { gastos, receitas, porCat } = useMemo(() => {
    let gastos = 0, receitas = 0;
    const porCat: Record<string, number> = {};
    for (const t of txs) {
      if (NEUTRAL.has(t.category)) continue;
      if (t.type === 'expense') { gastos += t.amount; porCat[t.category] = (porCat[t.category] || 0) + t.amount; }
      else receitas += t.amount;
    }
    return { gastos, receitas, porCat: Object.entries(porCat).sort((a, b) => b[1] - a[1]) };
  }, [txs]);
  const max = porCat[0]?.[1] || 1;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={onRefresh} tintColor={C.accent} />}>
      {balances.list.length > 0 && (
        <View style={s.card}>
          <Text style={s.dim}>Saldo nas contas</Text>
          {(() => {
            const bank = balances.list.filter(b => b.type !== 'CREDIT');
            const total = bank.reduce((a, b) => a + (b.balance ?? 0), 0);
            return <Text style={[s.big, { color: total >= 0 ? C.green : C.red }]}>{brl(total)}</Text>;
          })()}
          {balances.list.map(b => (
            <View key={b.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
              <Text style={[s.txt, { flex: 1 }]} numberOfLines={1}>{b.type === 'CREDIT' ? '💳 ' : '🏦 '}{b.name}</Text>
              {b.type === 'CREDIT'
                ? <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[s.txt, { color: C.red }]}>Fatura {brl(b.balance ?? 0)}</Text>
                    {b.available != null && <Text style={s.dim}>Disponível {brl(b.available)}</Text>}
                  </View>
                : <Text style={[s.txt, { color: (b.balance ?? 0) >= 0 ? C.green : C.red }]}>{brl(b.balance ?? 0)}</Text>}
            </View>
          ))}
          {balances.at && <Text style={[s.dim, { marginTop: 8 }]}>Atualizado pelo banco em {new Date(balances.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</Text>}
        </View>
      )}
      <View style={s.card}>
        <Text style={s.dim}>Gastos do mês</Text>
        <Text style={[s.big, { color: C.red }]}>{brl(gastos)}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <View><Text style={s.dim}>Receitas</Text><Text style={[s.mid, { color: C.green }]}>{brl(receitas)}</Text></View>
          <View style={{ alignItems: 'flex-end' }}><Text style={s.dim}>Resultado do mês</Text>
            <Text style={[s.mid, { color: receitas - gastos >= 0 ? C.green : C.red }]}>{brl(receitas - gastos)}</Text></View>
        </View>
      </View>
      <View style={s.card}>
        <Text style={[s.dim, { marginBottom: 8 }]}>Por categoria</Text>
        {porCat.length === 0 && <Text style={s.dim}>Sem gastos registrados.</Text>}
        {porCat.map(([cat, v]) => (
          <View key={cat} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={s.txt}>{cat}</Text><Text style={s.txt}>{brl(v)} · {Math.round((v / gastos) * 100)}%</Text>
            </View>
            <View style={s.barBg}><View style={[s.bar, { width: `${(v / max) * 100}%` }]} /></View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Lancamentos({ txs, onChange, onRefresh, syncing }: { txs: Tx[]; onChange: () => void; onRefresh: () => void; syncing: boolean }) {
  const [sel, setSel] = useState<Tx | null>(null);
  return (
    <>
      <FlatList
        data={txs}
        keyExtractor={t => t.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={onRefresh} tintColor={C.accent} />}
        ListEmptyComponent={<Text style={[s.dim, { textAlign: 'center', marginTop: 40 }]}>Nenhum lançamento neste mês.</Text>}
        renderItem={({ item: t }) => (
          <Pressable style={s.row} onPress={() => setSel(t)}>
            <View style={{ flex: 1 }}>
              <Text style={s.txt} numberOfLines={1}>{t.merchant || t.description}</Text>
              <Text style={s.dim} numberOfLines={1}>
                {new Date(t.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} · {t.category} · {t.source === 'notif' && !t.external_id ? appName(t.account) : t.account}
              </Text>
            </View>
            <Text style={[s.txt, { color: t.type === 'expense' ? (NEUTRAL.has(t.category) ? C.dim : C.red) : C.green, fontWeight: '600' }]}>
              {t.type === 'expense' ? '−' : '+'}{brl(t.amount)}
            </Text>
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
    </>
  );
}

function Ajustes({ onConnected }: { onConnected: () => void }) {
  const [perm, setPerm] = useState(false);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [known, setKnown] = useState<string[]>([]);
  const [its, setIts] = useState<{ id: string; name: string; info?: string }[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [connectorId, setConnectorId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setPerm(NotifCapture.hasPermission());
    const a = NotifCapture.getAllowedPackages();
    setAllowed(a);
    setKnown([...new Set([...NotifCapture.getDefaultPackages(), ...NotifCapture.getSeenPackages(), ...a])].sort((x, y) => appName(x).localeCompare(appName(y))));
    const list = await listItems();
    setIts(await Promise.all(list.map(async i => {
      const raw = await getMeta(`status:${i.id}`);
      let info = 'Aguardando primeira sincronização';
      try {
        const st = raw && JSON.parse(raw);
        if (st) info = st.status === 'UPDATING' ? 'Sincronizando no banco…'
          : st.error ? `Erro: ${st.error}`
          : `${st.accounts} conta(s) · ${st.transactions} movimentação(ões) no último sync`;
      } catch {}
      return { ...i, info };
    })));
  }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', st => st === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const toggle = (p: string, on: boolean) => {
    const next = on ? [...allowed, p] : allowed.filter(x => x !== p);
    NotifCapture.setAllowedPackages(next);
    setAllowed(next);
  };

  const [opening, setOpening] = useState(false);
  const connect = async () => {
    if (opening) return;
    setOpening(true);
    try {
      if (!PluggyConnect) PluggyConnect = require('react-native-pluggy-connect').PluggyConnect;
      const { accessToken, connectorId } = await api<{ accessToken: string; connectorId: number | null }>('connect-token', {});
      if (!accessToken) throw new Error('O servidor não retornou o token de conexão.');
      setConnectorId(connectorId);
      setToken(accessToken);
    } catch (e: any) {
      Alert.alert('Erro ao conectar', e?.message ?? String(e));
    } finally {
      setOpening(false);
    }
  };

  return (
    <>
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View style={s.card}>
        <Text style={s.mid}>Leitura de notificações</Text>
        <Text style={[s.dim, { marginVertical: 6 }]}>
          {perm ? '✅ Ativa — compras e Pix são capturados automaticamente.' : '⚠️ Desativada. Permita o acesso às notificações para o GastoAuto.'}
        </Text>
        {!perm && <Pressable style={s.btn} onPress={() => NotifCapture.openPermissionSettings()}><Text style={s.btnT}>Abrir permissão</Text></Pressable>}
      </View>

      <View style={s.card}>
        <Text style={s.mid}>Contas via Open Finance</Text>
        <Text style={[s.dim, { marginVertical: 6 }]}>Conecte pelo MeuPluggy (grátis, uso pessoal). Concilia com as notificações e traz o que elas não mostram.</Text>
        {its.map(i => (
          <View key={i.id} style={[s.row, { marginBottom: 6 }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.txt}>{i.name}</Text>
              {!!i.info && <Text style={s.dim}>{i.info}</Text>}
            </View>
            <Pressable onPress={async () => { await removeItem(i.id); refresh(); }}><Text style={{ color: C.red }}>Remover</Text></Pressable>
          </View>
        ))}
        <Pressable style={[s.btn, opening && { opacity: 0.6 }]} onPress={connect}>
          {opening ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>+ Conectar conta</Text>}
        </Pressable>
      </View>

      <View style={s.card}>
        <Text style={[s.mid, { marginBottom: 6 }]}>Apps monitorados</Text>
        {known.map(p => (
          <View key={p} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
            <Text style={[s.txt, { flex: 1 }]} numberOfLines={1}>{APP_NAMES[p] ?? p}</Text>
            <Switch value={allowed.includes(p)} onValueChange={v => toggle(p, v)} />
          </View>
        ))}
        <Text style={[s.dim, { marginTop: 6 }]}>Apps que notificarem valores em R$ aparecem aqui para você ativar.</Text>
      </View>

    </ScrollView>

    {/* Widget da Pluggy em tela cheia */}
    <Modal visible={!!token} animationType="slide" onRequestClose={() => setToken(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top', 'bottom']}>
        {token && PluggyConnect && (
          <PluggyConnect
            connectToken={token}
            includeSandbox={false}
            {...(connectorId ? { connectorIds: [connectorId], selectedConnectorId: connectorId } : {})}
            language="pt"
            forceOauthInBrowser
            onClose={() => setToken(null)}
            onError={(e: any) => { setToken(null); Alert.alert('Erro na conexão', e?.message ?? 'Falha'); }}
            onSuccess={async ({ item }: any) => {
              await addItem(item.id, item.connector?.name ?? 'Conta');
              setToken(null);
              refresh();
              onConnected();
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, paddingVertical: 12 },
  arrow: { color: C.text, fontSize: 28, paddingHorizontal: 8 },
  month: { color: C.text, fontSize: 17, fontWeight: '600', minWidth: 150, textAlign: 'center' },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.line },
  big: { fontSize: 32, fontWeight: '700', marginTop: 4 },
  mid: { color: C.text, fontSize: 17, fontWeight: '600' },
  txt: { color: C.text, fontSize: 15 },
  dim: { color: C.dim, fontSize: 13 },
  barBg: { height: 6, backgroundColor: C.line, borderRadius: 3, marginTop: 4 },
  bar: { height: 6, backgroundColor: C.accent, borderRadius: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.line },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: C.line, backgroundColor: C.card },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabText: { color: C.dim, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.card, padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  btn: { backgroundColor: C.accent, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 6 },
  btnT: { color: '#fff', fontWeight: '700' },
});
