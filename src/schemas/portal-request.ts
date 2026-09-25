// api/src/schemas/portal-request.ts
//
// A REQUISIÇÃO DE ORÇAMENTO FEITA PELO CLIENTE — `POST /cliente/me/orcamentos`.
//
// Este arquivo é a BORDA. Tudo o que entra pelo portal passa por aqui antes de
// tocar o banco, e as quatro diferenças em relação aos schemas internos são
// deliberadas — cada uma fecha um defeito que o caminho interno tem hoje:
//
//   1. DOCUMENTO OBRIGATÓRIO no cliente novo. `customerQuickCreateSchema`
//      (`schemas/customer.ts:882`) pula o `.refine` de "CNPJ ou CPF" que o
//      `customerCreateSchema` tem (`:869-878`) — e `CustomerService.quickCreate`
//      ainda grava `cpf: null` fixo (`customer.service.ts:383`). Um cliente sem
//      documento entra no cadastro e TRAVA a NFS-e lá na frente, quando já há
//      trabalho feito. No portal o documento é exigido NA PORTA.
//
//   2. SÉRIE É TEXTO. O caminho de FAIXA da criação interna é numérico
//      (`taskCreateSchema.serialNumberFrom/To`, `z.number().int().positive()`,
//      `schemas/task.ts:2617-2630`) e não sabe dizer `ABC-123456`. Aqui cada
//      veículo traz a sua série como string — que é o que o banco sempre
//      guardou (`Task.serialNumber String?`).
//
//   3. MEDIDAS EM CENTÍMETROS. O banco guarda METROS
//      (`ImplementMeasure.height`, `ImplementMeasureSection.width`, ambos
//      `Float`, com teto de 10 m e 20 m nos schemas internos). O cliente mede em
//      centímetros, e a conversão é UMA, aqui na borda — ver
//      `centimetrosParaMetros`.
//
//   4. PAR (SÉRIE, PLACA) EXPLÍCITO. `Task.serialNumber` e `Truck.plate` são
//      `@unique` GLOBAIS. O formulário interno emite o PRODUTO CARTESIANO de
//      placas × séries, que viola as duas unicidades por construção. Aqui
//      `veiculos[]` é uma lista de tuplas — N placas com a mesma série é
//      impossível de EXPRESSAR, não só de gravar.
//
// ⚠️ Nada em zod é `.strict()` neste repositório, e chave fora do lugar some em
// SILÊNCIO. Por isso os nomes daqui são os nomes que o serviço lê, e o teste
// `tests/portal-requisicao.test.ts` fixa cada um deles.

import { z } from 'zod';
import { cleanCNPJ, cleanCPF, isValidCNPJ, isValidCPF } from '@utils';
import { PAINT_FINISH } from '@constants';
import { ImplementType, ImplementCategory } from '@prisma/client';
import { chassisNumberSchema, hexColorSchema, plateSchema } from './common';

// ═══════════════════════════════════════════════════════════════════════════
// A CONVERSÃO — centímetros na borda, metros no banco
// ═══════════════════════════════════════════════════════════════════════════

/** Quantos centímetros cabem num metro. Existe como constante para que o teste
 *  não repita o `100` que ele deveria estar verificando. */
export const CENTIMETROS_POR_METRO = 100;

/**
 * Centímetros → metros, com o arredondamento no DÉCIMO DE MILÍMETRO.
 *
 * `cm / 100` em ponto flutuante devolve `2.4699999999999998` para 247, e esse
 * número vai para um `Float` do Postgres e sai formatado na tela e no PDF. O
 * arredondamento em 1e-4 m (0,1 mm) é muito mais fino do que qualquer medida de
 * implemento precisa e mata o ruído binário.
 */
export function centimetrosParaMetros(centimetros: number): number {
  return Math.round(centimetros * 100) / 10_000;
}

