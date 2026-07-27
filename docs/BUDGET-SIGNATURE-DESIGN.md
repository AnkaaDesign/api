# Assinatura eletrônica do Orçamento — Design

**Status:** proposta · **Data:** 2026-07-26 · **Escopo:** api + web

Fluxo de assinatura eletrônica multi-signatário para o Orçamento (`TaskQuote`), assinado
pelos `Responsible` da `Task` (contatos do cliente, sem conta no sistema) e pelo
representante comercial da Ankaa, com autenticação por CPF + código OTP no WhatsApp,
trilha de auditoria encadeada e selo PAdES com o certificado A1 ICP-Brasil.

---

## 1. As cinco decisões que definem o projeto

| # | Decisão | Resposta |
|---|---|---|
| 1 | **Como resolver o PDF gerado sob demanda?** | Renderizar **server-side com Playwright** a partir do HTML que já existe, **congelar os bytes** no momento do envio, e nunca mais regerar. Determinismo deixa de importar. |
| 2 | **Quantos selos criptográficos?** | **UM só**, no final, com o A1 da Ankaa, depois que todos assinaram. Os signatários não têm certificado — o ato deles é *prova*, não criptografia. |
| 3 | **Quem escolhe o número do WhatsApp?** | **A Ankaa, nunca o signatário.** O telefone vem do cadastro, aparece mascarado e travado. Isso é o que sustenta o valor probatório do OTP. |
| 4 | **Onde está o risco jurídico real?** | Não na validade (é válida). No **CPC art. 429, II**: se o cliente impugnar a autenticidade, o ônus da prova é da Ankaa. E na **autoridade** do signatário para obrigar a empresa — não na identidade dele. |
| 5 | **Qual a máscara de CPF?** | `***.456.789-**` (oculta 3 primeiros + 2 últimos). Tem lastro normativo. `11*.***...` é convenção bancária sem respaldo legal. |

**Custo estimado de operação:** R$ 0,80/orçamento (Datavalid) + ~R$ 0,90 (QSA, opcional) +
R$ 0,50–4,00 (carimbo do tempo) + OTP. Abaixo de R$ 10/orçamento em qualquer cenário.

---

## 2. O bloqueio declarado: "o PDF é gerado sob demanda"

### 2.1 O diagnóstico é pior do que parecia

Hoje existem **dois geradores independentes**, e **nenhum** produz bytes estáveis:

| | Web | Flutter |
|---|---|---|
| Arquivo | `web/src/utils/budget-pdf-generator.ts` (1181 linhas) | `mobile-flutter/lib/features/financial/budget/budget_pdf_generator.dart` |
| Técnica | string HTML + `window.print()` | `package:pdf` on-device |
| Quem renderiza | **o navegador do usuário** | o aparelho |
| Bytes persistidos | **nenhum** | temp dir, sobrescrito |

Problemas que inviabilizam assinar o que existe hoje:

1. **O web nem usa biblioteca de PDF.** `window.print()` entrega ao pipeline de impressão do
   navegador. Tamanho de página, escala, "gráficos de plano de fundo" e destino são escolhas
   do usuário no diálogo de impressão. A aplicação **não consegue nem observar** o resultado.
2. **A fonte é `'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`** (`budget-pdf-generator.ts:634`)
   — proprietária da Microsoft, ausente em Linux/macOS. O mesmo "documento" pagina diferente
   por sistema operacional.
3. **O conteúdo muda sozinho todo dia.** `Validade: N dias` é recalculado contra `new Date()`
   a cada render (`web/src/pages/public/budget/[id].tsx:253-255`) e, ao chegar a zero, vira um
   **"Vencido" em vermelho e negrito** que re-flui o layout (`budget-pdf-generator.ts:1017`).
   Um orçamento assinado, reaberto amanhã, é literalmente outro documento.
4. **O Flutter escreve um `/ID` aleatório em todo `save()`** (`pdf-3.12.0/lib/src/pdf/document.dart:178-191`).
   Entrada idêntica com relógio congelado ainda gera bytes diferentes.
5. **Bônus — bug latente:** `formatMoney` (`mobile-flutter/lib/shared/format/number_format.dart:42`)
   retorna `R$ ••••••` (U+2022) quando "Ocultar Valores" está ativo, que é o **padrão em todo cold start**.
   Helvetica base é Latin-1 → `doc.save()` lança exceção → `quote_share_sheet.dart:75-77` engole
   num toast genérico. **O compartilhamento de orçamento pelo Flutter quebra silenciosamente hoje.**

### 2.2 A solução, e por que ela é barata

> **Determinismo só importa se você pretende re-renderizar. Se você congela os bytes, ele deixa de importar.**

Essa é a chave. Todas as plataformas do mercado (Clicksign, ZapSign, D4Sign, Autentique)
recebem um upload de bytes e **nunca re-renderizam nada**. O hash é do arquivo original,
calculado uma vez, no upload.

Então: renderize **uma vez, no servidor, no momento "Enviar para assinatura"**, guarde os bytes,
tire o SHA-256, e trate aquilo como o documento — para sempre.

**E o custo disso é quase zero, porque a infra já está no repositório:**

```
api/package.json  →  "playwright": "^1.60.0"   (dependencies, não devDependencies)
api/Dockerfile:105 →  # chromium + libs: Required for Playwright (SecullumBrowserSignerService)
api/Dockerfile:109 →  chromium nss freetype harfbuzz ca-certificates ttf-freefont
api/package.json  →  pdfkit ^0.15.1 · pdf-lib ^1.17.1 · @signpdf/* ^3.3.0 · node-forge ^1.4.0
```

Playwright e Chromium **já rodam em produção** (`SecullumBrowserSignerService`). pdfkit, pdf-lib
e o signer PAdES já existem. **Nenhuma dependência nova.**

### 2.3 Por que Playwright e não portar o layout para pdfkit

Três razões, em ordem de peso:

1. **WYSIWYS de verdade.** O cliente já revisa o orçamento em `/cliente/orcamento/:id`, que é
   HTML. Renderizar o PDF assinado do **mesmo HTML** torna literalmente verdadeira a frase
   "o que você viu é o que você assinou" — que é o requisito do OWASP Transaction Authorization §1.1
   e o argumento mais forte contra "eu não vi isso".
2. **Evita um terceiro port.** O motor `calculateAdaptiveLayout` (compressão em 3 fases para
   caber N serviços numa folha) já foi portado uma vez para o Dart. Reimplementar em pdfkit
   seria a terceira cópia da mesma lógica, com três oportunidades de divergir.
3. **Mata a divergência web↔Flutter.** Passa a existir **um** artefato canônico, gerado no servidor.
   Web e Flutter viram meros *visualizadores* do PDF congelado.

**Gotcha obrigatório:** o container tem `ttf-freefont`, mas **não tem Segoe UI**. Sem correção,
o PDF do servidor sai com FreeSans e não parecerá com o que o usuário Windows vê hoje.
→ Trocar para **Inter**, que o web já auto-hospeda (`@fontsource-variable/inter`), e embutir o
`.woff2`/`.ttf` como data-URI no HTML de render, ou instalar o TTF na imagem. Fonte fixa no repo,
nunca fonte do sistema.

### 2.4 Pipeline

```
POST /task-quotes/:id/signature-envelope          (ADMIN | COMMERCIAL)
  1. Playwright renderiza generateBudgetHtml(data) com emulateMediaType('print')
       → original.pdf  ·  linhas de assinatura VAZIAS (é o que o signatário revisa)
  2. page.evaluate() devolve o boundingClientRect de cada [data-signature-slot="<signerId>"]
       → coordenadas CSS px → pontos PDF, guardadas em Envelope.anchors (Json)
  3. originalSha256 = sha256(bytes)
  4. grava em FILES_ROOT/Clientes/<cliente>/Orcamentos/envelopes/<uuid>/original.pdf
  5. INSERT Envelope + EnvelopeSigner[] + evento ENVELOPE_CREATED (encadeado)
  6. TaskQuote fica TRAVADO para edição material enquanto o envelope estiver RUNNING
```

O passo 6 não é opcional: se alguém editar o orçamento no meio da cerimônia, o signatário
assinou uma coisa e o sistema guarda outra. **Editar campo material com envelope RUNNING
deve cancelar o envelope e exigir reemissão** (OWASP Transaction Authorization §2.6). A
infraestrutura para isso já existe em `task-quote.guards.ts` (`QUOTE_STATUS_LOCKED`,
`QUOTE_SAFE_AFTER_BILLING_FIELDS`) — é estender o mesmo padrão.

O passo 2 (âncoras por `getBoundingClientRect`) é o que permite carimbar o selo **exatamente
acima da linha de assinatura de cada responsável**, como pedido, mantendo `final.pdf` =
`original.pdf` + overlay. Sem isso, sobra re-renderizar com os selos dentro, e aí você perde a
relação demonstrável entre o que foi assinado e o que foi entregue.

---

## 3. O que já existe (e o que não existe)

### 3.1 O "fluxo de assinatura" atual do orçamento é uma ilusão

- `POST /task-quotes/public/:id/signature` (`task-quote.controller.ts:355-377`, `@Public()`)
  aceita **upload de uma imagem PNG/JPEG** e grava em `TaskQuoteCustomerConfig.customerSignatureId`.
