// api/src/schemas/signature.ts
//
// Corpo das rotas PÚBLICAS da cerimônia de assinatura do orçamento
// (`/assinatura/publico/:token/*`).
//
// Por que existir: estas três rotas recebiam `@Body() body: { ... }` cru, ou
// seja, um tipo que o TypeScript apaga na compilação e que ninguém verifica em
// tempo de execução. Um corpo malformado só explodia lá dentro — e no caso de
// `/assinar` explodia DEPOIS de o OTP já ter sido consumido (uso único), o que
// obrigava o signatário a esperar o cooldown de 60s por causa de um `geo.lat`
// que veio como string. Validar aqui é o que garante que nenhum efeito colateral
// da cerimônia acontece sobre entrada inválida.
//
// Divisão de trabalho deliberada: este arquivo valida FORMA (tipo, tamanho,
// faixa, parseabilidade). Regras de domínio — mod-11 do CPF, conferência com o
// cadastro, declarações obrigatórias, prazo — continuam no
// `SignatureEnvelopeService`, onde há contexto para produzir a mensagem certa.

import { z } from 'zod';

/** Dígitos de uma entrada livre; `null`/número/objeto viram string vazia. */
const onlyDigits = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\D+/g, '') : '';

/**
 * Código OTP.
 *
 * Aceita máscara e espaços (o campo da tela é de 6 caixinhas e alguns teclados
 * inserem espaço), mas exige exatamente 6 dígitos depois de normalizar — o
 * mesmo comprimento que `SigningChallengeService` emite. Um código com tamanho
 * errado é recusado ANTES de tocar o contador de tentativas do desafio.
 */
const otpCodeSchema = z.preprocess(
  value => (typeof value === 'string' ? value.replace(/\D+/g, '') : value),
  z.string({ required_error: 'Informe o código recebido.' }).regex(/^\d{6}$/, {
    message: 'O código de verificação tem 6 dígitos.',
  }),
);

/**
 * Coordenada geográfica.
 *
 * `z.coerce.number()` está descartado de propósito: ele converte `null` em `0`,
 * e gravar (0, 0) — um ponto no Golfo da Guiné — como evidência de onde a pessoa
 * assinou é pior do que não gravar nada. Número de verdade ou nada.
 */
const coordinateSchema = (min: number, max: number, label: string) =>
  z
    .number({
      required_error: `${label} é obrigatória quando a localização é enviada.`,
      invalid_type_error: `${label} deve ser um número.`,
    })
    .finite(`${label} deve ser um número finito.`)
    .min(min, `${label} fora da faixa válida.`)
    .max(max, `${label} fora da faixa válida.`);

/**
 * Geolocalização opcional do ato.
 *
 * Ausente, `null` ou negada pelo navegador é caso normal (o serviço grava
 * `geoSource: 'denied'`). O que não pode acontecer é chegar meia coordenada ou
 * uma string: `new Prisma.Decimal(lat.toFixed(6))` estoura em ambos, e estoura
 * depois de o OTP ter sido queimado.
 */
const geoSchema = z
  .object({
    lat: coordinateSchema(-90, 90, 'Latitude'),
    lon: coordinateSchema(-180, 180, 'Longitude'),
    // O `ZodValidationPipe` já converte string numérica para número em campos
    // chamados `accuracy` (lista `isNumericField`), então não é preciso repetir
    // a coerção aqui.
    accuracy: z.number().finite().min(0).max(1_000_000).nullish(),
  })
  .nullish()
  .transform(value => value ?? null);

/**
 * Carimbo de tempo do dispositivo — guardado só como evidência de skew.
 *
 * A validação de parseabilidade é o ponto: o serviço faz
 * `new Date(clientTimestamp)` e entrega o resultado ao Prisma, e um `Invalid
 * Date` vira erro de driver (500) no meio da assinatura. É o mesmo defeito que
 * já produziu "400 Invalid date" no fluxo de aerografia.
 */
const clientTimestampSchema = z
  .string()
  .max(64, 'Carimbo de tempo do cliente inválido.')
  .nullish()
  .refine(value => value == null || value === '' || !Number.isNaN(Date.parse(value)), {
    message: 'Carimbo de tempo do cliente inválido.',
  })
  .transform(value => (value && !Number.isNaN(Date.parse(value)) ? value : null));

// ---------------------------------------------------------------------------
// POST /assinatura/publico/:token/codigo
// ---------------------------------------------------------------------------

/**
 * Etapa 1 — identificação e emissão do código.
 *
 * `emailConfirm` são apenas os caracteres que a máscara esconde: o endereço é o
 * do cadastro e o signatário NÃO o edita (é isso que dá peso probatório ao OTP);
 * ele só confirma que o conhece.
 */