// ═══════════════════════════════════════════════════════════════════════════
// FormData: o corpo chega como multipart, e multipart só tem STRING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O que o cliente HTTP do portal manda quando há arquivo: UM campo `payload`
 * com o corpo inteiro em JSON, mais N campos `baseFiles`.
 *
 * ⛔ O DESENCONTRO QUE ISTO FECHA. Este schema nasceu esperando CADA campo
 * composto (`veiculos`, `novoCliente`, `novaTinta`) como a sua própria string
 * JSON — a convenção de `web/src/utils/form-data-helper.ts`. O portal do web
 * (`web/src/api-client/portal.ts` → `multipart()`) faz outra coisa, e três
 * pacotes do web já compilam contra ela: um campo só, chamado `payload`, com o
 * corpo TODO dentro. A razão está escrita lá e é boa — o corpo tem objeto
 * aninhado e lista (`veiculos[].medidas`), e multipart não transporta isso sem
 * uma convenção de colchetes que o Nest não desmonta sozinho.
 *
 * Então a borda aceita AS DUAS FORMAS: se existe `payload`, ele É o corpo; se
 * não existe, o corpo é o que veio (JSON puro, ou campo a campo como antes).
 * Nada do que já passava deixa de passar.
 */
export const PAYLOAD_FIELD = 'payload';

export const PAYLOAD_INVALIDO_MENSAGEM =
  'O campo `payload` do formulário não é um JSON válido. Recarregue a página e tente de novo.';

/**
 * Desembrulha `{ payload }` — nas duas formas em que ele pode chegar aqui.
 *
 * ⚠️ `payload` chega como STRING quando o schema é usado direto (o teste, e
 * qualquer chamador que não passe pelo pipe) e como OBJETO JÁ DESSERIALIZADO
 * quando vem pela rota: `ZodValidationPipe.transform` roda `fixArrays` antes de
 * `schema.parse`, e `fixArrays` desserializa toda string que seja JSON válido.
 * Tratar só um dos dois casos faria a rota e o teste discordarem — que é
 * exatamente a classe de divergência que este arquivo existe para fechar.
 *
 * JSON quebrado vira um erro NOMEADO, e não "briefing é obrigatório": sem isto,
 * um `payload` truncado acusaria a falta de todos os campos que estavam dentro
 * dele, e quem lê o erro procuraria o problema no lugar errado.
 *
 * ⚠️ EXPORTADO porque a requisição não é a única rota multipart do portal:
 * `PATCH /cliente/me/veiculos/:taskId/identificacao` chega pela MESMA forma
 * (um campo `payload` + o arquivo `truckVinPlate`), e `schemas/portal-vehicle-
 * identity.ts` reusa este desembrulho em vez de copiá-lo. Duas cópias do mesmo
 * `preprocess` divergiriam na primeira vez que o cliente HTTP mudasse de
 * convenção — e a que não fosse atualizada acusaria "campo obrigatório" em
 * todos os campos de uma vez, que é o erro que este bloco existe para evitar.
 */
export const desempacotarPayload = (valor: unknown, ctx: z.RefinementCtx): unknown => {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return valor;

  const corpo = valor as Record<string, unknown>;
  // SEM `payload` não há multipart-de-um-campo: é o corpo JSON de sempre, ou o
  // multipart campo a campo, e os dois continuam válidos.
  if (!(PAYLOAD_FIELD in corpo)) return valor;

  const bruto = corpo[PAYLOAD_FIELD];

  if (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) return bruto;

  if (typeof bruto === 'string') {
    const texto = bruto.trim();
    if (texto) {
      try {
        const desserializado: unknown = JSON.parse(texto);
        if (desserializado && typeof desserializado === 'object' && !Array.isArray(desserializado)) {
          return desserializado;
        }
      } catch {
        // cai no `addIssue` abaixo
      }
    }
  }

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    // `fatal` + `z.NEVER`: sem ele o zod seguiria validando o corpo ERRADO e
    // empilharia um erro por campo ausente em cima do erro de verdade.
    fatal: true,
    path: [PAYLOAD_FIELD],
    message: PAYLOAD_INVALIDO_MENSAGEM,
  });
  return z.NEVER;
};

/**
 * Aceita o valor já desserializado OU a string JSON que o `FormData` carrega.
 *
 * `ZodValidationPipe.fixArrays` já faz isso para o corpo
 * (`zod-validation.pipe.ts:480-492`), mas depender dele deixaria o schema
 * IMPOSSÍVEL de testar sozinho — e é o schema, não o pipe, que o teste desta
 * rodada fixa. Fazendo aqui também, os dois caminhos concordam e a forma é uma.
 *
 * `''` vira `undefined` (campo que o formulário mandou vazio) e a string
 * literal `'null'` vira `null` — as duas convenções que
 * `web/src/utils/form-data-helper.ts` já emite.
 */
