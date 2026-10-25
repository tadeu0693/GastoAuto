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

export async function pluggy(path: string, init: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'X-API-KEY': await apiKey(), ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Pluggy ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}
