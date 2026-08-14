# NFS-e do aerografista (prestador MEI) — Sistema Nacional

Cada aerografia concluída gera automaticamente uma NFS-e **emitida pelo aerografista**
(prestador) **contra a Ankaa** (tomadora), assinada com o certificado A1 do próprio pintor.

Isto é o **inverso** da NFS-e que já existia no sistema. Não confundir:

| | NFS-e da empresa (já existia) | NFS-e do aerografista (novo) |
|---|---|---|
| Prestador | Ankaa | O pintor (MEI) |
| Tomador | O cliente | Ankaa |
| Emissão | Portal municipal Elotech/Ibiporã | API nacional SEFIN |
| Credencial | login CPF+senha da empresa | certificado A1 do pintor (mTLS) |
| Tabela | `NfseDocument` | `AirbrushingNfse` |

## Por que direto no ambiente nacional, e não pela Elotech

O caminho da Elotech é uma **sessão de portal presa ao subdomínio do município**
(`ibipora.oxy.elotech.com.br`) e ao login da empresa. Outro CNPJ exige outra credencial;
outro município exige outro host. Não existe modo "software emite por vários contribuintes".

A API nacional resolve isso porque o MEI é **obrigado** a ela: a Resolução CGSN nº 169/2022
(art. 106-A do Anexo da Res. 140/2018), em vigor desde 01/09/2023, manda o MEI usar o padrão
nacional em **todos os municípios**, conveniados ou não — as regras de recepção
E0016/E0037/E0038/E0039 dispensam expressamente a checagem de convênio "quando o emitente da
DPS for MEI na data de competência". Logo, não há caminho municipal de fallback a manter.

**A assinatura digital é obrigatória na via API.** A dispensa de certificado que o
art. 106-A §3º II dá ao MEI vale só para o emissor web/app; o ANEXO I, na linha `Signature`,
diz "Obrigatório quando for enviado para API". Por isso cada pintor precisa de e-CNPJ A1.

## Cadastro de um pintor novo (uma vez por pintor)

O pintor precisa providenciar:

1. **CNPJ MEI ativo**, com CNAE compatível com pintura/aerografia.
2. **e-CNPJ A1** (arquivo `.pfx`/`.p12`) de uma AC do ICP-Brasil. A3/token **não serve**:
   a chave não é exportável e o servidor não consegue assinar.
3. **Primeiro acesso no Emissor Nacional** (`nfse.gov.br/EmissorNacional`) — confirma que o
   CNPJ está habilitado no Cadastro Nacional de Contribuintes.
4. **Autorização por escrito** para a empresa guardar o certificado e emitir em nome dele.
5. Inscrição municipal **só se** a prefeitura mantiver cadastro mobiliário dele. MEI comum não
   tem, e nesse caso o campo fica vazio de propósito (a regra E0116 só exige quando existe).

No sistema, em **Colaboradores → detalhe do pintor** (ADMIN/CONTABILIDADE/FINANCEIRO):

6. Preencher **Dados Fiscais (MEI)**: CNPJ, razão social, código IBGE do município do
   **cadastro do CNPJ** (não onde o serviço é feito — regra E0041), código de tributação
   nacional (padrão `140501` = pintura de objetos, item 14.05 da LC 116).
7. Enviar o **certificado A1** com a senha. O sistema valida senha, chave exportável, validade
   e se o CNPJ **dentro** do certificado bate com o cadastrado — se não bater, a SEFIN
   rejeitaria com E1209 na primeira emissão.
8. Manter **Ambiente = Produção Restrita** e fechar o ciclo emitir → consultar → cancelar.
9. Só então virar para **Produção** e ligar **Emissão automática**.

## Ligar a emissão

Duas travas, ambas precisam estar ligadas:

- Global: `PAINTER_NFSE_SCHEDULER_ENABLED=true` no `.env` (padrão `false`).
- Por pintor: `emissionEnabled` no perfil fiscal (padrão `false`).

Com a global desligada, a **intenção** de nota continua sendo registrada e fica visível na
tela — nada é transmitido. É o estado seguro para rodar em produção antes de validar.