const jsonish = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(valor => {
    if (typeof valor !== 'string') return valor;
    const texto = valor.trim();
    if (texto === '') return undefined;
    if (texto === 'null') return null;
    if (!texto.startsWith('{') && !texto.startsWith('[')) return valor;
    try {
      return JSON.parse(texto);
    } catch {
      return valor;
    }
  }, schema);

/** Texto que o multipart pode ter entregado como `''`/`'null'`. */
const textoOpcional = (max: number, rotulo: string) =>
  z.preprocess(
    valor => {
      if (typeof valor !== 'string') return valor;
      const texto = valor.trim();
      return texto === '' || texto === 'null' ? null : texto;
    },
    z.string().max(max, `${rotulo}: máximo de ${max} caracteres`).nullable().optional(),
  );

// ═══════════════════════════════════════════════════════════════════════════
// O CLIENTE NOVO — a combobox "criar"
// ═══════════════════════════════════════════════════════════════════════════

const documentoOpcional = (
  limpar: (valor: string) => string,
  validar: (valor: string) => boolean,
  mensagem: string,
) =>
  z.preprocess(
    valor => {
      if (typeof valor !== 'string') return valor;
      const texto = valor.trim();
      if (texto === '' || texto === 'null') return null;
      // GUARDADO EM DÍGITOS, sempre. O cadastro interno guarda o que o operador
      // digitou — máscara inclusive — e por isso o mesmo CNPJ existe no banco em
      // duas grafias que a unicidade da coluna não reconhece como iguais. A
      // porta nova não repete isso.
      return limpar(texto);
    },
    z
      .string()
      .nullable()
      .optional()
      .refine(valor => !valor || validar(valor), { message: mensagem }),
  );

/**
 * O CADASTRO MÍNIMO DE UM CLIENTE CRIADO PELO PORTAL.
 *
 * Campos espelhados de `customerQuickCreateSchema`, MAIS `cpf` (que ele não
 * tem) e MENOS a permissividade documental (o `.refine` no fim).
 *
 * O dono decidiu que cliente criado pelo portal entra no cadastro DIRETO — não
 * há portão de aprovação do comercial (a D3 do documento de decisão foi
 * respondida assim). O que NÃO se abre mão é do documento: sem CNPJ nem CPF a
 * NFS-e não sai, e a descoberta acontece semanas depois, com o veículo pronto.
 */
export const portalNovoClienteSchema = z
  .object({
    fantasyName: z
      .string({ required_error: 'Informe o nome fantasia do cliente' })
      .trim()
      .min(1, 'Informe o nome fantasia do cliente')
      .max(200, 'Nome fantasia: máximo de 200 caracteres'),
    cnpj: documentoOpcional(cleanCNPJ, isValidCNPJ, 'CNPJ inválido'),
    cpf: documentoOpcional(cleanCPF, isValidCPF, 'CPF inválido'),
    corporateName: textoOpcional(200, 'Razão social'),
    email: z.preprocess(
      valor => {
        if (typeof valor !== 'string') return valor;
        const texto = valor.trim();
        return texto === '' || texto === 'null' ? null : texto.toLowerCase();
      },
      z
        .string()
        .email('E-mail inválido')
        .nullable()
        .optional(),
    ),
    streetType: z
      .enum([
        'STREET',
        'AVENUE',
        'ALLEY',
        'CROSSING',
        'SQUARE',
        'HIGHWAY',
        'ROAD',
        'WAY',
        'PLAZA',
        'LANE',
        'DEADEND',
        'SMALL_STREET',
        'PATH',
        'PASSAGE',
        'GARDEN',
        'BLOCK',
        'LOT',
        'SITE',
        'PARK',
        'FARM',
        'RANCH',
        'CONDOMINIUM',
        'COMPLEX',
        'RESIDENTIAL',
        'OTHER',
      ])
      .nullable()
      .optional(),
    address: textoOpcional(200, 'Endereço'),
    addressNumber: textoOpcional(20, 'Número'),
    addressComplement: textoOpcional(100, 'Complemento'),
    neighborhood: textoOpcional(100, 'Bairro'),
    city: textoOpcional(100, 'Cidade'),
    state: z.preprocess(
      valor => {
        if (typeof valor !== 'string') return valor;
        const texto = valor.trim().toUpperCase();
        return texto === '' || texto === 'NULL' ? null : texto;
      },
      z.string().length(2, 'Estado deve ter 2 caracteres').nullable().optional(),
    ),
    zipCode: textoOpcional(20, 'CEP'),
    phones: z.preprocess(valor => (valor === undefined || valor === null ? [] : valor), z.array(z.string()).default([])),
    stateRegistration: textoOpcional(50, 'Inscrição estadual'),
    municipalRegistration: textoOpcional(50, 'Inscrição municipal'),
  })
  .refine(dados => Boolean(dados.cnpj || dados.cpf), {
    // ⚠️ ESTE É O `.refine` QUE `/customers/quick` NÃO TEM. Ver o cabeçalho.
    message: 'É necessário informar CNPJ ou CPF do cliente',
    path: ['cnpj'],
  });