export const signatureRequestCodeSchema = z.object({
  cpf: z
    .string({ required_error: 'Informe seu CPF.', invalid_type_error: 'Informe seu CPF.' })
    .max(20, 'CPF inválido.')
    .refine(value => onlyDigits(value).length === 11, { message: 'CPF deve ter 11 dígitos.' }),
  cargo: z
    .string({ required_error: 'Informe seu cargo na empresa.' })
    .trim()
    .min(2, 'Informe seu cargo na empresa.')
    .max(100, 'Cargo deve ter no máximo 100 caracteres.'),
  /**
   * Caracteres ocultos do CONTATO — da parte local do e-mail, ou dos dígitos do
   * meio do telefone, conforme o canal em que a coleta foi emitida.
   */
  contactConfirm: z
    .string()
    .max(254, 'Confirmação de contato inválida.')
    .nullish()
    .transform(value => (value ?? '').trim().toLowerCase()),
  /**
   * @deprecated Nome anterior de `contactConfirm`, de quando o canal era sempre
   * e-mail. Mantido para que uma página já aberta no navegador do cliente não
   * pare de funcionar no deploy — o serviço aceita os dois e prefere o novo.
   */
  emailConfirm: z
    .string()
    .max(254, 'Confirmação de e-mail inválida.')
    .nullish()
    .transform(value => (value ?? '').trim().toLowerCase()),
});

export type SignatureRequestCodeFormData = z.infer<typeof signatureRequestCodeSchema>;

// ---------------------------------------------------------------------------
// POST /signature-envelopes/quote/:quoteId  (rota INTERNA)
// ---------------------------------------------------------------------------

/**
 * Emissão da coleta.
 *
 * A rota não recebia corpo nenhum. Passou a receber um só campo — o canal —, e
 * ele é OPCIONAL: quando `SIGNATURE_DELIVERY_CHANNEL` é fixo (`whatsapp` ou
 * `email`) a tela não desenha o seletor e não manda nada, e o servidor usa o
 * canal configurado. Só faz diferença no modo `both`.
 *
 * Validar aqui é o que impede um corpo com `channel: "sms"` de chegar ao
 * serviço; a checagem de que o canal está LIBERADO pela configuração é de
 * domínio e fica em `resolveSignatureDeliveryChannel`, que tem contexto para
 * dizer quais estão disponíveis.
 */
export const signatureCreateEnvelopeSchema = z
  .object({
    channel: z
      .enum(['WHATSAPP', 'EMAIL'], {
        errorMap: () => ({ message: 'Canal de envio inválido.' }),
      })
      .nullish(),
  })
  // Corpo ausente é o caso NORMAL (modo fixo), não um erro: sem isto um POST
  // sem body cairia em "Expected object, received undefined".
  .nullish()
  .transform(value => value ?? {});

export type SignatureCreateEnvelopeFormData = z.infer<typeof signatureCreateEnvelopeSchema>;

// ---------------------------------------------------------------------------
// POST /assinatura/publico/:token/assinar
// ---------------------------------------------------------------------------

export const signatureSignSchema = z.object({
  challengeId: z
    .string({ required_error: 'Solicite um novo código para assinar.' })
    .uuid('Solicite um novo código para assinar.'),
  code: otpCodeSchema,
  /**
   * Chaves das declarações aceitas. O conjunto EXIGIDO é decidido no serviço
   * (`DECLARATIONS`), não aqui: a lista é versionada junto com o texto jurídico
   * e não pode divergir em dois lugares. Aqui só se limita cardinalidade e
   * tamanho, para que a lista não vire vetor de payload gigante.
   */
  declarations: z
    .array(z.string().min(1).max(64), { required_error: 'Aceite as declarações para assinar.' })
    .min(1, 'Aceite as declarações para assinar.')
    .max(20, 'Lista de declarações inválida.'),
  clientTimestamp: clientTimestampSchema,
  geo: geoSchema,
});

export type SignatureSignFormData = z.infer<typeof signatureSignSchema>;

// ---------------------------------------------------------------------------
// POST /assinatura/publico/:token/recusar
// ---------------------------------------------------------------------------

/**
 * Etapa 2 (alternativa) — recusa.
 *
 * Exige o MESMO desafio OTP verificado que a assinatura exige. A recusa leva o
 * envelope a estado terminal e mata o negócio; sem OTP, qualquer um com o link
 * vazado fazia isso, sem nome, sem CPF e sem prova de posse do telefone.
 */
export const signatureRefuseSchema = z.object({
  challengeId: z
    .string({ required_error: 'Solicite um código para registrar a recusa.' })
    .uuid('Solicite um código para registrar a recusa.'),
  code: otpCodeSchema,
  reason: z
    .string({ required_error: 'Informe o motivo da recusa.' })
    .trim()
    .min(3, 'Descreva o motivo da recusa.')
    .max(1000, 'O motivo deve ter no máximo 1000 caracteres.'),
});

export type SignatureRefuseFormData = z.infer<typeof signatureRefuseSchema>;