- **Não altera o status da quote** (`task-quote.service.ts:2826-2958`), embora a UI afirme
  *"Assinatura enviada com sucesso! O orçamento foi confirmado."* (`web/src/pages/public/budget/[id].tsx:774`).
- Grava **um** registro de changelog com `userId: null`, sem IP, sem user-agent, sem hash,
  sem consentimento, e **sem saber qual `Responsible` assinou**.
- O `File` criado aponta para `file.path` do multer — **fica no `uploads/temp`** e é elegível
  para a varredura de órfãos de 7 dias (`file-cleanup-scheduler.service.ts`).
- Proteção do endpoint: **o UUID da quote**. O próprio comentário do controller admite
  (`task-quote.controller.ts:349-353`): *"There is no dedicated share token — the unguessable
  quote UUID is the link capability."*

Ou seja: não há nada a preservar. É greenfield.

### 3.2 O fluxo de EPI é o molde certo — com três defeitos a não copiar

`PpeDeliverySignature` (`schema.prisma:498-563`) é um modelo de evidência maduro:
identidade + CPF, device fingerprint, geo arredondada a 4 casas (LGPD), timestamps duplos
cliente/servidor, `evidenceHash`, `hmacSignature`, `documentSha256`, bloco PAdES
(`certSubject/Issuer/SerialNumber/Cnpj/NotAfter`), `legalBasis`, `consentGiven`, mais
`PpeDeliverySignatureEvent` com 17 tipos. `WarningSignature` e `AdmissionSignature` já
provaram que o padrão generaliza.

**`PpePadesSignerService` e `CadesP12Signer` já são entity-agnostic** (recebem `Buffer`,
devolvem `Buffer`) e são o código mais difícil daqui — o `id-aa-signingCertificateV2` que o
validador do ITI exige custou trabalho. `warning.module.ts:14-16` diz explicitamente que foi
feito para ser reusado. **Reaproveitar verbatim, apenas movendo para `common/signature`.**

Não copiar:

1. **O double-render.** `ppe-inapp-signature.service.ts:255-306` gera o PDF, tira o hash, e
   **regera com o hash impresso dentro**. O `documentSha256` gravado é o hash do render #1,
   que foi descartado; o arquivo salvo é o render #2. **O hash guardado é de um PDF que nunca
   existiu em disco e nunca pode ser recomputado.** Mesmo bug em `warning-signature.service.ts:739/749`.
   → O padrão certo já existe no repo: `admission-signature.service.ts:222-258` — hasheia os
   bytes persistidos, sela, guarda `fileId` e `signedFileId` separados.
2. **PAdES-B-B sem carimbo do tempo.** Para um funcionário, o relógio da empresa passa. Para
   uma contraparte comercial em litígio, é a primeira coisa atacada.
3. **Nenhuma verificação real.** `documentSha256` **nunca é lido de volta** por código algum.
   Não existe nada que re-hasheie o arquivo e compare. Não existe validação da assinatura PAdES.

### 3.3 Lacunas de dados que travam o desenho

| Fato | Onde | Consequência |
|---|---|---|
| **`Responsible` não tem CPF** | `schema.prisma:2947-2984`; ausente também em `schemas/responsible.ts` e na UI | O CPF terá que ser digitado no ato — o que na verdade é *melhor* (ver §5.2) |
| **`Responsible.phone` é `@unique` e obrigatório** | `schema.prisma:2950` | Dois contatos de empresas diferentes não podem dividir um telefone de escritório |
| **Não existe representante comercial interno** | Nenhum `salesRepId`/`sellerId` em `TaskQuote` ou `Task` | Precisa ser criado ou derivado (§5.4) |
| **A assinatura do diretor é uma imagem estática** | `web/public/sergio-signature.webp`, hardcoded em `[id].tsx:693` e `budget-pdf-generator.ts:1130` | Hoje o "lado Ankaa" não é assinado, é decorado |
| **`Responsible` já tem colunas de auth dormentes** | `password`, `sessionToken`, `verificationCode`, `verificationExpiresAt`, `resetToken`, `lastLoginAt` | Existe login `@Public()` que **nada no front consome**. Não reusar (§7.3) |

---

## 4. O alvo jurídico

Detalhamento e citações completas na pesquisa; aqui só o que muda o desenho.

### 4.1 Validade não é o problema

- **CC art. 107** — a forma é livre salvo quando a lei exigir. Nenhuma lei prescreve forma para
  contrato de pintura/plotagem de veículo.
- **MP 2.200-2/2001, art. 10 §2º** — admite expressamente "outro meio de comprovação da autoria
  e integridade", inclusive sem ICP-Brasil, **"desde que admitido pelas partes como válido ou
  aceito pela pessoa a quem for oposto o documento"**.
- **Lei 14.063/2020 NÃO se aplica.** Art. 2º, parágrafo único, II, "a" exclui expressamente a
  "interação entre pessoas naturais ou entre pessoas jurídicas de direito privado". Afirmações
  de que a lei "exige assinatura avançada" para contratos privados são **juridicamente erradas**.
  Ainda assim, os tribunais usam o art. 4º, II como *régua de qualidade* — vale projetar para ela.
- **STJ, REsp 2.159.442** (3ª Turma, Nancy Andrighi, 03/12/2024, unânime) — validou CCB assinada
  via Clicksign; falta de credenciamento ICP-Brasil, **por si só**, não invalida. Foi decisivo o
  fato de as partes terem contratado "assinatura eletrônica via plataforma indicada pelo credor".
- **STJ, REsp 2.197.156** (18/03/2026) — a aceitação do §2º **pode ser tácita**, inferida da
  conduta; e impugnação genérica sem indício de fraude não derruba o contrato.

### 4.2 O problema é o CPC art. 429, II

| | ICP-Brasil (§1º) | Não-ICP (§2º) |
|---|---|---|
| Presunção de autoria | **sim**, *ex lege* | **não** |
| Se a contraparte impugna autenticidade | quem nega tem que derrubar | **a Ankaa tem que provar** |