// ═══════════════════════════════════════════════════════════════════════════
// A TINTA NOVA — o mínimo que `POST /paints` aceita
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O MÍNIMO de `paintCreateSchema` (`schemas/paint.ts:1799`), e NADA além dele.
 *
 * `hexColorSchema` e `PAINT_FINISH` são os mesmos objetos que a rota interna
 * usa — uma segunda cópia do regex de cor ou da lista de acabamentos seria a
 * terceira fonte de verdade da mesma regra.
 */
export const portalNovaTintaSchema = z.object({
  name: z
    .string({ required_error: 'Informe o nome da tinta' })
    .trim()
    .min(1, 'Informe o nome da tinta')
    .max(200, 'Nome da tinta: máximo de 200 caracteres'),
  hex: z.preprocess(
    valor => (typeof valor === 'string' ? valor.trim() : valor),
    hexColorSchema,
  ),
  finish: z.enum(Object.values(PAINT_FINISH) as [string, ...string[]], {
    errorMap: () => ({ message: 'Acabamento de tinta inválido' }),
  }),
  paintTypeId: z.string({ required_error: 'Informe o tipo de tinta' }).uuid('Tipo de tinta inválido'),
});

// ═══════════════════════════════════════════════════════════════════════════
// AS MEDIDAS DO IMPLEMENTO — EM CENTÍMETROS
// ═══════════════════════════════════════════════════════════════════════════

/** Teto em centímetros dos tetos que os schemas internos declaram em metros. */
export const ALTURA_MAXIMA_CM = 10 * CENTIMETROS_POR_METRO; // 1000 cm = 10 m
export const LARGURA_MAXIMA_CM = 20 * CENTIMETROS_POR_METRO; // 2000 cm = 20 m
export const MAXIMO_SECOES = 10;

const numeroCm = (rotulo: string, maximo: number) =>
  z.preprocess(
    valor => {
      // FormData entrega número como string. Dentro de um JSON já vem número —
      // os dois caminhos passam por aqui.
      if (typeof valor === 'string') {
        const texto = valor.trim().replace(',', '.');
        if (texto === '') return undefined;
        const numero = Number(texto);
        return Number.isNaN(numero) ? valor : numero;
      }
      return valor;
    },
    z
      .number({ invalid_type_error: `${rotulo} deve ser um número (em centímetros)` })
      .positive(`${rotulo} deve ser maior que zero`)
      .max(maximo, `${rotulo}: máximo de ${maximo} cm`),
  );