## Chave de cifragem dos certificados

`FISCAL_CERT_KEK` — 32 bytes em base64 (`openssl rand -base64 32`). **Obrigatória em
produção.** Sem ela a chave é derivada do `JWT_SECRET`, e aí rotacionar o JWT torna todos os
certificados indecifráveis de uma vez.

Os certificados são guardados **cifrados no banco**, nunca como `File`: `GET /files/serve/:id`
serve qualquer arquivo por id com `Access-Control-Allow-Origin: *`, então uma chave privada
modelada como File seria baixável por quem adivinhasse o uuid.

Rotação da KEK: gerar a nova, incrementar `CURRENT_KEK_VERSION` e re-embrulhar as DEKs
(`kekVersion` por linha permite convivência). Os blobs de PFX e senha não são reescritos.

## Como a emissão acontece

1. A aerografia chega a `COMPLETED` por qualquer um dos **sete** caminhos existentes
   (update, batchUpdate, create, batchCreate, dois writes crus dentro do `TaskService`, e a
   reabertura `COMPLETED → IN_PRODUCTION → COMPLETED`).
2. Dentro da **mesma transação**, nasce uma linha `AirbrushingNfse` em `PENDING`.
   `airbrushingId` é `UNIQUE`: essa linha **é** a trava de idempotência.
3. Depois do **commit**, a emissão é disparada na hora (melhor esforço). Chamada de rede nunca
   acontece dentro da transação.
4. Se a chamada inline falhar, a linha `PENDING` sobrevive e a varredura de 15 minutos assume.

Numeração: o `nDPS` é alocado **uma vez** e reaproveitado nas retentativas. É isso que permite
perguntar `GET /dps/{id}` antes de reenviar quando uma resposta se perde — com número novo a
cada tentativa, resposta perdida viraria nota duplicada.

## Rotinas automáticas

| Cron | O quê |
|---|---|
| `*/15 * * * *` | Emite pendentes e reprocessa erros transitórios (máx. 3 tentativas, 5 min entre elas). Atrás da trava global. |
| `*/10 * * * *` | Destrava notas presas em `PROCESSING` — pergunta à SEFIN se a DPS virou nota; vincula ou devolve para `PENDING`. **Não** está atrás da trava global, de propósito: não emite nada, só reconcilia. |
| `0 8 * * *` | Alerta de notas que esgotaram tentativas e de certificados vencendo (30/15/7/3/1 dias). |

Erros são classificados: **permanente** (rejeição de leiaute, regra de negócio, certificado)
sai da janela de retentativa mas continua visível como `ERROR`; **transitório** (5xx, timeout,
rede) volta em 5 minutos. O botão "Reemitir" na tela é o "corrigi o cadastro, tente de novo".

## DANFSe

O PDF é gerado por nós porque **a API nacional de DANFSe foi desativada em 03/08/2026** — a
própria NT 008 determina isso no §1, e as sondas confirmam (SEFIN devolve 501 Not Implemented,
ADN devolve 503). Não há API substituta.

O documento segue a **Nota Técnica nº 008 SE/CGNFS-e, versão 1.02, de 14/07/2026** (vigente; as
versões 1.0 e 1.01 foram superadas). O layout vive em `painter/danfse.layout.ts`, que é a
tradução literal da norma para constantes — cada número cita a seção de origem.

Pontos que a NT fixa e que o código trava por teste:
- página única, A4 retrato, borda de 1pt, linhas de bloco de 0,5pt (2.2)
- tudo em preto sólido; sombreamento cinza 5% só no cabeçalho, nos títulos de bloco e nos campos
  "Emitente da NFS-e" e "Valor Líquido da NFS-e + IBS/CBS" (2.2.3)
- QR Code obrigatório apontando para a consulta pública, mínimo 1,52cm, em X 17,48 / Y 1,67 (2.4.3)
- cabeçalho literal "DANFSe v2.0"; em homologação, "NFS-e SEM VALIDADE JURÍDICA" em vermelho (2.4.3)
- campo sem informação no XML recebe **traço (-)**, nunca zero (nota 12)
- blocos suprimíveis viram a frase literal da norma, com 0,32cm de altura, e o espaço recuperado
  vai para Descrição do Serviço / Informações Complementares (2.3)

