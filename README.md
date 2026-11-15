# Liecimara Ads CRM

CRM para rastrear leads que chegam pelo WhatsApp a partir de anúncios da Meta e acompanhar suas conversões comerciais (agendamento, venda, pagamento, procedimento realizado), mantendo o atendimento no aplicativo **WhatsApp Business** da clínica.

> **Princípio central:** atribuição só existe com evidência. O CRM aceita apenas a referência oficial do WhatsApp (`referral.source_type = "ad"`) ou a atribuição manual registrada por um usuário. Nunca presume a origem pelo anúncio mais recente ou por semelhança de mensagens.

## Estrutura

```
apps/
  api/                 Node.js + TypeScript (Fastify, Prisma, PostgreSQL)
    prisma/            schema.prisma e seed
    src/
      domain/          tipos e erros de domínio (sem dependência de ORM)
      ports/           interfaces de repositório
      modules/
        attribution/   AttributionEngine (motor de atribuição)
        funnel/        FunnelService (etapas, agenda, vendas, pagamentos, perdas, lembretes)
        metrics/       MetricsService (métricas, Meta × CRM, ROAS)
        whatsapp/      porta WhatsAppProvider, adaptadores, ingestão e processamento de webhooks
        meta/          Meta Marketing API (campanhas, anúncios, investimento)
        integrations/  configuração, diagnóstico e reconexão
        auth/, audit/  JWT, RBAC, auditoria
      queue/           fila persistente (PostgreSQL SKIP LOCKED) e worker com retry
      infra/           Prisma, memória (testes) e cofre de credenciais (AES-256-GCM)
      http/            rotas REST
    test/              12 cenários obrigatórios + segurança e coexistência
  web/                 Next.js 15 + Tailwind + shadcn/ui (azul-marinho e dourado)
docs/                  arquitetura, integração WhatsApp, métricas, implantação, homologação
```

## Início rápido (desenvolvimento)

Pré-requisitos: Node.js 22.9+, pnpm 9+, PostgreSQL 16 (ou Docker).

```bash
cp .env.example .env            # preencha JWT_SECRET, CREDENTIALS_ENCRYPTION_KEY etc.
pnpm install
pnpm db:migrate                 # aplica as migrações versionadas (prisma/migrations)
pnpm db:seed                    # administrador + catálogo de procedimentos
pnpm --filter @liecimara/api dev          # API em :4000
pnpm --filter @liecimara/api dev:worker   # worker (fila e sincronizações)
pnpm --filter @liecimara/web dev          # painel em :3000
```

Para simular a Meta sem tocar no número real:

```bash
pnpm --filter @liecimara/api simulate:webhook ad          # novo lead vindo de anúncio
pnpm --filter @liecimara/api simulate:webhook plain       # lead sem referência
pnpm --filter @liecimara/api simulate:webhook echo        # resposta enviada pelo app
pnpm --filter @liecimara/api simulate:webhook duplicate   # mesmo webhook duas vezes
```

## Testes

```bash
pnpm test
```

Os testes rodam sem banco (repositórios em memória com rollback transacional) e cobrem os 12 cenários da diretriz, além de coexistência e segurança. Veja [docs/TESTES.md](docs/TESTES.md).

## Documentação

- [Arquitetura](docs/ARQUITETURA.md)
- [Integração WhatsApp e coexistência](docs/INTEGRACAO_WHATSAPP.md)
- [Métricas e critérios](docs/METRICAS.md)
- [Homologação antes do número de produção](docs/HOMOLOGACAO.md)
- [Implantação](docs/IMPLANTACAO.md)
- [Testes](docs/TESTES.md)

## Regras que não podem ser quebradas

1. O CRM **não** migra, registra (`/register`), desregistra ou desconecta o número. Ele só recebe eventos e consulta dados.
2. Configurar o número de **produção** exige perfil ADMIN e confirmação explícita (`confirmProductionNumber`), e só deve ser feito após a homologação.
3. Contagens da Meta e do CRM são exibidas lado a lado com seus critérios, nunca como equivalentes.