export const portalSecaoSchema = z
  .object({
    /** LARGURA DA SEÇÃO, em centímetros. */
    width: numeroCm('Largura da seção', LARGURA_MAXIMA_CM),
    isDoor: z.preprocess(valor => (valor === 'true' ? true : valor === 'false' ? false : valor), z.boolean().default(false)),
    /** ALTURA DA PORTA, em centímetros. Só faz sentido quando `isDoor`. */
    doorHeight: numeroCm('Altura da porta', ALTURA_MAXIMA_CM).nullable().optional(),
    /** Ausente = a POSIÇÃO NO ARRAY. O formulário não precisa numerar. */
    position: z.preprocess(
      valor => (typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor),
      z.number().int().min(0).optional(),
    ),
  })
  .refine(secao => !secao.isDoor || (secao.doorHeight !== null && secao.doorHeight !== undefined), {
    message: 'Seção marcada como porta precisa da altura da porta',
    path: ['doorHeight'],
  });

export const portalMedidaLadoSchema = z
  .object({
    /** ALTURA DO IMPLEMENTO deste lado, em centímetros. */
    height: numeroCm('Altura', ALTURA_MAXIMA_CM),
    sections: z
      .array(portalSecaoSchema)
      .min(1, 'A medida precisa de ao menos uma seção')
      .max(MAXIMO_SECOES, `Máximo de ${MAXIMO_SECOES} seções por lado`),
  })
  .refine(
    medida =>
      medida.sections.every(
        secao => !secao.isDoor || (secao.doorHeight ?? 0) <= medida.height,
      ),
    {
      message: 'A porta não pode ser mais alta que o implemento',
      path: ['sections'],
    },
  );

