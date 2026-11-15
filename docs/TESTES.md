# Testes

```bash
pnpm test        # node:test via tsx, sem banco
```

Arquivo: `apps/api/test/scenarios.test.ts`. Os webhooks são montados no formato real da Meta e **assinados** (`helpers.ts`), passando pelo mesmo caminho da produção: assinatura → normalização → deduplicação → fila → worker → processador → AttributionEngine.

| # | Cenário da diretriz | Teste | O que é verificado |
|---|---|---|---|
| 1 | Novo contato por anúncio com referência oficial | `1.` e `1b.` | Lead OFFICIAL_REFERRAL, anúncio/conjunto/campanha, evidência com `ctwa_clid`; anúncio ainda não sincronizado é resolvido depois |
| 2 | Contato sem referência | `2.` e `2b.` | UNKNOWN mesmo com anúncio ativo (sem presunção); referral de publicação não vira anúncio |
| 3 | Paciente existente envia nova mensagem | `3.` | Sem contato/lead duplicado; atribuição preservada; nova conversa após 24h; paciente importado não vira lead |
| 4 | Webhook recebido duas vezes | `4.` | 1 mensagem, 1 lead, 1 evidência, inclusive após reprocessar |
| 5 | Agenda e cancela | `5.` | SCHEDULED → CONTACTED, histórico de etapas, auditoria, métricas |
| 6 | Mais de uma compra | `6.` | 2 vendas, 1 lead, receita somada, bloqueio de pagamento acima do saldo |
| 7 | Lead perdido | `7.` | Motivo obrigatório, agendamento futuro cancelado, motivo nos relatórios, reabertura só com nova oportunidade |
| 8 | Meta indisponível | `8.` | DEGRADED, erro registrado, dados preservados, retry com backoff, recuperação; token inválido → DEAD/ERROR |
| 9 | Falha temporária do webhook | `9.` e `9b.` | Rollback sem dado parcial, sucesso na 3ª tentativa, DEAD → reprocessamento manual; assinatura inválida rejeitada |
| 10 | Venda atribuída manualmente | `10.` | Nota obrigatória, evidência MANUAL com autor, auditoria, receita manual separada; oficial não é sobrescrita |
| 11 | Mensagem do app recebida pela API | `11.` | Echo como OUTBOUND/BUSINESS_APP na mesma conversa, lead → CONTACTED, tempo de 1ª resposta |
| 12 | Evento fora de ordem | `12.` | Referral atrasado aplicado, abertura pelo horário real, primeiro toque por ocorrência, status sem regressão, status órfão IGNORED |

Extras: importação de histórico (sem leads, sem inflar métricas), `PARTNER_REMOVED`/`ACCOUNT_RECONNECTED`, cofre de credenciais, JWT/senha/RBAC, auditoria sem dados sensíveis e trava de produção.

## Testes recomendados em homologação

Os testes automatizados usam repositórios em memória. A camada Prisma, as rotas HTTP e o frontend devem ser validados no ambiente de homologação com o roteiro de [HOMOLOGACAO.md](HOMOLOGACAO.md).
