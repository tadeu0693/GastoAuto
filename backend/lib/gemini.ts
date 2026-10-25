const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const key = () => process.env.GEMINI_API_KEY!;

let fallbacks: string[] | null = null;

// Modelos "flash" disponíveis para a chave (usados se o principal estiver sobrecarregado)
export async function flashModels(): Promise<string[]> {
  if (fallbacks) return fallbacks;
  const r = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key() } });
  if (!r.ok) return (fallbacks = []);
  const d = await r.json();
  fallbacks = (d.models ?? [])
    .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m: any) => String(m.name).replace('models/', ''))
    .filter((n: string) => n.includes('flash') && !/image|tts|audio|live|preview|exp/.test(n));
  return fallbacks!;
}

async function call(model: string, prompt: string): Promise<Response> {
  return fetch(`${BASE}/models/${model}:generateContent`, {
    signal: AbortSignal.timeout(25000),
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key() },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
}

export async function geminiJSON<T>(prompt: string): Promise<T> {
  const primary = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const models = [primary, ...(await flashModels()).filter(m => m !== primary)].slice(0, 3);
  let last = '';
  for (const model of models) {
    for (let attempt = 0; attempt < 1; attempt++) {
      const r = await call(model, prompt).catch(() => new Response('timeout', { status: 504 }));
      if (r.ok) {
        const d = await r.json();
        const text = d.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') || '[]';
        return JSON.parse(text) as T;
      }
      last = `Gemini ${model} ${r.status}: ${(await r.text()).slice(0, 200)}`;
      if (r.status !== 429 && r.status < 500) break; // erro definitivo neste modelo
      await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error(last);
}
