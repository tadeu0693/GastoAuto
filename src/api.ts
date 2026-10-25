const URL_ = process.env.EXPO_PUBLIC_API_URL!;
const TOKEN = process.env.EXPO_PUBLIC_APP_TOKEN!;

export async function api<T = any>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${URL_}/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-token': TOKEN },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
