const BASE = 'https://api.pluggy.ai';

let cached: { key: string; exp: number } | null = null;

export async function apiKey(): Promise<string> {
  if (cached && cached.exp > Date.now()) return cached.key;
  const r = await fetch(`${BASE}/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new Error(`Pluggy auth ${r.status}`);
  const { apiKey } = await r.json();
  cached = { key: apiKey, exp: Date.now() + 100 * 60_000 }; // válida 2h
  return apiKey;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Repete em instabilidade da Pluggy (429/5xx)
export async function pluggy(path: string, init: RequestInit = {}) {
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', 'X-API-KEY': await apiKey(), ...(init.headers || {}) },
    });
    if (r.ok) return r.json();
    const body = (await r.text()).slice(0, 200);
    last = `Pluggy ${path} ${r.status}: ${body}`;
    if (r.status === 401 || r.status === 403) cached = null; // apiKey expirada
    if (r.status !== 429 && r.status < 500 && r.status !== 401) break;
    await sleep(1000 * 2 ** attempt); // 1s, 2s, 4s
  }
  throw new Error(last);
}