export const portalMedidasSchema = z.object({
  esquerda: portalMedidaLadoSchema.nullable().optional(),
  direita: portalMedidaLadoSchema.nullable().optional(),
  traseira: portalMedidaLadoSchema.nullable().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// O VEÍCULO — o par (série, placa) EXPLÍCITO
// ═══════════════════════════════════════════════════════════════════════════

/** O mesmo formato que `taskCreateSchema.serialNumber` aceita, e TEXTO. */
export const SERIAL_REGEX = /^[A-Z0-9-]+$/;
export const SERIAL_INVALIDO_MENSAGEM =
  'Número de série deve conter apenas letras maiúsculas, números e hífens';

export const portalSerialSchema = z.preprocess(
  valor => {
    if (typeof valor !== 'string') return valor;
    // MAIÚSCULA NA BORDA: o regex interno recusa minúscula, e recusar `abc-1`
    // seria recusar o que o cliente vê escrito no próprio chassi. Guardamos no
    // formato que o resto do sistema procura.
    const texto = valor.trim().toUpperCase();
    return texto === '' || texto === 'NULL' ? null : texto;
  },
  z
    .string()
    .max(100, 'Número de série: máximo de 100 caracteres')
    .nullable()
    .optional()
    .refine(valor => !valor || SERIAL_REGEX.test(valor), { message: SERIAL_INVALIDO_MENSAGEM }),
);

export const portalVeiculoSchema = z.object({
  /** ⚠️ TEXTO — `ABC-123456` é uma série válida. */
  serialNumber: portalSerialSchema,
  /** `plateSchema` (schemas/common.ts) — limpa, valida antiga e Mercosul. */
  plate: plateSchema,
  /** `chassisNumberSchema` — 17 caracteres, sem I/O/Q. */
  chassisNumber: chassisNumberSchema,
  /**
   * CATEGORIA E IMPLEMENTO — na PORTA, e não só depois.
   *
   * ⚠️ São dado do cliente, e ele os conhece no momento em que pede o
   * orçamento: pedi-los aqui evita a ida e volta de "qual é o implemento?" que
   * o comercial fazia por telefone antes de precificar — pintura de baú
   * frigorífico não custa o mesmo que a de um sider.
   *
   * Opcionais de propósito: quem não souber deixa em branco, e o campo continua
   * corrigível no portal (`PATCH …/identificacao`) até a assinatura congelar a
   * folha.
   */
  category: z.nativeEnum(ImplementCategory).nullable().optional(),
  implementType: z.nativeEnum(ImplementType).nullable().optional(),
  /** ⚠️ EM CENTÍMETROS. O serviço divide por 100 antes de gravar. */
  medidas: portalMedidasSchema.nullable().optional(),
});

export const MAXIMO_VEICULOS = 100;
export const MAXIMO_BASE_FILES = 30;

// ═══════════════════════════════════════════════════════════════════════════
// A REQUISIÇÃO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O CORPO, já desembrulhado.
 *
 * Exportado separado de `portalRequisicaoSchema` para que se possa validar o
 * corpo JSON puro sem passar pelo desembrulho — e para que o teste possa provar
 * que as duas formas produzem o MESMO objeto.
 */
export const portalRequisicaoCorpoSchema = z
  .object({
    /** Cliente DONO dos veículos, já cadastrado. Exclusivo com `novoCliente`. */
    customerId: z.preprocess(
      valor => {
        if (typeof valor !== 'string') return valor;
        const texto = valor.trim();
        return texto === '' || texto === 'null' ? undefined : texto;
      },
      z.string().uuid('Cliente inválido').optional(),
    ),
    /** OU o cadastro na hora, pela opção "criar" da combobox. */
    novoCliente: jsonish(portalNovoClienteSchema.optional()),

    /**
     * "FATURAR PARA" — vira o único `BudgetPayer` do orçamento.
     *
     * ⚠️ DESVIO DO CONTRATO, e necessário: §5 declara este campo obrigatório, e
     * com `novoCliente` ele é IMPOSSÍVEL de preencher — o cliente ainda não tem
     * id quando o formulário é enviado. Ausente = o pagador É o dono dos
     * veículos, que é o caso comum e o único expressável na criação inline.
     */
    faturarParaCustomerId: z.preprocess(
      valor => {
        if (typeof valor !== 'string') return valor;
        const texto = valor.trim();
        return texto === '' || texto === 'null' ? undefined : texto;
      },
      z.string().uuid('Cliente de faturamento inválido').optional(),
    ),

    /** `BudgetRequest.briefing` — o texto livre do pedido. */
    briefing: z
      .string({ required_error: 'Descreva o que você precisa' })
      .trim()
      .min(1, 'Descreva o que você precisa')
      .max(10_000, 'Descrição: máximo de 10.000 caracteres'),

    /** `BudgetRequest.logoName`. A ARTE vai em `baseFiles`; aqui é só o nome. */
    logoName: textoOpcional(200, 'Nome da logomarca'),

    /** `Task.paintId` (a tinta geral). Exclusivo com `novaTinta`. */
    paintId: z.preprocess(
      valor => {
        if (typeof valor !== 'string') return valor;
        const texto = valor.trim();
        return texto === '' || texto === 'null' ? undefined : texto;
      },
      z.string().uuid('Tinta inválida').optional(),
    ),
    /** OU criar a tinta na hora — `{ name, hex, finish, paintTypeId }`. */
    novaTinta: jsonish(portalNovaTintaSchema.optional()),

    /** UMA LINHA POR VEÍCULO. Nunca um produto cartesiano — ver o cabeçalho. */
    veiculos: jsonish(
      z
        .array(portalVeiculoSchema)
        .min(1, 'Informe ao menos um veículo')
        .max(MAXIMO_VEICULOS, `Máximo de ${MAXIMO_VEICULOS} veículos por requisição`),
    ),
  })
  .refine(dados => Boolean(dados.customerId) !== Boolean(dados.novoCliente), {
    message: 'Escolha um cliente existente OU cadastre um novo — nunca os dois',
    path: ['customerId'],
  })
  .refine(dados => !(dados.paintId && dados.novaTinta), {
    message: 'Escolha uma tinta existente OU crie uma nova — nunca as duas',
    path: ['paintId'],
  });

/**
 * O QUE A ROTA USA — o corpo, com o desembrulho de `payload` por cima.
 *
 * ⚠️ A validação e o contrato de ERRO são os mesmos: o desembrulho é um passo
 * ANTES, e tudo o que já era recusado continua recusado com a mesma mensagem e
 * o mesmo `path`. O único erro novo é o do `payload` ilegível.
 */
export const portalRequisicaoSchema = z.preprocess(
  desempacotarPayload,
  portalRequisicaoCorpoSchema,
);

export type PortalRequisicaoFormData = z.infer<typeof portalRequisicaoSchema>;
export type PortalVeiculoFormData = z.infer<typeof portalVeiculoSchema>;
export type PortalMedidaLadoFormData = z.infer<typeof portalMedidaLadoSchema>;
export type PortalNovoClienteFormData = z.infer<typeof portalNovoClienteSchema>;
export type PortalNovaTintaFormData = z.infer<typeof portalNovaTintaSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// AS COLISÕES — a armadilha nº 1 do contrato, detectada ANTES de escrever
// ═══════════════════════════════════════════════════════════════════════════

/** Um choque de unicidade, com o valor que o cliente precisa corrigir. */
export interface PortalColisao {
  field: 'serialNumber' | 'plate';
  value: string;
  /** `payload` = repetido dentro do próprio envio; `database` = já existe. */
  scope: 'payload' | 'database';
  /** Índices 0-based das linhas de `veiculos` envolvidas. */
  vehicleIndexes: number[];
}

const ROTULO_CAMPO: Record<PortalColisao['field'], string> = {
  serialNumber: 'número de série',
  plate: 'placa',
};

/**
 * Monta a frase que o cliente lê. NOMEIA o valor — é a diferença entre
 * "Unique constraint failed on the fields: (`serialNumber`)" e "a série 1003
 * está repetida nos veículos 2 e 4".
 */
export function descreverColisao(colisao: PortalColisao): string {
  const rotulo = ROTULO_CAMPO[colisao.field];
  // 1-BASED. O índice do array é do programa; a linha do formulário é do
  // cliente, e é ela que ele vai procurar na tela.
  const linhas = colisao.vehicleIndexes.map(indice => String(indice + 1));
  const lista =
    linhas.length > 1 ? `${linhas.slice(0, -1).join(', ')} e ${linhas[linhas.length - 1]}` : linhas[0];

  if (colisao.scope === 'payload') {
    return `O ${rotulo} ${colisao.value} está repetido nos veículos ${lista} desta requisição.`;
  }
  return `O ${rotulo} ${colisao.value} (veículo ${lista}) já está cadastrado em outro serviço.`;
}

/**
 * COLISÕES DENTRO DO PRÓPRIO ENVIO.
 *
 * Função PURA, e de propósito: é a metade da armadilha nº 1 que não precisa do
 * banco, e é a que o produto cartesiano do formulário interno produz — N placas
 * com a MESMA série. Aqui ela é detectada antes de qualquer escrita.
 *
 * `null`/ausente não colide com `null`: as duas colunas são `String?` e o
 * Postgres não considera dois NULLs iguais num índice único. Uma requisição de
 * cinco baús ainda sem placa é legítima.
 */
export function colisoesNoPayload(
  veiculos: ReadonlyArray<{ serialNumber?: string | null; plate?: string | null }>,
): PortalColisao[] {
  const colisoes: PortalColisao[] = [];

  for (const field of ['serialNumber', 'plate'] as const) {
    const porValor = new Map<string, number[]>();
    veiculos.forEach((veiculo, indice) => {
      const valor = veiculo[field];
      if (typeof valor !== 'string' || valor === '') return;
      const lista = porValor.get(valor);
      if (lista) lista.push(indice);
      else porValor.set(valor, [indice]);
    });
    for (const [valor, indices] of porValor) {
      if (indices.length > 1) {
        colisoes.push({ field, value: valor, scope: 'payload', vehicleIndexes: indices });
      }
    }
  }

  return colisoes;
}

/**
 * As medidas de um lado, já EM METROS e no formato que o Prisma grava.
 *
 * Fica aqui, e não no serviço, para que o teste possa provar a conversão sem
 * subir o Nest.
 */
export function medidaParaPrisma(medida: PortalMedidaLadoFormData): {
  height: number;
  sections: Array<{ width: number; isDoor: boolean; doorHeight: number | null; position: number }>;
} {
  return {
    height: centimetrosParaMetros(medida.height),
    sections: medida.sections.map((secao, indice) => ({
      width: centimetrosParaMetros(secao.width),
      isDoor: secao.isDoor,
      // Altura de porta só sobrevive quando a seção É porta: guardar a altura de
      // uma porta que não existe faz o desenho do implemento mentir.
      doorHeight:
        secao.isDoor && secao.doorHeight !== null && secao.doorHeight !== undefined
          ? centimetrosParaMetros(secao.doorHeight)
          : null,
      position: secao.position ?? indice,
    })),
  };
}
