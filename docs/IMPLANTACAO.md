# Implantação

## Componentes

| Serviço | Comando | Escala |
|---|---|---|
| PostgreSQL 16 | — | 1 (com backup) |
| API | `node dist/main.js` | 1+ (stateless) |
| Worker | `node dist/worker.js` | 1+ (a fila usa `SKIP LOCKED`) |
| Web | `node apps/web/server.js` | 1+ |

## 1. Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # CREDENTIALS_ENCRYPTION_KEY (guarde em cofre; sem ela não é possível ler as credenciais)
```

`META_APP_SECRET` e `WHATSAPP_WEBHOOK_VERIFY_TOKEN` são obrigatórios em produção.

## 2. Banco e migrações

A migração inicial (`apps/api/prisma/migrations/20261114000000_init`) já está versionada. Em desenvolvimento, aplique-a (e crie novas após alterar o schema) com:

```bash
pnpm db:migrate                                   # = prisma migrate dev
pnpm --filter @liecimara/api prisma migrate dev --name <descricao>
```

A CLI do Prisma lê o `.env` da raiz pelo `apps/api/prisma.config.ts`. Em runtime a API usa o driver `pg` (`@prisma/adapter-pg`, `engineType = "client"`), sem query engine nativo. Nos servidores, use apenas:

```bash
pnpm --filter @liecimara/api prisma:deploy
pnpm db:seed
```

## 3. Docker Compose

```bash
docker compose --env-file .env up -d --build
```

O serviço `migrate` aplica as migrações e o seed antes de subir API e worker. O frontend fala com a API pela rede interna (`API_INTERNAL_URL`).

## 4. Proxy reverso e HTTPS

A Meta exige HTTPS válido no callback. Exemplo com Caddy:

```
crm.clinica.com.br {
  reverse_proxy web:3000
}
api.crm.clinica.com.br {
  reverse_proxy api:4000
}
```

Ajuste `API_PUBLIC_URL` (usada para exibir a URL de callback) e `WEB_ORIGIN` (CORS).

## 5. Operação

- **Saúde:** `GET /health`.
- **Fila:** `GET /jobs?status=DEAD` e `POST /jobs/:id/requeue`.
- **Eventos:** tela Integrações → Eventos recentes, com reprocessamento.
- **Sincronização Meta:** automática a cada `META_SYNC_CRON_MINUTES` (últimos 7 dias); manual pela tela.
- **Backups:** `pg_dump` diário com retenção de 30 dias. Teste a restauração periodicamente.
- **Rotação de token Meta:** use token de usuário do sistema; ao trocar, atualize na tela de integrações (fica cifrado).

## 6. LGPD

O CRM armazena nome, telefone e conteúdo das mensagens de pacientes. Recomendações:

- restringir o acesso por perfil (RBAC já aplicado);
- definir política de retenção das mensagens;
- registrar a base legal no aviso de privacidade da clínica;
- usar a auditoria (`GET /audit`) para responder solicitações de titulares.

## Render (hospedagem gerenciada)

O arquivo `render.yaml` na raiz descreve toda a stack: Postgres, API (com o worker embutido via `RUN_WORKER_IN_API=true`) e painel.

1. Envie o código para um repositório **privado** no GitHub.
2. Na Render: **New → Blueprint**, escolha o repositório e confirme.
3. Informe `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` quando solicitado.
4. A cada deploy, a API aplica as migrações e o seed (`preDeployCommand`) antes de entrar no ar.
5. O painel fica em `https://liecimara-painel.onrender.com` (ou nome semelhante) e a API, com os webhooks, em `https://liecimara-api.onrender.com`.
6. Ao configurar o WhatsApp, adicione `META_APP_SECRET` no serviço da API (Environment) e use o valor gerado de `WHATSAPP_WEBHOOK_VERIFY_TOKEN` no painel da Meta.

Para separar o worker em outro serviço, crie um *Background Worker* com o mesmo Dockerfile, comando `node dist/worker.js`, as mesmas variáveis, e defina `RUN_WORKER_IN_API=false` na API.

## Vercel

Na Vercel o app vira **dois projetos** apontando para o mesmo repositório:

| Projeto | Root Directory | O que roda |
|---|---|---|
| Painel | `apps/web` | Next.js |
| API | `apps/api` | Fastify como função (entrada `apps/api/index.js`) |

- **Banco:** Neon (Storage → Create Database → Neon), conectado ao projeto da API. A integração cria `DATABASE_URL` e `DATABASE_URL_UNPOOLED`.
- **Build da API** (`apps/api/vercel.json` → `scripts/vercel-build.mjs`): gera o Prisma Client, compila, aplica as migrações (pela conexão direta) e roda o seed.
- **Fila sem worker contínuo:** com `VERCEL=1` a API entra em modo `SERVERLESS`: depois de cada requisição a fila é processada em segundo plano (`waitUntil`), e o cron diário `/cron/tick` (protegido por `CRON_SECRET`) cobre os períodos sem movimento. A sincronização da Meta é enfileirada sempre que estiver mais velha que `META_SYNC_CRON_MINUTES`.
- **Variáveis da API:** `JWT_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `CRON_SECRET`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `APP_ENV` e, ao ligar o WhatsApp, `META_APP_SECRET`.
- **Variável do painel:** `API_INTERNAL_URL=https://<projeto-da-api>.vercel.app`.
- O plano Hobby da Vercel é só para uso pessoal/não comercial; para uso na clínica, use o Pro.
