# Métricas e critérios

Cada número do painel tem um critério explícito (`GET /reports/definitions`, aba **Critérios**). Números da Meta e do CRM são exibidos lado a lado, com `comparable: false`.

| Métrica | Fonte | Critério |
|---|---|---|
| Mensagens | CRM | Mensagens individuais recebidas e enviadas no período (exclui histórico importado) |
| Conversas | CRM | Sequência com um contato; 24h sem mensagens inicia outra. Contada pela data de início |
| Leads únicos | CRM | Contatos distintos com lead aberto no período |
| Leads atribuídos | CRM | Leads com referência oficial (`referral.source_type = ad`) ou atribuição manual |
| Agendamentos | CRM | Criados no período; cancelados mostrados à parte |
| Vendas | CRM | Vendas ativas no período (um lead pode ter várias) |
| Procedimentos realizados | CRM | Marcados como realizados no período |
| Receita atribuída | CRM | Vendas ativas com atribuição oficial ou manual |
| Conversas iniciadas (Meta) | Meta | `onsite_conversion.messaging_conversation_started_7d`: modelo de atribuição da Meta, janela de 7 dias |
| Investimento | Meta | `spend` dos insights diários por anúncio |

## Indicadores derivados

- **Custo por lead atribuído** = investimento ÷ (leads oficiais + manuais).
- **ROAS** = receita atribuída ÷ investimento. Também exibido apenas com referência oficial.
- **Retorno sobre investimento** = (receita atribuída − investimento) ÷ investimento.

## Por que Meta e CRM divergem

- A Meta atribui conversas por modelo próprio e janela de 7 dias após o clique; o CRM só conta referências recebidas no webhook.
- Um contato pode iniciar várias conversas; o CRM o trata como um lead enquanto a oportunidade estiver aberta.
- Mensagens de clientes acompanhantes não suportados (WhatsApp para Windows/WearOS) não geram webhook.

Use a diferença como **indicador de cobertura**, não como erro.

## Snapshot de atribuição na venda

Cada venda guarda a atribuição vigente no momento do registro (`attributionConfidence`, `adMetaId`, `campaignMetaId`). Se o lead receber atribuição manual depois, as vendas que estavam como “desconhecida” são atualizadas, e a mudança fica na auditoria.
