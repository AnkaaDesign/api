# Canal oficial de WhatsApp (Cloud API) — estado e procedimento de virada

Este arquivo existe para que o dia da virada seja uma checagem, e não uma
arqueologia. O desenho e o porquê estão em `BUDGET-SIGNATURE-DESIGN.md`; aqui
fica só o operacional: o que já está pronto, o que falta, e como ligar e
desligar.

## Estado em 13/09/2026 — conferido contra a Graph API, não de memória

| item | estado |
|---|---|
| WABA `2290478598374770` | `account_review_status: APPROVED`, negócio verificado |
| Número `+55 43 8863-5657` | `CONNECTED`, `code_verification_status: VERIFIED`, qualidade `GREEN` |
| Nome de exibição "Ankaa Design" | `PENDING_REVIEW` — **não bloqueia envio** (ver abaixo) |
| Token | usuário de sistema, `expires_at: 0` (permanente), com `whatsapp_business_messaging` e `_management` |
| Webhook | `https://api.ankaadesign.com.br/webhooks/whatsapp` ativo, campos `messages` e `message_template_status_update`; handshake testado |
| Meio de pagamento | adicionado |
| `WHATSAPP_CLOUD_ENABLED` em produção | `false` — **canal do cliente desligado de propósito** |

### O nome em revisão não impede nada

Com o número `CONNECTED` e os templates `APPROVED`, a Meta entrega hoje. O que o
`name_status` muda é só o que o destinatário lê no topo da conversa: enquanto
estiver `PENDING_REVIEW`, aparece o número em vez de "Ankaa Design". É motivo
legítimo para *esperar* antes do primeiro cliente — não é trava técnica. Nome
recusado também não quebra envio: reenvia-se o nome.

## Templates

O catálogo do código (`signature-whatsapp-templates.ts`) é o contrato: nome,
idioma, quantidade e ordem das variáveis. O TEXTO mora na Meta.

| template | usado em | corpo | botão |
|---|---|---|---|
| `orcamento_para_assinar` | convite e reenvio | 3 variáveis | URL com `{{1}}` = token |
| `orcamento_codigo` | OTP (AUTHENTICATION) | 1 variável | copiar código |
| `orcamento_assinatura_cancelada` | documento mudou | 2 variáveis | — |
| `orcamento_aguardando_assinatura` | lembrete diário (09:00) | 3 variáveis | URL com `{{1}}` = token |
| `orcamento_vencido` | validade encerrada | 2 variáveis | **telefone do comercial (estático)** |

Os três primeiros estão `APPROVED` e são os únicos que `main` usa hoje. Os dois
últimos foram submetidos em 13/09/2026 e pertencem ao fluxo que vive em
`feat/orcamento-multitarefa` — lembrete e vencimento.

### `orcamento_vencido` é MARKETING, e isso foi aceito

Submetido como UTILITY, a Meta reclassificou para MARKETING — provavelmente pela
frase que promete a proposta atualizada. **Decisão de 13/09/2026: fica como
está.** Marketing custa ~8× a utility e pode ser silenciado pelo destinatário,
mas o vencimento é a exceção da exceção: 2 em 43 envelopes até aqui, e o
lembrete diário existe justamente para que não se chegue lá. Não é descuido —
não "conserte" editando o corpo sem antes rever esta conta.

O botão de telefone do `orcamento_vencido` é **estático**: a Meta o resolve no
aparelho e ele não consome parâmetro de envio. É por isso que `expiredTemplate`
manda só as duas variáveis do corpo e mesmo assim o template tem botão.

Conferir a qualquer momento:

```bash
npm run test:whatsapp-templates
```

Sai 0 quando os cinco contratos batem. Reprova quando um template é editado no
painel e ganha/perde variável, quando a Meta pausa um por qualidade, e quando o
prefixo do botão de URL diverge de `SIGNATURE_WEB_URL`/`WEB_APP_URL`. Sem
credencial no ambiente, sai 0 avisando que não havia o que conferir — ou seja,
em máquina de desenvolvimento ele não prova nada.

## Ligar (quando os templates estiverem `APPROVED`)

Na ordem. As duas primeiras linhas sem a terceira não fazem nada, e a terceira
sem as duas primeiras também não.

1. `npm run test:whatsapp-templates` — tem de sair limpo.
2. Deploy do código que envia (o remetente da Cloud API precisa estar no `dist/`;
   conferir `dist/build-info.json` contra `git log -1` antes de reiniciar — ver
   o histórico do restart em `ankaa-api.service`).
3. `.env` de produção:
   - `WHATSAPP_CLOUD_ENABLED=true` — liga o canal do cliente.
   - `SIGNATURE_DELIVERY_CHANNEL=whatsapp` ou `both` — sem isto o envelope
     continua nascendo `EMAIL_OTP` e nada muda.
4. Reiniciar a API.
5. Primeira coleta num número interno, conferindo no log o `wamid` e os status
   `sent → delivered → read` que o webhook devolve.

## Desligar

`WHATSAPP_CLOUD_ENABLED=false` e reiniciar. A cerimônia volta ao Baileys/e-mail
sem recompilar nada. É o botão de pânico para template pausado por qualidade no
meio de uma coleta.

Atenção ao que **não** volta: o canal fica gravado em `EnvelopeSigner.authMethod`
na emissão. Coleta que nasceu em WhatsApp continua pedindo OTP por WhatsApp até
o fim, mesmo com a chave desligada.
