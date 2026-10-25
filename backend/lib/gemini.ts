const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const key = () => process.env.GEMINI_API_KEY!;

let available: string[] | null = null;
const dead = new Set<string>();                 // modelos indisponíveis para a chave (404/400)
const exhausted = new Map<string, number>();    // cota gratuita esgotada até (timestamp)

// Modelos "flash" da chave. Cada modelo tem cota gratuita própria, então alternar entre eles
// multiplica o limite diário.
async function flashModels(): Promise<string[]> {
  if (available) return available;
  const r = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key() } }).catch(() => null);
  if (!r?.ok) return (available = []);
  const d = await r.json();
  available = (d.models ?? [])
    .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m: any) => String(m.name).replace('models/', ''))
    .filter((n: string) => n.includes('flash') && !/image|tts|audio|live|preview|exp|omni/.test(n))
    .sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true })); // mais novos primeiro
  return available!;
}
export { flashModels };

async function call(model: string, prompt: string): Promise<Response> {
  return fetch(`${BASE}/models/${model}:generateContent`, {
    signal: AbortSignal.timeout(18000),
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key() },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  }).catch(() => new Response('timeout', { status: 504 }));
}

export class QuotaError extends Error {}

export async function geminiJSON<T>(prompt: string): Promise<T> {
  const primary = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const now = Date.now();
  const models = [primary, ...(await flashModels()).filter(m => m !== primary)]
    .filter(m => !dead.has(m) && (exhausted.get(m) ?? 0) < now)
    .slice(0, 5);
  let last = '';
  let quota = 0;
  const started = Date.now();
  for (const model of models) {
    if (Date.now() - started > 45000) break; // não estoura o limite de 60s da função
    const r = await call(model, prompt);
    if (r.ok) {
      const d = await r.json();
      const text = d.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') || '[]';
      return JSON.parse(text) as T;
    }
    const body = (await r.text()).slice(0, 300);
    last = `Gemini ${model} ${r.status}: ${body}`;
    if (r.status === 404 || r.status === 400) dead.add(model);
    else if (r.status === 429) {
      quota++;
      // cota diária esgotada: pula este modelo por 1h; limite por minuto: 1 min
      exhausted.set(model, Date.now() + (/per.?day|daily|exceeded your current quota/i.test(body) ? 3600_000 : 60_000));
    } else if (r.status >= 500) await sleep(800);
  }
  if (quota && quota === models.length)
    throw new QuotaError('Limite gratuito do Gemini atingido por hoje. Tente novamente mais tarde (renova diariamente).');
  throw new Error(last || 'Nenhum modelo Gemini disponível no momento.');
}