⚠️ **`ambGer` NÃO é o indicador de homologação.** É o ambiente *gerador* (1=Prefeitura,
2=Sistema Nacional) e vale 2 em toda nota legítima do sistema nacional. Quem decide a tarja é
`tpAmb`. Confundir os dois carimba "SEM VALIDADE JURÍDICA" em nota real — há teste travando isso.

O logo oficial da NFS-e exigido pela NT está em `api/assets/nfse-logo.png`. Sem ele, o gerador
cai numa marca tipográfica de reserva (não conforme, mas não quebra).

`npm run regenerate:danfse` refaz o PDF das notas já emitidas quando o layout mudar. O XML e o
documento fiscal não são tocados.

## Verificação

```bash
npm run test:painter-nfse            # 71 asserções: regras de MEI, assinatura, cofre
npm run verify:painter-nfse-wiring   # sobe o container e resolve as dependências
```

O teste de assinatura **gera e verifica de volta** a assinatura XMLDSig. Isso existe porque o
assinador anterior do repositório usava `keyInfoProvider`, API removida no xml-crypto v4 e
ignorada em silêncio na v6: o XML saía sem `<X509Certificate>` no `KeyInfo` e era recusado sem
pista nenhuma.

## Cancelamento — validado em 14/08/2026

O ciclo **emitir → consultar → cancelar** foi executado contra a produção restrita e respondeu
**HTTP 201**. Reproduzível com `npm run probe:painter-nfse-cancel` (emite nota nova em
homologação, cancela e mostra as respostas cruas; não grava nada no banco).

Duas correções saíram desse teste, ambas rejeição **E1235**:

1. O identificador do PEDIDO é `TSIdPedRegEvt` = **`PRE[0-9]{56}`** = "PRE" + chave(50) +
   tipo do evento(6), **sem sequencial**. `"EVT" + 59 dígitos` é o `TSIdEvento` — o id do
   EVENTO que a SEFIN gera em resposta, não o do nosso pedido.
2. **`nPedRegEvento` não é filho de `infPedReg`** — depois de `chNFSe` vem direto o elemento do
   evento (`e101101`).

O campo do corpo JSON é **`pedidoRegistroEventoXmlGZipB64`**; o nome alternativo da documentação
devolve HTTP 500.

⚠️ Depois de cancelar, `GET /nfse/{chave}` continua devolvendo `cStat` **107** — o cancelamento é
um EVENTO à parte, não uma alteração da nota. Quem confirma é o evento devolvido pelo POST.
`GET /nfse/{chave}/eventos` responde 405: a consulta exige o tipo do evento no caminho.

## Pontos ainda não validados contra a SEFIN

- **O prazo de cancelamento não é nacional** (regra E0822: "conforme parametrização do
  município emissor"). Por isso não há validação de janela no código — quem diz que passou do
  prazo é a SEFIN.
- **Totais Aproximados dos Tributos (Lei 12.741/2012).** A NT 008 torna a linha obrigatória
  (nota 10), mas o leiaute PROÍBE `pTotTribSN` para MEI — o XML não traz esses totais. A NT não
  resolve o conflito. Imprimimos a linha com traço nos valores, em vez de "R$ 0,00", que
  afirmaria tributo zero. **Confirmar o tratamento com a contabilidade.**
- **Fontes.** A NT prescreve Arial (rótulos) e Microsoft Sans Serif (conteúdos). Ambas são
  proprietárias e não podem ser embutidas; usamos Helvetica, métricamente compatível com Arial e
  padrão do PDF. A NT não prevê substituição — é um desvio conhecido, de forma e não de conteúdo.
- **SHA-1 vs SHA-256.** Usamos `rsa-sha1`/`sha1`, que é o que o `xmldsig-core-schema` restrito
  do leiaute fixa e o que toda implementação de referência usa. `NFSE_SIGNATURE_ALGORITHM=sha256`
  inverte sem mexer em código, caso a SEFIN passe a exigir.
