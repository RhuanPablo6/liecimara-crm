# Integração WhatsApp e coexistência

## Objetivo

Manter o **mesmo número** e o atendimento no **app WhatsApp Business** (celular e WhatsApp Web), e ao mesmo tempo receber pela Cloud API os eventos necessários para o CRM. O recurso oficial para isso é a **coexistência** (onboarding de usuários do WhatsApp Business app via Embedded Signup).

## Requisitos de elegibilidade (Meta)

Confira na documentação oficial antes de começar, pois os requisitos mudam:

- App WhatsApp Business **2.24.17 ou superior** no celular da clínica.
- Onboarding por **Embedded Signup** de um Solution Partner ou Tech Provider (direto, se a clínica tiver app Meta qualificado, ou por um parceiro/BSP).
- Assinatura dos campos de webhook: `messages`, `account_update`, `history`, `smb_app_state_sync`, `smb_message_echoes`.

## Limitações relevantes da coexistência

- Vazão fixa de 20 mensagens/segundo.
- Histórico de até 180 dias; grupos não são importados.
- Sincronização de contatos e de histórico: **uma vez por onboarding**, em até 24h.
- Recursos do app que deixam de valer ou ficam limitados: listas de transmissão (somente leitura), mensagens temporárias, visualização única e localização em tempo real. Mensagens automáticas (saudação/ausência), respostas rápidas e etiquetas não ficam disponíveis pela API.
- Mensagens enviadas pelo app **não** abrem janela de atendimento nem geram cobrança na Cloud API.
- Clientes acompanhantes não suportados (WhatsApp para Windows, WearOS) não geram eventos.

Valide esses pontos com a recepção antes de habilitar a coexistência.

## Eventos tratados

| Campo do webhook | Evento normalizado | Efeito no CRM |
|---|---|---|
| `messages` → `messages[]` | `MESSAGE_INBOUND` | AttributionEngine (lead, evidência, funil) |
| `messages` → `statuses[]` | `MESSAGE_STATUS` | Atualiza status sem regredir |
| `smb_message_echoes` | `MESSAGE_ECHO` | Registra resposta da recepção; NEW → CONTACTED; tempo de 1ª resposta |
| `smb_app_state_sync` | `CONTACT_SYNC` | Importa contatos como pré-existentes (não cria leads) |
| `history` | `HISTORY_MESSAGE` / `HISTORY_PROGRESS` | Importa mensagens antigas; não infla métricas |
| `account_update` | `ACCOUNT_UPDATE` | `PARTNER_REMOVED`/`ACCOUNT_OFFBOARDED` → desconectado; `ACCOUNT_RECONNECTED` → conectado |

A referência de anúncio vem em `messages[].referral`, com `source_type`, `source_id` (ID do anúncio), `source_url`, `headline`, `body`, `media_type` e `ctwa_clid`.

## Configuração (homologação primeiro)

1. No Meta for Developers, configure a URL de callback: `https://<api>/webhooks/whatsapp/cloud` (ou `/partner`) e o verify token (`WHATSAPP_WEBHOOK_VERIFY_TOKEN`).
2. Assine os campos listados acima.
3. Defina `META_APP_SECRET` na API (validação de assinatura).
4. Em **Integrações → WhatsApp**, informe o WABA ID, o Phone Number ID e o token de usuário do sistema.
5. Clique em **Executar diagnóstico**. O diagnóstico verifica:
   - escopos `whatsapp_business_management` e `whatsapp_business_messaging`;
   - validade do token;
   - app inscrito na WABA (`subscribed_apps`);
   - número acessível e coexistência ativa.
6. Envie uma mensagem de teste e confira em **Eventos recentes**.
7. Se aplicável, clique em **Sincronizar contatos** e **Importar histórico** (uma vez só).

## Parceiro de coexistência (BSP)

Use `POST /integrations/whatsapp/partner` com:

```json
{
  "apiKey": "<chave do parceiro>",
  "webhookSecret": "<segredo usado pelo parceiro para assinar>",
  "config": {
    "partnerName": "Nome do parceiro",
    "baseUrl": "https://api.parceiro.com",
    "authHeaderName": "D360-API-KEY",
    "phoneNumberId": "123",
    "webhookAuth": { "mode": "hmac-sha256", "header": "x-partner-signature", "prefix": "sha256=" }
  }
}
```

Modos de autenticação do webhook: `hmac-sha256`, `static-header` ou `none-ip-allowlist` (neste último, restrinja por IP no proxy reverso). Se o parceiro envelopar o payload Meta, informe `envelopeKey`.

## Reconexão

O procedimento aparece na tela de integrações e está em `IntegrationService.RECONNECT_PROCEDURE`. Em resumo: verificar o app no celular, rodar o diagnóstico, refazer o Embedded Signup se houver `PARTNER_REMOVED`/`ACCOUNT_OFFBOARDED` (sem trocar o número), atualizar o token se necessário, reinscrever os webhooks, testar e reprocessar eventos com falha.
