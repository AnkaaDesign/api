# Bateria de ponta a ponta — PELA INTERFACE

Chromium de verdade, contra a `web` e a `api` locais, sobre um clone do acervo.
Nenhum passo é adiantado por chamada de endpoint: onde a interface não oferece
caminho, o cenário **falha** — um contorno por API esconderia exatamente o
defeito que a bateria procura.

## Nada sai da máquina

| integração | para onde aponta | o que acontece |
|---|---|---|
| Elotech (NFS-e municipal) | `127.0.0.1:9988/elotech` | responde sucesso plausível e **grava o corpo** |
| Sicredi (boleto) | `127.0.0.1:9988/sicredi` | idem |
| NFS-e Nacional, ClickSign, TSA | `127.0.0.1:9988/...` | aceita e grava |
| SMTP | Mailpit em `127.0.0.1:1026` (web em `:8026`) | retém todo e-mail |
| WhatsApp / Twilio / Firebase | desligados | `DISABLE_WHATSAPP=true`, chaves em branco |

A sentinela **responde sucesso em vez de recusar**. Recusar (o 503 da bateria
anterior) tornava o teste seguro e cego: a emissão parava no primeiro passo e
nada do que iria à prefeitura chegava a existir. Respondendo, a nota é
"autorizada", o boleto é "registrado", e o teste afirma sobre o corpo GRAVADO —
que é o que teria ido. Caminho não mapeado devolve 599 e é gravado como
vazamento, para não passar despercebido.

## Como rodar

```bash
tests/e2e-ui/start-stack.sh      # sentinela + api (3031) + web (5174)
npx tsx tests/e2e-ui/seed-fixtures.ts
tests/e2e-ui/run-all.sh
```

Credencial nenhuma está versionada: a `DATABASE_URL` do banco de teste sai da
`DATABASE_URL` do `.env` do repositório, trocando só o nome do banco
(`QA_DB_NAME`, padrão `ankaa_qa_e2e`). A senha dos usuários de teste vem de
`QA_PASS` (padrão `Teste@2026`, e só existe no clone).

As portas 3031/5174 são de propósito: não encostam numa sessão de
desenvolvimento já de pé em 3030/5173. O banco é `ankaa_qa_e2e`, clone de
`ankaa_production` local — acervo realista, isolado e descartável.

## As fases

| fase | o que percorre |
|---|---|
| `fase1-criacao` | assistente de orçamento: 1 veículo, 4 com fatura única, 4 com uma fatura por veículo, 4 com dois clientes de faturamento |
| `fase2-lotes` | compositor de lotes no detalhe: 2+2, recarregar, recompor 1+3, voltar a fatura única |
| `fase3-assinatura` | recortes por função, convite por signatário, cerimônia com código, contra-assinatura da Ankaa, selo PAdES |
| `fase4-faturamento` | aprovação do faturamento e o que iria à prefeitura e ao banco |

Cada fase cria o próprio orçamento com uma faixa de séries nova — série é única
no sistema, e repetir uma faz o save ser barrado por um toast enquanto a tela
fica parada no resumo.

## Onde olham as asserções

Três pontas, sempre: o que o **servidor gravou** (Prisma), o que **saiu**
(Mailpit e sentinela) e o que está **dentro do arquivo** (`pdftotext` no PDF
congelado). Conferir só uma delas deixa passar o caso em que a seção certa foi
congelada e o arquivo errado foi entregue.

Artefatos de cada corrida ficam em `artifacts/`: `findings-<fase>.json`, os
screenshots de cada falha, `integration-calls.jsonl` (tudo que iria para fora) e
os logs da api, do web e da sentinela.
