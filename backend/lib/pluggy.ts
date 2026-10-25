const BASE = 'https://api.pluggy.ai';

// fetch com limite de tempo: a Pluggy às vezes segura a conexão sem responder
async function tfetch(url: string, init: RequestInit = {}, ms = 12000): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (e: any) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return new Response('timeout', { status: 504 });
    throw e;
  }
}

let cached: { key: string; exp: number } | null = null;

export async function apiKey(): Promise<string> {
  if (cached && cached.exp > Date.now()) return cached.key;
  let r!: Response;
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await tfetch(`${BASE}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: process.env.PLUGGY_CLIENT_ID,
        clientSecret: process.env.PLUGGY_CLIENT_SECRET,
      }),
    });
    if (r.ok || (r.status < 500 && r.status !== 429)) break;
    await new Promise(res => setTimeout(res, 1000 * 2 ** attempt));
  }
  if (!r.ok) throw new Error(`Pluggy /auth ${r.status}: falha ao autenticar`);
  const { apiKey } = await r.json();
  cached = { key: apiKey, exp: Date.now() + 100 * 60_000 }; // válida 2h
  return apiKey;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Repete em instabilidade da Pluggy (429/5xx)
export async function pluggy(path: string, init: RequestInit = {}) {
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await tfetch(`${BASE}${path}`, {
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
