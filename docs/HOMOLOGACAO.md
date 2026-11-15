# Homologação antes do número de produção

> **Não migrar, desconectar ou modificar o número atual sem autorização explícita do administrador.**
> O CRM nunca chama endpoints de registro/desregistro de número. A coexistência é ativada pelo Embedded Signup, que é uma ação do administrador.

## 1. Ambiente de homologação

- `APP_ENV=homolog` (padrão). Conexões ficam marcadas como `HOMOLOG`.
- Banco separado do de produção.
- App Meta em modo de desenvolvimento, com **número de teste** da Meta (Cloud API) ou um número secundário da clínica.
- URL pública com HTTPS para os webhooks (ex.: subdomínio `crm-homolog.`).

## 2. Roteiro de testes

| # | Teste | Como | Esperado |
|---|---|---|---|
| 1 | Handshake | Cadastrar callback no app Meta | `GET` responde o `hub.challenge` |
| 2 | Assinatura | `curl` sem `X-Hub-Signature-256` | 401 e erro na tela |
| 3 | Lead de anúncio | `simulate:webhook ad` ou anúncio de teste | Lead com “Referência oficial” |
| 4 | Lead sem anúncio | `simulate:webhook plain` | Lead “Origem desconhecida” |
| 5 | Duplicado | `simulate:webhook duplicate` | 1 mensagem e 1 lead |
| 6 | Echo do app | Responder pelo app (coexistência) ou `simulate:webhook echo` | Lead vai para “Em atendimento” |
| 7 | Meta Marketing | Configurar conta de anúncios | Campanhas e investimento importados |
| 8 | Falha da Meta | Token inválido | Status “Erro”, dados anteriores preservados |
| 9 | Fluxo comercial | Agendar → cancelar → agendar → compareceu → venda → pagamento → realizado | Funil e relatórios coerentes |
| 10 | Perda | Marcar perdido com motivo | Motivo nos relatórios |
| 11 | Diagnóstico | “Executar diagnóstico” | Todos os itens verdes |
| 12 | Reprocessamento | Derrubar o banco durante um envio | Evento `FAILED` → `PROCESSED` após retry |

Rode também `pnpm test` (cenários automatizados).

## 3. Critério para avançar

- [ ] Todos os itens acima aprovados.
- [ ] Recepção validou as limitações da coexistência (ver INTEGRACAO_WHATSAPP.md).
- [ ] Backup do banco configurado.
- [ ] Administrador registrou por escrito a autorização para vincular o número de produção.

## 4. Vinculação do número de produção

1. Implantar com `APP_ENV=production` (exige `META_APP_SECRET` e `WHATSAPP_WEBHOOK_VERIFY_TOKEN`).
2. O **administrador** conclui o Embedded Signup escolhendo “Conectar app WhatsApp Business existente”, sem trocar o número.
3. Em **Integrações**, o administrador informa os IDs e envia `confirmProductionNumber: true`. Usuários sem perfil ADMIN são bloqueados.
4. Executar o diagnóstico e enviar uma mensagem de teste.
5. Acompanhar **Eventos recentes** nas primeiras 48h.
