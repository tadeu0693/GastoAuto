import * as SQLite from 'expo-sqlite';

export type Tx = {
  id: string;
  source: 'notif' | 'pluggy';
  external_id: string | null;
  date: string; // ISO
  amount: number;
  type: 'expense' | 'income';
  description: string;
  merchant: string | null;
  category: string;
  account: string | null;
};

export const CATEGORIES = [
  'Alimentação', 'Mercado', 'Transporte', 'Combustível', 'Moradia', 'Contas',
  'Saúde', 'Educação', 'Lazer', 'Compras', 'Assinaturas', 'Viagem',
  'Investimentos', 'Transferência', 'Pagamento de fatura', 'Renda', 'Outros',
];
// Não entram no total de gastos/receitas (evita contar 2x)
export const NEUTRAL = new Set(['Transferência', 'Pagamento de fatura', 'Investimentos']);

let _db: SQLite.SQLiteDatabase | null = null;

export async function db() {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('gastoauto.db');
  await _db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tx (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT UNIQUE,
      date TEXT NOT NULL, amount REAL NOT NULL, type TEXT NOT NULL,
      description TEXT, merchant TEXT, category TEXT NOT NULL, account TEXT
    );
    CREATE INDEX IF NOT EXISTS tx_date ON tx(date);
    CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE IF NOT EXISTS rules (merchant_key TEXT PRIMARY KEY, category TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS pending_class (id TEXT PRIMARY KEY);
  `);
  return _db;
}

export const merchantKey = (s: string | null | undefined) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '').slice(0, 24);

export async function getMeta(key: string) {
  const r = await (await db()).getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key=?', key);
  return r?.value ?? null;
}
export async function setMeta(key: string, value: string) {
  await (await db()).runAsync('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)', key, value);
}

export async function ruleFor(merchant: string | null) {
  const k = merchantKey(merchant);
  if (!k) return null;
  const r = await (await db()).getFirstAsync<{ category: string }>('SELECT category FROM rules WHERE merchant_key=?', k);
  return r?.category ?? null;
}

export async function insertTx(t: Tx) {
  await (await db()).runAsync(
    `INSERT OR IGNORE INTO tx(id,source,external_id,date,amount,type,description,merchant,category,account)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    t.id, t.source, t.external_id, t.date, t.amount, t.type, t.description, t.merchant, t.category, t.account,
  );
}

// Corrige categoria e passa a valer para o mesmo estabelecimento no futuro
export async function setCategory(tx: Tx, category: string) {
  const d = await db();
  await d.runAsync('UPDATE tx SET category=? WHERE id=?', category, tx.id);
  await d.runAsync('DELETE FROM pending_class WHERE id=?', tx.id); // escolha do usuário prevalece
  const k = merchantKey(tx.merchant || tx.description);
  if (k) {
    await d.runAsync('INSERT OR REPLACE INTO rules(merchant_key,category) VALUES(?,?)', k, category);
    if (tx.merchant) {
      await d.runAsync(
        'UPDATE tx SET category=? WHERE id<>? AND lower(merchant)=lower(?)',
        category, tx.id, tx.merchant,
      );
    }
  }
}

export async function deleteTx(id: string) {
  await (await db()).runAsync('DELETE FROM tx WHERE id=?', id);
}

export async function listMonth(ym: string) {
  return (await db()).getAllAsync<Tx>(
    `SELECT * FROM tx WHERE substr(date,1,7)=? ORDER BY date DESC`, ym,
  );
}

export async function items() {
  return (await db()).getAllAsync<{ id: string; name: string }>('SELECT * FROM items');
}
export async function addItem(id: string, name: string) {
  await (await db()).runAsync('INSERT OR REPLACE INTO items(id,name) VALUES(?,?)', id, name);
}
export async function removeItem(id: string) {
  await (await db()).runAsync('DELETE FROM items WHERE id=?', id);
}