E o advogado competente **sempre** escolherá impugnar autenticidade ("não reconheço esta
assinatura") em vez de arguir falsidade ("este documento é falso") — porque falsidade tem ônus
dele (art. 429, I) e prazo preclusivo (art. 430). Projete para o pior caso.

O contrapeso é o **art. 369**: liberdade probatória total. A trilha de auditoria **é** o caso.

### 4.3 As duas alavancas de maior retorno

**(1) Cláusula de aceitação do meio, dentro do orçamento.** É o gancho literal do §2º e foi o
que ganhou o REsp 2.159.442. Sem ela, você litiga aceitação tácita — vencível, mas é uma briga
que dava para não comprar. Custo: um parágrafo. Ver §9.

**(2) Carimbo do tempo de ACT credenciada.** Toda a sua evidência é auto-gerada: seu servidor,
seu relógio, seu banco. A objeção estruturalmente irrespondível é *"vocês controlam esse relógio"*.
Um token RFC 3161 de terceiro independente quebra o conflito de interesse, e **defende contra
duas acusações ao mesmo tempo**: que o signatário retrodatou, e que **a Ankaa** retrodatou o
próprio banco.

O cliente TSA **já existe e é recuperável**:
```bash
git show f60af3c:src/modules/inventory/ppe/ppe-tsa-client.ts   # 202 linhas, sem dependência externa
git show 60f0dac -- src/modules/inventory/ppe/ppe-cades-signer.ts   # reverter as remoções B-T
```
Foi adicionado e removido no mesmo dia (2026-06-02). O docstring dele já diz exatamente o motivo
pelo qual você precisa dele de volta.

### 4.4 O risco real não é identidade — é autoridade

A disputa provável **não** é "um impostor se passou pelo gestor de frota". É **"o gestor de frota
assinou, mas não tinha poderes para obrigar a empresa"**. Nenhuma plataforma do mercado resolve isso.

- **CC art. 118** — o representante deve provar a quem trata sua qualidade e a extensão de seus
  poderes, **sob pena de responder pessoalmente** pelos excessos. É isso que justifica exigir uma
  declaração de autoridade em checkbox próprio: a lei já põe o ônus nele.
- **CC art. 1.015, p.ú.** — o excesso só é oponível a terceiro se (I) a limitação estiver averbada,
  (II) o terceiro conhecia, ou (III) a operação for evidentemente estranha ao objeto social.
- **Enunciado 11 da I Jornada de Direito Comercial (CJF)** + **STJ REsp 448.471/MG** — aplicação
  à luz da **teoria da aparência** e da boa-fé objetiva.

Pintar e plotar a frota **não é** "evidentemente estranho aos negócios" de uma transportadora, e
limites internos raramente estão averbados. **Pelo teste do STJ, a Ankaa ganha — desde que esteja
de boa-fé e consiga prová-lo.** Logo: o trabalho da plataforma não é *verificar* autoridade. É
**fabricar prova durável e datada da boa-fé da Ankaa**.

Controles, por relação valor/esforço:
1. **★ Casar o CPF do signatário com o QSA do CNPJ.** Serpro Consulta CNPJ tier "Consulta QSA",
   **R$ 0,8683** (faixa 1–999/mês). Se o CPF está no quadro de sócios/administradores, autoridade
   é praticamente conclusiva. Alternativas gratuitas: BrasilAPI, ReceitaWS, CNPJá. **Maior alavanca
   do projeto inteiro, por menos de R$ 1.**
2. **Campo `cargo` obrigatório, impresso no selo.** Nem Clicksign nem Autentique imprimem cargo.
   Custo zero, e é exatamente o que o art. 118 quer ver.
3. **Declaração de autoridade em checkbox separado**, com timestamp e IP próprios.
4. **Diretor da Ankaa assina por último**, vendo quem assinou do outro lado.
5. **Notificar a empresa, não só a pessoa** — cópia do PDF assinado para o e-mail do cadastro
   (financeiro/contato principal). Mata a tese "a empresa nunca soube". Custo zero.

### 4.5 CDC provavelmente não se aplica

Transportadora comprando pintura de frota adquire **insumo**, não é destinatária final. Pela
*teoria finalista mitigada* do STJ, o ônus de provar vulnerabilidade é da PJ, e o STJ rejeita
consistentemente para insumos (REsp 2.020.811, REsp 1.497.574, REsp 2.001.086).

Ganha-se: cláusula de limitação de responsabilidade é exequível (CDC art. 51, I não se aplica).
**Não** se ganha: o CPC art. 429, II continua valendo — B2B não alivia nada no ônus da prova.
E **CC arts. 423/424** (controle de contrato de adesão) continuam valendo.

### 4.6 Não construa em cima da força executiva

**CPC art. 784 §4º** (Lei 14.620/2023) dispensa testemunhas em título eletrônico "quando sua
integridade for conferida por **provedor de assinatura**". O termo **não é definido em lugar
nenhum da legislação brasileira**, e a razão histórica do dispositivo (a certificadora substitui
as testemunhas) sugere independência — o que um sistema construído pelo próprio credor
provavelmente não satisfaz.

→ Planeje para **ação monitória** (CPC art. 700), que exige apenas "prova escrita sem eficácia de
título executivo" — barra que o orçamento assinado supera com folga. Força executiva é upside,
não plano.

---

## 5. Arquitetura

### 5.1 Forma geral

Não invente: é o modelo do mercado, e a peça mais cara você já tem.

> Os signatários **não recebem certificado**. O ato de cada um é capturado como **evidência**
> (desafio OTP + IP + user-agent + timestamp + geo), escrito num **log anexado como páginas
> extras do PDF**, e então a **plataforma** aplica **um** selo criptográfico com **o próprio**
> certificado ICP-Brasil sobre o artefato montado.

Isso produz uma **assinatura eletrônica avançada** — exatamente o que o STJ validou no
REsp 2.159.442. Você não está sem um componente; está sem a *camada de cerimônia e evidência*
em volta do selo que já funciona.

### 5.2 Modelo de dados

Novo módulo `api/src/modules/common/signature/`, com o signer PAdES movido para lá.

```prisma
model SignatureEnvelope {
  id                  String   @id @default(uuid())
  quoteId             String                       // → TaskQuote
  status              EnvelopeStatus @default(DRAFT)   // DRAFT RUNNING COMPLETED REFUSED EXPIRED CANCELLED
  sequential          Boolean  @default(true)      // Ankaa assina por último
  deadlineAt          DateTime                     // espelha TaskQuote.expiresAt

  originalFileId      String                       // bytes CONGELADOS
  originalSha256      String
  anchors             Json                         // { signerId: {page,x,y,w,h} } do getBoundingClientRect
  quoteSnapshot       Json                         // JCS-canônico dos termos
  quoteSnapshotSha256 String

  finalFileId         String?                      // artefato selado
  finalSha256         String?
  sealedAt            DateTime?
  padesLevel          String?                      // "B-B" | "B-T"
  certSubject         String?
  certIssuer          String?
  certSerialNumber    String?
  certCnpj            String?
  certNotAfter        DateTime?
  tsaUrl              String?
  tsaGenTime          DateTime?

  verificationCode    String   @unique             // base32 legível: A7K9-2FMQ-XR4T
  legalBasis          String   @default("MP 2.200-2/2001, art. 10, §2º")

  signers             EnvelopeSigner[]
  events              SignatureAuditEvent[]
  @@index([quoteId]) @@index([status])
}

model EnvelopeSigner {
  id             String   @id @default(uuid())
  envelopeId     String
  orderGroup     Int      @default(0)              // 0 = cliente (paralelo), 1 = Ankaa

  // vínculo polimórfico: contato externo OU usuário interno
  responsibleId  String?                           // → Responsible
  userId         String?                           // → User (representante comercial)

  // o que a Ankaa AFIRMA (do cadastro, travado)
  declaredName   String
  declaredPhone  String                            // destino do OTP — signatário NÃO edita
  declaredCpf    String?
  phoneSource    String                            // "customer_registry" | "operator_entered"

  // o que o SIGNATÁRIO informa no ato
  informedCpf    String?
  informedCargo  String?
  cpfMatch       Boolean?                          // declaredCpf vs informedCpf
  qsaMatch       Boolean?                          // informedCpf ∈ QSA do CNPJ
  cpfRfbStatus   String?                           // resultado Datavalid, sem armazenar o registro

  status         SignerStatus @default(PENDING)    // PENDING VIEWED AUTHENTICATED SIGNED REFUSED EXPIRED
  accessToken    String   @unique                  // 256 bits, opaco, no link
  tokenExpiresAt DateTime

  firstViewedAt  DateTime?
  lastViewedAt   DateTime?
  timesViewed    Int      @default(0)
  maxPageReached Int?
  signedAt       DateTime?                         // relógio do SERVIDOR
  clientSignedAt DateTime?                         // relógio do cliente (prova de skew)
  refusedAt      DateTime?
  refusalReason  String?

  ipAddress      String?
  userAgent      String?
  geoLat         Decimal? @db.Decimal(9,6)         // 4 casas, minimização LGPD
  geoLon         Decimal? @db.Decimal(9,6)
  geoAccuracyM   Int?
  geoSource      String?                           // "gps" | "ip" | "denied"

  declarations   Json?                             // texto exato de cada checkbox + timestamp
  evidenceJson   Json?
  evidenceHash   String?
  hmacSignature  String?

  @@unique([envelopeId, responsibleId])
  @@index([accessToken])
}

model SigningChallenge {                            // OTP — NÃO reusar VerificationService
  id              String   @id @default(uuid())
  signerId        String
  channel         String                            // "whatsapp" | "sms"
  destinationMask String                            // "+55 43 9****-3228" — exibível
  codeHash        String                            // HMAC-SHA256(code, pepper). NUNCA o código
  documentSha256  String                            // vincula o código a ESTE documento
  status          String   @default("PENDING")      // PENDING CONSUMED LOCKED EXPIRED SUPERSEDED
  attempts        Int      @default(0)
  maxAttempts     Int      @default(5)
  expiresAt       DateTime                          // now + 5 min
  providerMessageId String?                         // wamid.XXX
  providerStatus    String?                         // sent|delivered|read
  deliveredAt       DateTime?
  consumedAt        DateTime?
  createdAt       DateTime @default(now())
  @@index([signerId, status])
}

model SignatureAuditEvent {                          // APPEND-ONLY, encadeado por hash
  id           String   @id @default(uuid())
  envelopeId   String
  sequence     Int
  eventType    SignatureEventType
  occurredAt   DateTime @default(now())              // sempre UTC
  actorType    String                                // SIGNER | OPERATOR | SYSTEM
  actorId      String?
  actorLabel   String?
  ipAddress    String?
  userAgent    String?
  documentHash String?
  payload      Json?
  prevHash     String
  hash         String   @unique                      // SHA256(prevHash || JCS(campos canônicos))
  @@unique([envelopeId, sequence])
  @@index([envelopeId, sequence])
}

enum SignatureEventType {
  ENVELOPE_CREATED   DOCUMENT_FROZEN     INVITATION_SENT    INVITATION_DELIVERED
  DOCUMENT_VIEWED    DOCUMENT_SCROLLED_END
  CPF_SUBMITTED      CPF_VALIDATED       CPF_MISMATCH       QSA_CHECKED
  OTP_SENT           OTP_DELIVERED       OTP_VERIFIED       OTP_FAILED       OTP_LOCKED
  DECLARATIONS_ACCEPTED  SIGNATURE_APPLIED  SIGNATURE_REFUSED
  CONTACT_CHANGED    ENVELOPE_EXPIRED    ENVELOPE_CANCELLED
  DOCUMENT_ASSEMBLED PADES_SEALED        PADES_FAILED      TSA_STAMPED
  DOCUMENT_FINALIZED DOCUMENT_DOWNLOADED VERIFICATION_VIEWED
}
```

**Por que CPF digitado no ato é melhor do que CPF no cadastro:** é exatamente o padrão da
Clicksign, visível no log real que a pesquisa extraiu — o operador declara
(*"Dados informados pelo Operador para validação do signatário: nome completo Renan Lima Alves
e CPF 008.528.430-03"*) e depois o signatário digita (*"CPF informado: 077.060.637-71"*).
**As duas afirmações ficam registradas lado a lado.** Isso é evidência de dois lados, não de um.
Guarde ambos e registre a divergência — divergência é fato auditável, não necessariamente bloqueio.

### 5.3 A cerimônia (o que o signatário faz)

Alvo: **90 segundos, no celular, sem app, sem desenhar nada.**

```
1. WhatsApp: "Orçamento nº 1234 — Ankaa Design. Revise e assine: ankaa.../assinar/<token>"
2. Abre → vê o orçamento (pdf.js em canvas, NÃO <iframe>)
3. Rola até a última página → botão "Assinar" habilita        [DOCUMENT_SCROLLED_END]
4. Nome: pré-preenchido e TRAVADO (vem do cadastro)
   CPF: digita — máscara + mod-11 ao vivo                     [CPF_SUBMITTED]
   Cargo: digita (obrigatório)
   WhatsApp: EXIBIDO MASCARADO E TRAVADO — só confirma
5. "Enviar código" → OTP de 6 dígitos no WhatsApp             [OTP_SENT/DELIVERED]
6. Digita o código                                            [OTP_VERIFIED]
7. Tela de declarações — QUATRO checkboxes separados          [DECLARATIONS_ACCEPTED]
8. "Assinar orçamento"                                        [SIGNATURE_APPLIED]
9. Vê o selo aparecer + recebe o PDF por e-mail
```

**O ponto não negociável é o passo 4:** o signatário **não escolhe** o número que recebe o código.
Se ele escolhe, o OTP prova apenas que ele controla o telefone que ele mesmo digitou — que é
exatamente nada. O telefone vem do cadastro do cliente, aparece mascarado, e trocá-lo é uma
**operação do operador Ankaa que gera evento `CONTACT_CHANGED` no log** (a Clicksign faz
literalmente isso; a linha real aparece no log extraído pela pesquisa). ZapSign modela como
`lock_phone`/`lock_email`/`lock_name`.

**Rolagem:** nenhuma plataforma do mercado obriga rolar o documento inteiro. Mas todas registram
`visualizou` e `assinou` como **eventos distintos com IP** — e o intervalo entre eles *é* a
prova de tempo de leitura, que sobrevive num PDF que o juiz lê. Habilitar o botão na última
página (um `IntersectionObserver` com pdf.js) é barato e melhor do que rolagem-prisão.

**Declarações — quatro checkboxes separados, não um.** O de autoridade precisa ser ato afirmativo
próprio, com timestamp próprio, porque é o que você vai precisar em juízo. Texto em §9.

### 5.4 O signatário Ankaa

Hoje o "lado Ankaa" não é assinado — é uma imagem estática de assinatura
(`web/public/sergio-signature.webp`) com `directorName: "Sergio Rodrigues"` /
`directorTitle: "Diretor Comercial"` (`web/src/config/company.ts:16-17`).

Como não existe representante comercial atribuído à quote (nenhum `salesRepId` no schema), há
duas saídas:

- **(a) Adicionar `TaskQuote.commercialUserId → User`**, preenchido na criação a partir do
  usuário logado quando ele for COMMERCIAL, com fallback para o diretor. Explícito e simples.
- **(b) Derivar de `ServiceOrder.assignedToId`** da OS COMMERCIAL "Em Negociação". Sem migração,
  mas o campo hoje **nunca é validado como sendo de setor comercial**
  (`service-order.service.ts:143-154`) e `em-negociacao-sync.ts` nem lê nem escreve nele.

**Recomendo (a).** É um campo, e a semântica fica óbvia.

O signatário Ankaa **é** usuário do sistema — então a cerimônia dele é a interna: `orderGroup: 1`
(assina por último, depois de ver quem assinou do outro lado), autenticado por sessão + re-auth
de senha, ou pelo fluxo biométrico do Flutter que já existe. **Não** precisa de OTP.

E vale considerar: como a Ankaa vai precisar de e-CNPJ de qualquer forma (para contratar Serpro),
o diretor pode aplicar uma **assinatura qualificada ICP-Brasil** do lado da Ankaa, sem custo
marginal por documento. Isso endurece o artefato de graça.

### 5.5 OTP — não reusar o `VerificationService` existente

`api/src/modules/common/verification/verification.service.ts` tem quatro defeitos que o
desqualificam para uma cerimônia de assinatura:

1. **Códigos em texto claro** em `User.verificationCode` (`:76-81`) — e a coluna é **indexada**
   (`schema.prisma:2324`).
2. **Códigos logados em texto claro** — `:207` e `:217`, este último em `warn`, que sobrevive ao
   nível de log de produção.
3. **O contador de tentativas é chaveado no palpite.** A chave Redis é
   `verification_attempt:${contact}:${code}` (`verification-throttler.service.ts:37,86`) — **cada
   código chutado ganha seu próprio orçamento de 3 tentativas**. O limite real é 10/hora/IP,
   contornável rotacionando IP.
4. **O throttler falha aberto** — qualquer erro de Redis retorna `{allowed: true}` (`:77-79`).

E `responsible.service.ts:446` é pior: usa `Math.random()`.

O padrão correto é incremento atômico chaveado no **desafio**, não no palpite:

```ts
const rows = await prisma.$queryRaw<Array<{attempts:number; codeHash:string; maxAttempts:number}>>`
  UPDATE "SigningChallenge"
     SET attempts = attempts + 1
   WHERE id = ${challengeId}
     AND status = 'PENDING'
     AND "expiresAt" > now()
     AND attempts < "maxAttempts"
  RETURNING attempts, "codeHash", "maxAttempts"
`;
// vazio => expirado / esgotado / já consumido -> MESMO erro genérico (anti-enumeração)
// senão  => timingSafeEqual(HMAC(informado), codeHash)
//   acerto -> UPDATE status='CONSUMED'  (uso único)
//   erro   -> já incrementado; se attempts === maxAttempts -> status='LOCKED'
```

Parâmetros (OWASP ASVS v5.0 §6.5/6.6 + NIST SP 800-63B §5.1.3.2):

| Parâmetro | Valor | Base |
|---|---|---|
| Código | 6 dígitos, `crypto.randomInt(0, 1_000_000)` | ≥20 bits; `randomInt` usa rejection sampling, sem viés de módulo |
| TTL | **5 min** (teto legal 10) | NIST §5.1.3.2 · **não** as 2 horas da ZapSign |
| Uso | único, atômico `PENDING→CONSUMED` | ASVS 6.5.1 |
| Em repouso | **HMAC-SHA256(código, pepper)**, pepper em env | bcrypt/argon2 é inútil: 10⁶ é força-bruta instantânea |
| Comparação | `crypto.timingSafeEqual` sobre digests de 32 bytes | — |
| Tentativas | **5 por desafio**, chaveado no desafio | ASVS 6.6.3 |
| Reenvio | 30–60 s de cooldown; **invalida o código anterior** | OWASP MFA |
| Vínculo | verificar exige `challengeId` opaco + código; o desafio carrega `{signerId, envelopeId, documentSha256}` | **ASVS 6.6.2** |
| Doc mudou | `documentSha256` diferente → invalida desafios pendentes | Transaction Auth §2.6 |

Reaproveitar sim: os tiers de throttler `verification`, `verification_send`, `verification_strict`,
`verification_ip` já existem em `throttler.module.ts:64-94` e são Redis-backed. Corrigir o
fail-open antes de usar.

### 5.6 Canal do OTP — o ponto honesto sobre o Baileys

O `@whiskeysockets/baileys` funciona hoje (`baileys-whatsapp.service.ts:354`, sessão pareada por
QR, auth state em Redis). Mas para **este** uso ele é o elo fraco, por um motivo específico:

> A Meta Cloud API devolve um `wamid` no envio e entrega webhooks `sent → delivered → read`.
> Isso é **um terceiro independente atestando** que a mensagem chegou ao aparelho da contraparte.
> O Baileys também dá recibos — mas parseados pelo *seu* cliente, na *sua* sessão, gravados no
> *seu* banco. É o mesmo problema estrutural do relógio do servidor: **evidência que você produziu
> sobre você mesmo.**

Somando-se: o Baileys é violação explícita dos Termos da Meta ("develop or use any applications
that interact with our Business Services without our prior written consent"), com risco de ban
permanente — e *"nossa integração de WhatsApp foi banida pela Meta por violar os termos"* é uma
frase ruim de se dizer numa audiência sobre a confiabilidade da sua plataforma de assinatura.

**Recomendação pragmática, em duas fases:**
- **Fase 1** — usar o Baileys, mas com o schema já modelado para Cloud API (`providerMessageId`,
  `providerStatus`, `deliveredAt`). Adicionar o **SMS via Twilio** (já wired,
  `sms/repositories/twilio.repository.ts`) como canal alternativo — é atestado por operadora e
  custa quase nada para ligar.
- **Fase 2** — migrar o OTP para **Meta Cloud API direto, sem BSP**. Sem taxa mensal, só a
  tarifa por mensagem (~R$0,12–0,17 na categoria authentication). A ~40 OTPs/dia dá **~R$200/mês**.
  Template `AUTHENTICATION` com botão `COPY_CODE`, `code_expiration_minutes: 5`,
  `add_security_recommendation: true`. Número dedicado, separado do que estiver no Baileys.
- Manter o Baileys para notificação interna, se quiser — nunca para o OTP que autentica assinatura.

Independente da fase: **grave o comprovante de entrega**. A linha
`msg id wamid.XXX · entregue 14:05:12` no log de assinaturas é desproporcionalmente persuasiva.

### 5.7 Trilha de auditoria à prova de adulteração

O mínimo pragmático, em ordem de valor:

1. **Cadeia de hash por envelope** — `hash = SHA256(prevHash || JCS(linha canônica))`.
   Use **RFC 8785 (JCS)**, não `JSON.stringify` (`json-canonicalize` no npm). Cadeia **por
   envelope**, não global — cadeia global serializa toda escrita atrás de uma linha quente.
   Nunca hasheie um objeto Prisma vivo: monte um DTO explícito, datas em ISO-8601 UTC, dinheiro
   em centavos inteiros, geo como string de precisão fixa.
2. **Append-only no Postgres** — role sem UPDATE/DELETE + trigger `BEFORE UPDATE OR DELETE` que
   levanta exceção + RLS com política só de INSERT. Prefira trigger a `CREATE RULE ... DO INSTEAD
   NOTHING`: a rule silencia, o trigger deixa rastro **da tentativa**.
   *Detalhe Prisma:* uma `DATABASE_URL` = uma role. Ou a role da app simplesmente nunca tem
   UPDATE/DELETE nessa tabela (uma role `migrator` separada, usada só no `migrate deploy`), ou
   um `pg.Pool` separado só para escrita de auditoria.
3. **Carimbo do tempo RFC 3161** sobre o selo final (§4.3).
4. **Export WORM noturno** — linhas canônicas do dia + ponta da cadeia para bucket com Object Lock
   (MinIO se quiser os dados no Brasil, B2/R2 se quiser barato e gerenciado). Poucos dólares/mês.
5. *(Opcional, grátis)* **OpenTimestamps** como âncora secundária de confiança-zero. Prova
   existência-antes-de-um-instante sem confiar em ninguém. Não substitui a ACT — explicar Merkle
   tree e OP_RETURN para um juiz é venda mais difícil do que apresentar um carimbo credenciado.

**Teto honesto:** um superusuário pode `ALTER TABLE ... DISABLE TRIGGER`. Nada dentro do banco
impede isso. O que torna o log crível é a **cadeia de hash** (torna adulteração *demonstrável*)
somada à **âncora externa** (torna *irreparável*).

### 5.8 Montagem do artefato final — a ordem importa

```
original.pdf (bytes congelados, hash conhecido)
  → pdf-lib: desenha o bloco de selo de cada signatário nas âncoras     [conteúdo]
  → pdf-lib: carimba rodapé em TODA página                              [conteúdo]
  → pdfkit:  gera as páginas de "Trilha de Auditoria"  → merge          [conteúdo]
  → ★ UM selo PAdES com o A1 + carimbo RFC 3161                         [DEVE ser o último]
  → final.pdf → storage, hash, evento DOCUMENT_FINALIZED
```

**Tudo que muda conteúdo acontece antes do selo.** Nunca depois — a orientação da própria Adobe
é que flatten/edição precede a assinatura digital.

**Um selo, no fim, e pronto.** Justificativa:
- Os signatários não têm certificado. Não há nada por-signatário para carimbar criptograficamente.
- Um selo só significa **zero complexidade de incremental update** — sem `@cantoo/pdf-lib`, sem
  raciocínio de DocMDP, sem "qual validador interpreta o diff de que jeito". Adobe e ITI mostram
  uma assinatura limpa e válida.
- É exatamente o que Clicksign, ZapSign e D4Sign fazem.
- Nota técnica, caso um dia entre `icp_brasil` como método de um signatário: uma segunda assinatura
  por **incremental update correto NÃO quebra** a primeira (os bytes anexados caem fora do
  `ByteRange` da anterior). O que quebra na prática é `pdf-lib.save()`, que reescreve o arquivo
  inteiro. Por isso o pdf-lib só aparece **antes** do selo.

O selo visual sobre cada linha de assinatura (o que foi pedido):

```
┌──────────────────────────────────────────────┐
│  ✓ ASSINADO ELETRONICAMENTE                  │
│  João da Silva Pereira                       │
│  Gestor de Frota                             │
│  CPF ***.456.789-**   ·   +55 43 9****-3228  │
│  24/07/2026 14:06:44 (GMT-03:00)             │
│  Autenticação: código OTP via WhatsApp       │
│  Envelope A7K9-2FMQ-XR4T · verificar em      │
│  ankaadesign.com.br/v/A7K9-2FMQ-XR4T         │
└──────────────────────────────────────────────┘
              ______________________________
                  João da Silva Pereira
```

Rodapé de toda página:
`Orçamento nº 1234 · Envelope A7K9-2FMQ-XR4T · pág N/M · SHA-256 e5b8abb16bc4c559… · ankaadesign.com.br/v/A7K9-2FMQ-XR4T` + QR.

### 5.9 Máscara de CPF — use `***.456.789-**`

A máscara pedida (`11*.***...`) é convenção de banco/e-commerce, **sem lastro legal**. A que tem
pedigree normativo oculta **os três primeiros e os dois verificadores**:

> **PARECER n. 00001/2021/CONJUR-CGU/CGU/AGU**: *"a CGU orienta os órgãos (…) que (…) oculte os
> três primeiros dígitos e os dois dígitos verificadores do CPF, nos mesmos parâmetros adotados
> pela Lei de Diretrizes Orçamentárias da União (LDO de 2013 — Lei 12.708/2012 — Art. 107,
> parágrafo único): `***.999.999-**`"*

Origem em LDO 2011 (Lei 12.309/2010, art. 87, §5º), repetida nas LDOs seguintes, em uso contínuo
desde 2009. Ressalva honesta: é regra de **transparência da administração pública**, não comando
da LGPD para privados — mas é a única com respaldo, e usar a mesma é gratuito.

**Onde mascarar (a divisão importa):**
- **Selo visual + rodapé + página pública de verificação:** CPF **mascarado**. Esses artefatos vazam.
- **Página anexa de trilha de auditoria:** **CPF completo** — é o documento probatório, e é o que
  Clicksign e Autentique fazem (ambos imprimem CPF integral; verificado em PDFs reais).

**Invariante rígida: mascare a exibição, nunca o registro.** Se o valor mascarado for seu único
registro do CPF, você destruiu a capacidade de identificar o signatário — o que é fatal sob o
art. 429, II. Verifique isso no schema, não na UI.

Telefone não tem convenção legal. Sugestão: `+55 43 9****-3228`.

### 5.10 Portal de verificação

`https://ankaadesign.com.br/v/<codigo>` — `codigo` em base32 sem caracteres ambíguos,
hifenizado (`A7K9-2FMQ-XR4T`), `noindex`, rate-limited, sem enumeração.

Modo duplo, como a Clicksign: **ou** digitar o código, **ou** subir o PDF (recomputa o hash e
compara). O modo hash é estritamente mais forte — prova que *este arquivo exato* é o assinado.

Exibe: número do orçamento e status; SHA-256 do original e do final; roster de signatários com
**CPF mascarado**, cargo, método, timestamp com offset; empresa emissora.

**Alerta de privacidade específico do seu caso:** o orçamento contém **preço**. Uma URL pública
impressa em toda página significa que qualquer um que receba o PDF a enxerga. Isso é aceitável —
mas **não** deixe o corpo do documento baixável a partir da página de verificação sem segundo
fator. Mostre só metadados + hashes + roster; o corpo fica atrás de login ou de
`código + últimos 3 dígitos do CPF de um signatário`.

---

## 6. Integração com a máquina de estados

Hoje `PENDING → BUDGET_APPROVED` é um flip manual interno, por três caminhos
(`budgetApprove()`, `PUT /:id/status`, e a conclusão automática da OS "Em Negociação").
O gate de layout (≥1 `layoutFiles`) existe em `budgetApprove()` mas **é pulado** por
`PUT /:id/status`.

**Proposta:** a conclusão do envelope dispara o **mesmo** `budgetApprove()` — não uma escrita
direta no Prisma. Assim o gate de layout, o dispatch de `task_quote.budget_approved` e o
`syncEmNegociacaoForTask` continuam valendo. E corrige a mentira atual, onde a UI diz
"O orçamento foi confirmado" e nada muda no servidor.

```
TaskQuote.status: PENDING
   │  POST /task-quotes/:id/signature-envelope
   ▼
Envelope RUNNING ──── todos os signatários assinam ───▶ Envelope COMPLETED
   │                                                          │
   │ qualquer recusa → REFUSED (congela os demais)             │ budgetApprove()
   │ deadlineAt      → EXPIRED                                 ▼
   │ edição material → CANCELLED + reemissão          TaskQuote BUDGET_APPROVED
   ▼
TaskQuote continua PENDING
```

Regras que precisam existir:
- **Envelope RUNNING trava a quote** para edição material. Reutilizar o padrão
  `QUOTE_SAFE_AFTER_BILLING_FIELDS` de `task-quote.guards.ts:37-45`.
- **Editar campo material com envelope vivo = cancelar o envelope.** Nunca "remendar e manter as
  assinaturas" — isso destrói todo o valor probatório. Imprima no selo:
  *"Este documento substitui o orçamento nº X, cancelado em {data}."*
- **`deadlineAt` espelha `TaskQuote.expiresAt`** — é a *validade da proposta*, e resolve de quebra
  a discussão de proposta entre presentes/ausentes do **CC art. 428**.
- **Atenção ao CC art. 431:** se o cliente puder alterar quantidades ou preço antes de assinar,
  isso é **contraproposta**, e exige aceitação da Ankaa. O fluxo deve ser assinar-ou-recusar,
  nunca assinar-com-alterações.
- **Nada expira quotes hoje** — `expiresAt` só é avaliado na leitura. Vai precisar de um cron.

---

## 7. Correções de segurança que bloqueiam esta feature

Não são "boas práticas". São bloqueadores.

### 7.1 O certificado A1 está commitado no git

```
$ git ls-files certs/
certs/certificate.pfx          ← 9,2 KB, o A1 ICP-Brasil da empresa
```
`.gitignore` cobre `.env*` mas **não** `certs/`. Ação: **revogar e reemitir o certificado**,
purgar do histórico, mover para secret/volume montado. Enquanto isso não for feito, qualquer
pessoa com acesso ao repositório pode selar documentos como a Ankaa.

### 7.2 O segredo HMAC está commitado

`api/.env.example:227` contém o valor **vivo** de `PPE_SIGNATURE_HMAC_SECRET`, idêntico ao de
`api/.env:77`. Isso significa que **todo resultado "integridade verificada" do fluxo de EPI é
forjável** por quem tenha o repo. Rotacionar, e usar um pepper **separado** para as assinaturas
de orçamento.

### 7.3 Todo arquivo do sistema é público por UUID

`GET /files/serve/:id`, `GET /files/:id/download`, `GET /files/thumbnail/:id` e
`GET /files/:id` (metadados) são todos `@Public()` com `Access-Control-Allow-Origin: *`
(`file.controller.ts:214-254, 508`), e há mount estático de todo o `FILES_ROOT` em
`main.ts:224-242`. O próprio controller admite: *"File model has no uploader/owner field, so
per-record ownership cannot be enforced."*

**Um orçamento assinado contém preços.** Ele não pode viver atrás dessa porta. Ação: rota de
download dedicada ao envelope, autorizada por `accessToken` do signatário ou por sessão interna,
com evento `DOCUMENT_DOWNLOADED`.

### 7.4 Token de `Responsible` valida no endpoint público da quote

`responsible.service.ts:360-423` emite JWT com o **mesmo `JWT_SECRET`** dos usuários internos.
`GET /task-quotes/public/:id` faz verify opcional (`task-quote.controller.ts:326-342`) e um token
válido **pula a checagem de expiração de qualquer quote**. Dar segredo próprio ao fluxo de
assinatura, ou guard próprio.

### 7.5 Menores, mas do mesmo caminho

- `PrismaService.omit` cobre `User.password/sessionToken` mas **não** `Responsible`
  (`prisma.service.ts:237-241` vs `:318-320`) — leituras cruas de Responsible vazam o hash bcrypt
  e o session token vivo.
- `ChangeLog.user` é `onDelete: Cascade` — apagar um User apaga o changelog dele. E
  `cleanupOldLogs(daysToKeep=90)` + `DELETE /changelogs/cleanup` apaga evidência. Por isso a
  auditoria de assinatura vai em **tabela própria append-only**, não no ChangeLog.
- `ChangeLogService.logChange` **descarta silenciosamente** o `metadata` do chamador
  (`changelog.service.ts:85-105`) — dois call sites já passam metadata que nunca chega ao banco.
- `<Toaster />` só é montado dentro do `AuthProvider` (`App.tsx:633`) — **todo toast da página
  pública de orçamento é invisível hoje**. A página de assinatura precisa do seu próprio.
- `MobileUsageGuard` (`mobile-usage-guard.tsx:25-31`) redireciona para `/install` qualquer rota
  mobile fora de `/install`, `/autenticacao`, `/cliente`, `/certificado-residuos`,
  `/politica-de-privacidade`. **A rota de assinatura precisa ficar sob `/cliente`** — ou clientes
  em celular serão silenciosamente expulsos. É exatamente o aparelho em que eles vão assinar.

---

## 8. Identidade: o que comprar e o que não comprar

| Controle | Custo | Veredito |
|---|---|---|
| **CPF mod-11** (já existe: `api/src/utils/validators.ts:3`) | 0 | **Sim** — mas é filtro de digitação. Nunca chame de "verificação" na UI nem no selo. |
| **Serpro Datavalid "Cadastral Simples"** — nome↔CPF bate? sim/não | **R$ 0,80** (faixa 1–999/mês) | **Sim, no baseline.** Devolve booleano, não devolve os dados da pessoa — postura LGPD muito melhor que a Consulta CPF (R$ 0,66), que devolve o registro. Sem mensalidade, sem franquia, sem setup. |
| **★ Serpro Consulta CNPJ — tier QSA** | **R$ 0,8683** | **Sim.** CPF do signatário no quadro de sócios/administradores ⇒ autoridade praticamente conclusiva. Maior alavanca do projeto. Alternativas grátis: BrasilAPI / ReceitaWS / CNPJá. |
| **Pix de R$ 0,01** (CPF do pagador via Bacen) | ~0 | **Como escalonamento**, não padrão. É a prova de identidade mais forte sem biometria/ICP — você empresta o KYC de uma instituição supervisionada. Mas troca de app custa conversão, e Pix da conta PJ **não casa com CPF** e falha (cenário realista no escritório). |
| **Selfie / liveness** | R$ 1,50–2,61 | **Não.** Resolve o problema errado (a disputa é autoridade, não impostor), vira **dado sensível** (LGPD art. 5º, II — art. 11 não tem hipótese de legítimo interesse), e o TJRJ já decidiu (0000724-16.2021.8.19.0211) que selfie **sozinha** não basta. Mata conversão num orçamento de pintura. |
| **GSMA Number Verification** | — | **Não.** Exige o caminho de dados celular; um comprador no Wi-Fi corporativo, no desktop, simplesmente falha. (**SIM Swap**, da mesma família, é útil e vale a lista para valores altos.) |
| **gov.br Assinatura Eletrônica API** | grátis | **Impossível.** Credenciais só para *Gestor Público*, condicionadas a Login Único e a **domínio oficial do governo** (Portaria SGD/MGI nº 7.076/2024, arts. 3º e 5º). Sistemas em mercado competitivo são expressamente excluídos. Barreira categórica, não comercial. |
| **assinador.iti.br** (manual) | grátis | **Sim, como saída de escape.** Para o cliente cujo jurídico exigir mais: exporte o PDF final e roteie manualmente. |

**Nota LGPD:** a base legal do dossiê é **art. 7º, IX (legítimo interesse)** + **art. 7º, VI
(exercício regular de direitos)** para retenção e produção em juízo. **Nunca consentimento
(art. 7º, I)** — consentimento é revogável a qualquer tempo (art. 8º, §5º), e uma trilha de
auditoria fundada nele pode ser desmontada juridicamente **pela própria pessoa que disputa a
assinatura**, exatamente quando você precisa dela. Se houver checkbox na tela, ele faz trabalho
*contratual* (o gancho do §2º), não trabalho de base legal — e a UI não pode confundir os dois.
Retenção: 5 anos (CC art. 206 §5º, I) ou 10 (art. 205) — escolha deliberadamente e escreva a
política. Guarde `"CPF conferido contra RFB em <timestamp>: OK"`, não uma cópia do registro da Receita.

---

## 9. Texto jurídico

### 9.1 Cláusula no corpo do orçamento (a alavanca do §2º)

> **ACEITAÇÃO DO MEIO ELETRÔNICO.** As partes reconhecem e aceitam, para todos os fins do
> art. 10, § 2º, da Medida Provisória nº 2.200-2/2001, a assinatura eletrônica deste orçamento
> por meio da plataforma da CONTRATADA, mediante autenticação por código de uso único enviado ao
> telefone cadastrado do signatário e registro de trilha de auditoria, admitindo tal método como
> **meio válido de comprovação de autoria e integridade**, com os mesmos efeitos da assinatura
> manuscrita, e renunciando a impugná-lo exclusivamente em razão de sua forma eletrônica ou da
> ausência de certificação ICP-Brasil.

Sem isso você litiga aceitação tácita — vencível depois do REsp 2.197.156, mas é uma briga que dá
para não comprar. Com isso, foi o que ganhou o REsp 2.159.442. Registre a aceitação como evento
próprio no log.

### 9.2 As quatro declarações da tela de assinatura

Adaptadas da cláusula 49 dos Termos de Uso da Clicksign, com o gancho de autoridade tornado
explícito e inescapável:

> ☐ Declaro que li e revisei integralmente este orçamento nº **{numero}**, no valor total de
>   **R$ {valor}**, e que concordo com seu conteúdo.
>
> ☐ Declaro que os dados de identificação por mim informados (nome, CPF e telefone) são
>   verdadeiros e me pertencem.
>
> ☐ Declaro que exerço o cargo de **{cargo}** na **{RAZÃO SOCIAL — CNPJ}** e que **detenho
>   poderes para representá-la e aprovar este orçamento neste ato**.
>
> ☐ Reconheço que esta assinatura eletrônica produz os mesmos efeitos da assinatura manuscrita,
>   nos termos do art. 10, § 2º, da MP nº 2.200-2/2001, e autorizo o registro de meu nome, CPF,
>   endereço IP, data e hora na trilha de auditoria deste documento.

**Quatro checkboxes, não um.** O terceiro é o que você vai precisar em juízo, e ele tem que ser
ato afirmativo próprio, com timestamp e IP próprios. Grave o **texto exato exibido** em
`EnvelopeSigner.declarations`, não um booleano — o texto pode mudar entre versões, e o que
importa é o que *aquela pessoa* leu.

### 9.3 Rodapé da página de trilha de auditoria

> Documento assinado eletronicamente. As assinaturas eletrônicas têm validade jurídica nos termos
> da Medida Provisória nº 2.200-2/2001, art. 10, § 2º. Datas e horários em GMT-03:00 (Brasília).
> Verifique a autenticidade em ankaadesign.com.br/v/{codigo} ou em https://validar.iti.gov.br/.

Sempre imprima o offset de fuso. Armazene UTC, renderize `America/Sao_Paulo`, rotule.
Clicksign e Autentique imprimem `GMT -03:00 Brasilia` em **toda** página.

---

## 10. Ordem de construção

| Fase | Entrega | Por que nesta ordem |
|---|---|---|
| **0** | Revogar/reemitir o A1, purgar `certs/` do git, rotacionar `PPE_SIGNATURE_HMAC_SECRET` | Nada abaixo tem valor com o certificado exposto |
| **1** | Render server-side com Playwright + fonte Inter fixada; congelar bytes + SHA-256; extrair âncoras; persistir; travar a quote | Nada é significativo sem artefato congelado |
| **2** | `SignatureEnvelope` / `EnvelopeSigner`; tokens opacos; `orderGroup` (cliente ‖, Ankaa por último); deadline, recusa, expiração | A máquina de estados em que tudo se pendura |
| **3** | `SignatureAuditEvent` com cadeia de hash por envelope (JCS) + append-only no Postgres | Controle de evidência mais barato e de maior valor |
| **4** | `SigningChallenge` com o incremento atômico; 6 dígitos / 5 min / HMAC+pepper / 5 tentativas / vinculado a `documentSha256` | O núcleo de autenticação |
| **5** | Página pública de assinatura sob `/cliente/assinar/:token` — pdf.js, `<Toaster />` próprio, 4 declarações, telefone travado | A cerimônia |
| **6** | Selos visuais nas âncoras + rodapé por página + páginas de trilha de auditoria; montagem do `final.pdf` | O artefato que o juiz lê |
| **7** | **Um** selo PAdES no fim, reusando `PpePadesSignerService`/`CadesP12Signer` movidos para `common/signature` | Você já tem isso funcionando |
| **8** | Restaurar `ppe-tsa-client.ts` de `f60af3c` → **PAdES-B-T**; contratar ACT (ou Lacuna Rest PKI, onboarding mais rápido) | Derruba "vocês retrodataram o próprio banco" |
| **9** | Portal `/v/{codigo}` com modo hash + modo código; QR no rodapé; validar a saída em validar.iti.gov.br no CI | Verificação é o que torna a evidência utilizável |
| **10** | Datavalid Cadastral Simples + QSA match; export WORM noturno; migrar OTP para Meta Cloud API | Endurecimento |

**As três coisas que eu faria primeiro, se fosse só três:** congelar os bytes (fase 1), a cadeia
de auditoria (fase 3), e a cláusula de aceitação do meio (§9.1 — é um parágrafo). Elas endereçam,
juntas, os modos de falha responsáveis por praticamente todas as derrotas relatadas na
jurisprudência.

---

## 11. Decisões em aberto

1. **Representante comercial:** criar `TaskQuote.commercialUserId` (recomendado) ou derivar de
   `ServiceOrder.assignedToId` da OS "Em Negociação"? E o signatário Ankaa é sempre o diretor
   (Sergio Rodrigues), ou o vendedor da conta?
2. **CPF no cadastro?** Adicionar `Responsible.cpf` opcional (a Ankaa pré-declara) *além* do CPF
   digitado no ato, ou só o digitado? Recomendo os dois — é o padrão Clicksign de dupla afirmação.
3. **Assinatura obrigatória de todos?** Todos os `Task.responsibles` precisam assinar, ou basta um
   com quórum? Recomendo: um `EnvelopeSigner` por responsável selecionado, **todos obrigatórios**,
   com a Ankaa podendo remover signatários antes de disparar (evento logado).
4. **Regra por valor:** acima de R$ X, exigir co-assinatura de alguém que case com o QSA? Faz
   sentido, mas fixe o limiar — regra geral mata conversão em serviço pequeno.
5. **ACT:** contratar direto (Serpro exige e-CNPJ; Certisign/Valid/Bry/Soluti/Safeweb são
   "fale com um consultor") ou via revendedor **Lacuna Rest PKI** (`https://pki.rest/tsp/{tenant}`,
   OAuth bearer, onboarding bem menos burocrático, com markup)?
6. **`Responsible.phone` é `@unique`** — quebra em contatos que dividem telefone de escritório.
   Relaxar para `@@unique([companyId, phone])`?
7. **Flutter:** a assinatura fica só no web (o link abre no navegador, inclusive dentro do
   WhatsApp) ou o app também exibe status do envelope? Recomendo: web-only para assinar; o Flutter
   só mostra status e compartilha o `final.pdf` — e aproveita para corrigir o bug do U+2022.

---

## 12. Construir vs. comprar — a comparação honesta

ZapSign e Clicksign vendem exatamente isto, com OTP por WhatsApp nativo, log de assinaturas,
selo ICP-Brasil e portal de verificação, por centavos por documento. A ~30 orçamentos/mês × 3
signatários, algo entre **R$ 100 e R$ 250/mês**. O que aqui são 6–10 semanas de engenharia.

O que você perde comprando: a criação do envelope a partir da quote e o webhook de volta para
flipar o status ainda são integração; o documento sai da sua infra; e o layout do orçamento passa
a ser upload em vez de parte do sistema.

O que pesa a favor de construir, no seu caso específico:
- **O selo PAdES já existe e funciona** — inclusive a parte difícil (`signingCertificateV2` para o
  validador do ITI). Isso é o mais caro, e está pronto.
- **Playwright, Chromium, pdfkit, pdf-lib, node-forge, Redis, throttler tiered, WhatsApp e Twilio
  já estão no repositório.** A superfície nova é modelo de dados + cerimônia + montagem.
- O orçamento é o coração do sistema; terceirizar a aprovação dele terceiriza o gargalo do fluxo.

**Se a decisão for construir, faça a fase 0 antes de qualquer outra coisa.** O A1 commitado no git
é o único item desta lista que já é um problema hoje, independentemente desta feature.

---

## Referências

**Legislação** — [MP 2.200-2/2001](https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm) ·
[Lei 14.063/2020](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm) ·
[CC](https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm) ·
[CPC](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm) ·
[LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)

**Jurisprudência** — [STJ REsp 2.159.442](https://www.stj.jus.br/sites/portalp/Paginas/Comunicacao/Noticias/2024/03122024-Falta-de-credenciamento-da-entidade-certificadora-na-ICP-Brasil--por-si-so--nao-invalida-assinatura-eletronica-.aspx) ·
[STJ REsp 2.197.156](https://www.stj.jus.br/sites/portalp/Paginas/Comunicacao/Noticias/2026/18032026-Terceira-Turma-valida-emprestimo-digital-com-assinatura-em-plataforma-nao-certificada-pela-ICP-Brasil.aspx) ·
[TJMT — contrato anulado por evidência insuficiente](https://www.tjmt.jus.br/noticias/2025/5/justica-nao-reconhece-assinatura-eletronica-e-anula-contrato-bancario) ·
[CJF Enunciado 11 (teoria da aparência)](https://www.cjf.jus.br/enunciados/enunciado/26)

**Técnico** — [ITI — ACTs credenciadas](https://www.gov.br/iti/pt-br/assuntos/icp-brasil/autoridades-de-carimbo-do-tempo) ·
[RFC 3161](https://www.rfc-editor.org/rfc/rfc3161.html) · [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785) ·
[OWASP ASVS v5.0 V6](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x15-V6-Authentication.md) ·
[OWASP Transaction Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html) ·
[NIST SP 800-63B-4](https://csrc.nist.gov/pubs/sp/800/63/b/4/final) ·
[Meta — templates de autenticação](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/authentication-templates)

**Fornecedores** — [Serpro Datavalid](https://loja.serpro.gov.br/datavalid/product/datavalid) ·
[Serpro Consulta CNPJ/QSA](https://www.loja.serpro.gov.br/consultacnpj) ·
[Lacuna Rest PKI — timestamping](https://docs.lacunasoftware.com/pt-br/articles/rest-pki/on-premises/configure-timestamping.html) ·
[Clicksign — log nos documentos assinados](https://ajuda.clicksign.com/article/230-log-presente-nos-documentos-assinados)

---

## Anexo — 2ª rodada de auditoria (4 agentes, 2026-07-26)

### Corrigido nesta rodada

| # | Defeito | Correção |
|---|---|---|
| C1 | `onQuoteContentChanged` cobria **1 caminho de escrita entre ~40**. Escrita aninhada via `PUT /tasks/:id`, service-order renomeando serviços, rollback de campo, truck/customer/responsible services e o backfill automático de CNPJ da conciliação bancária alteravam o snapshot sem invalidar — e o selo PAdES saía sobre conteúdo obsoleto. | **Garantia no momento do ato**, em vez de caçar call sites: `signWithOtp` e `finalize` recomputam o snapshot e recusam + invalidam se divergir. Cobre inclusive caminhos futuros. |
| H7 | `finalize()` rodava **duas vezes** quando os dois últimos signatários concluíam juntos (6 de 9 rodadas): dois selos, duas linhas `File` no mesmo caminho, `budgetApprove` duplicado. | Reivindicação atômica `updateMany({where:{status:RUNNING}})` antes de finalizar. |
| H2 | Assinaturas `VOIDED` continuavam sendo estampadas como **"ASSINADO ELETRONICAMENTE"** — o gate olhava só `signedAt`. | Gate por `status === 'SIGNED'`. |
| H3/H4 | `X-Forwarded-For` e `cargo` (JSON livre) chegavam ao PDF sem sanitização. Um byte `U+0081` fazia o pdf-lib lançar **para sempre**: `finalize()` morto, envelope travado, ambas as rotas de PDF em 500 permanente. | Sanitização C0/C1 no `winAnsi`, IP passando por ele, e `try/catch` por selo. |
| H1 | O PDF público ignorava estado e prazo — servia envelope `INVALIDATED` e orçamento vencido, enquanto o `GET /task-quotes/public/:id` de mesma capability recusa. | Prefere o `COMPLETED`; senão exige `RUNNING` e dentro do prazo. |
| F3 | `sequential: true` era gravado e **nunca verificado** — a Ankaa assinava antes do cliente. | `assertSignable` bloqueia `orderGroup` maior enquanto houver anterior pendente. |
| M9 | `EnvelopeStatus.EXPIRED` nunca era escrito; envelope vencido ficava `RUNNING` para sempre e **travava o orçamento** (nova coleta recusada). | `SignatureExpiryScheduler` (hora em hora) + higienização de desafios. |
| M1 | Zero rate limit nas rotas públicas (força bruta de OTP; cada GET de PDF re-estampa ~65ms de CPU). | `@Throttle` nas 5 rotas públicas. |
| F5 | `canSignNow` ignorava o prazo — o formulário aparecia e só recusava depois do CPF. | Passa a considerar `deadlineAt`. |

### PDF — layout adaptativo

O gerador de referência (`web/src/utils/budget-pdf-generator.ts:872`) usa
`.page-content-gap { flex: 1 1 0 }` para **distribuir a sobra entre as seções**. O
porte para o servidor manteve o nome da classe e trocou a mecânica por altura
fixa — daí o vão de ~68mm. Restaurado, com `--sheet-fill` aplicado **apenas**
quando o documento cabe em uma folha (esticar multi-folha reintroduz página
fantasma; foi medido).

O ajustador era **unidirecional**: 8 serviços saíam a 8,2pt e 3 serviços a 10pt —
dois documentos da mesma empresa com aparência diferente — e 12 serviços gastavam
todas as iterações, batiam no piso **e paginavam assim mesmo**, gerando uma folha
só com o rodapé. Agora é bidirecional, com sonda de redução de folha.

### Pendente (não feito nesta rodada)

- ~~**C2**~~ — **RESOLVIDO**, ver "C2 — exclusão com envelope" abaixo.
- **H5** — `tokenExpiresAt` nunca é lido; link vazado é capability de leitura permanente.
- **H6** — `POST /recusar` não exige OTP e recusa o envelope inteiro.
- **M3** — OTP não vinculado ao CPF que o emitiu (janela do cooldown de 60s).
- **M5** — corpo não validado (sem Zod) 500a **depois** de queimar o OTP.
- **M6** — falha no `finalize()` deixa tudo `SIGNED` com envelope `RUNNING` e sem retry.
- **M7** — envelope `COMPLETED` pode ser substituído por reemissão.
- **M8** — `SIGNATURE_HMAC_SECRET` ausente degrada em silêncio (`hmacSignature = null`).
- Divergências de design do PDF: ~~numeração dos serviços~~, ~~Title Case~~, ~~rótulos de
  `TruckCategory`/`ImplementType`~~, ~~referência do desconto (`— ESPECIAL`)~~ — todas
  corrigidas, ver "PDF — paridade com o gerador de referência" abaixo. **Continua
  pendente:** tamanhos tipográficos e réguas, e o `SignatureEnvelopeService` ainda não
  passa `discountReference`/`discountPercent` ao renderizador (detalhe abaixo).
- Sem carimbo do tempo: selos em **B-B**, não B-T.

### C2 — exclusão com envelope (resolvido)

`SignatureAuditEvent` é append-only por trigger, e o `onDelete: Cascade` de
`TaskQuote → SignatureEnvelope → SignatureAuditEvent` fazia todo DELETE de orçamento
morrer em `restrict_violation` (500 genérico, transação abortada). Faltava justamente o
serviço que a migration `20260726150000` já previa.

**`SignatureDeletionService`** (`services/signature-deletion.service.ts`) abre a válvula
`SET LOCAL ankaa.allow_signature_audit_delete = 'on'` **dentro** da transação do
chamador, purga `SignatureAuditEvent → SigningChallenge → EnvelopeSigner →
SignatureEnvelope → File`, e fecha a válvula. `SET LOCAL`, e não `SET`: o valor morre
no COMMIT/ROLLBACK, então não existe caminho em que ela vaze para a próxima consulta da
conexão do pool nem em que um erro a deixe aberta — por isso não há `try/finally`, que
seria mais fraco (numa transação já abortada o reset falharia e mascararia o erro real).

A purga acontece **antes** do delete do alvo: quando o `taskQuote.delete()` roda, o
cascade não encontra mais nada e o trigger nem é acionado.

**Política de recusa** — a mesma que a migration declara (linhas 266-269):

| Situação | Decisão |
|---|---|
| Algum envelope `COMPLETED` | **RECUSA** (400 com o nº do orçamento e o código do envelope) |
| Algum signatário `SIGNED` | **RECUSA** (400, nomeando quem assinou) |
| `DRAFT` · `RUNNING` sem assinatura · `REFUSED` · `EXPIRED` · `CANCELLED` · `INVALIDATED` · `SUPERSEDED` | permite, purgando |

A assimetria é deliberada. Apagar orçamento assinado destrói exatamente o conjunto que
sustenta a defesa sob o **CPC art. 429, II** (final.pdf + cadeia + evidência do
signatário) — e a partir de um clique numa listagem. Já um `RUNNING` sem assinatura é
uma cerimônia que ninguém atendeu: não há ato de vontade a preservar, e travar aí só
obrigaria o operador a cancelar antes, sem ganho probatório. Quem precisa tirar um
orçamento assinado da frente **cancela**; não há escape por flag nem por privilégio.

**Bytes congelados** não são apagados dentro da transação (`unlink` não faz rollback —
seria como produzir de propósito os envelopes ENOENT dos orçamentos #580-582). O serviço
devolve os caminhos e o chamador chama `unlinkFrozenDocuments()` **após** o commit.

Ligado em: `TaskQuoteService.delete`, `TaskService.delete`, `TaskService.batchDelete`
(recusa o lote inteiro, não parcialmente) e `TaskService.copyFromTask` (purga a quote
órfã antes de descartá-la). Prova: `scripts/test-signature-deletion.js` — cria dados
descartáveis, exercita os quatro casos e limpa tudo (27/27 no banco local).

Nota de topologia: `Task.quoteId` é o FK, ou seja **a tarefa é o lado filho**. Apagar a
tarefa não apaga o orçamento; o que se purga ali é o envelope, porque o documento
congelado embute nº de série, placa, serviços e responsáveis da tarefa — um envelope
`RUNNING` sobrevivente continuaria convidando por WhatsApp para assinar um documento
cujo objeto não existe mais.

### PDF — paridade com o gerador de referência

Quatro divergências entre `document/` e `web/src/utils/budget-pdf-generator.ts`,
corrigidas reusando o que já existia no repo (nada de segunda tabela de rótulos):

| Item | Antes | Agora |
|---|---|---|
| Numeração dos serviços | ausente | `1 - `, `2 - `… (`budget-pdf-generator.ts:546`) |
| Caixa da descrição | como cadastrado (`PINTURA GERAL DA CABINE`) | Title Case via `@utils/formatters` |
| Observação | sub-linha cinza separada | inline, na mesma linha, **sem** Title Case |
| Item `Outros` | `Outros Adesivagem lateral` | só a observação |
| `TruckCategory`/`ImplementType` | **enum cru** (`SEMI_TRAILER_2_AXLES`, `CURTAIN_SIDE`) | `Semirreboque 2 Eixos`, `Sider` (`@constants/enum-labels`) |
| Referência do desconto | `Desconto (ESPECIAL)` — o parêntese engolia a referência | `Desconto (5%) — ESPECIAL` |

Dois efeitos colaterais de layout que vieram junto: o bloco de totais virou
`min-width` + `fit-content` (o rótulo com referência não cabia nos 62mm fixos) e ganhou
`break-inside: avoid`, porque num orçamento que pagina o Subtotal e o Desconto ficavam
no pé de uma folha e o Total sozinho no topo da seguinte. `.terms-section` idem, para o
título não ficar órfão do texto.

**Pendência conhecida:** `SignatureEnvelopeService.renderQuoteDocument` ainda entrega só
o campo legado `discountLabel`, e **descarta `discountReference` quando o desconto é
percentual**. O builder já aceita `discountPercent`/`discountReference`; falta passá-los.
Enquanto isso, `FIXED_VALUE` sai correto (`Desconto — ESPECIAL`) e `PERCENTAGE` sai sem a
referência.
