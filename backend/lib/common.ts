export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function authorized(req: Request) {
  const t = process.env.APP_TOKEN;
  return !!t && req.headers.get('x-app-token') === t;
}

export const CATEGORIES = [
  'Alimentação', 'Mercado', 'Transporte', 'Combustível', 'Moradia', 'Contas',
  'Saúde', 'Educação', 'Lazer', 'Compras', 'Assinaturas', 'Viagem',
  'Investimentos', 'Transferência', 'Pagamento de fatura', 'Renda', 'Outros',
] as const;
