# GastoAuto

Controle de gastos 100% automático (Android).

- **Notificações dos bancos** (Nubank, Itaú, Inter, C6, BB, Caixa, Google Wallet…) → capturadas em tempo real.
- **Open Finance (MeuPluggy, grátis)** → extrato e cartão; concilia com as notificações (sem duplicar).
- **Gemini (cota grátis)** → extrai valor/estabelecimento e categoriza. Correção manual vira regra para o estabelecimento.
- Sincroniza ao abrir o app e em segundo plano (~30 min).

## 1. Chaves
1. **Gemini**: https://aistudio.google.com/apikey
2. **Pluggy**: crie conta em https://dashboard.pluggy.ai → Applications → crie app → copie `CLIENT_ID`/`CLIENT_SECRET`.
3. **MeuPluggy**: em https://meu.pluggy.ai conecte seus bancos via Open Finance. No dashboard Pluggy, adicione o conector **MeuPluggy** à aplicação (faça durante o trial de 14 dias; depois continua grátis para o próprio CPF).

## 2. Backend
Já publicado em https://gastoauto-api.vercel.app (projeto `gastoauto-api` na Vercel, variáveis configuradas).

## 3. APK
No PC, dentro da pasta do projeto:
```bash
npm i
npx eas-cli@latest build -p android --profile preview
```
(URL e token do backend já estão no `eas.json`.) Ao terminar, baixe o APK pelo link/QR code.

## 4. No celular
1. Instale o APK.
2. Android 13+: *Configurações → Apps → GastoAuto → ⋮ → Permitir configurações restritas* (necessário para APK fora da Play Store).
3. App → **Ajustes → Abrir permissão** → ative o GastoAuto em "Acesso a notificações".
4. **Ajustes → Conectar conta** → escolha **MeuPluggy** → autorize.
5. Desative otimização de bateria para o GastoAuto (Xiaomi/Samsung matam o serviço).

## Estrutura
```
App.tsx                       UI (Resumo, Lançamentos, Ajustes)
src/sync.ts                   notificações → Gemini; Open Finance → conciliação
src/db.ts                     SQLite local
modules/notif-capture/        módulo nativo Kotlin (NotificationListenerService)
backend/api/                  connect-token, transactions, classify (Vercel)
```
