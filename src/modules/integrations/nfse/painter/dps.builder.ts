/**
 * Construtor da DPS (Declaração de Prestação de Serviços) — layout nacional 1.01,
 * recorte MEI.
 *
 * O XML é montado à mão, string a string, e não por serializador genérico. Isso é
 * deliberado: a assinatura XMLDSig cobre os BYTES exatos deste documento, e
 * qualquer reserialização posterior (reindentar, reordenar atributo, reescapar
 * entidade) invalida o digest. Montando aqui, o que é assinado e o que é
 * transmitido são literalmente a mesma string.
 *
 * Três armadilhas de recepção que a forma abaixo evita, todas com código de
 * rejeição próprio:
 *   E1228 — prefixo de namespace é PROIBIDO. Tem de ser <DPS xmlns="..."> e nunca
 *           <ns1:DPS>. É o erro que mais derruba integração nova.
 *   E1229 — o XML precisa ser UTF-8 sem BOM.
 *   E1225 — o corpo é gzip PRIMEIRO, base64 depois (feito no client, não aqui).
 *
 * Referência: ANEXO I – SEFIN_ADN – DPS_NFSe – SNNFSe v1.01 (2026-02-09), abas
 * "LEIAUTE DPS_NFS-e" e "RN DPS_NFS-e".
 */

import { IMPLEMENT_TYPE_LABELS, TRUCK_CATEGORY_LABELS } from '@constants/enum-labels';

export const NFSE_NAMESPACE = 'http://www.sped.fazenda.gov.br/nfse';
export const DPS_LAYOUT_VERSION = '1.01';
/** Identificação do software emissor, ecoada de volta pela SEFIN nos retornos. */
export const VER_APLIC = 'ANKAA-1.0';

/** prest/regTrib/opSimpNac */
export const OP_SIMP_NAC = {
  NAO_OPTANTE: 1,
  MEI: 2,
  ME_EPP: 3,
} as const;

/** valores/trib/tribMun/tribISSQN */
export const TRIB_ISSQN = {
  OPERACAO_TRIBUTAVEL: 1,
  IMUNIDADE: 2,
  EXPORTACAO: 3,
  NAO_INCIDENCIA: 4,
} as const;

/** valores/trib/tribMun/tpRetISSQN */
export const TP_RET_ISSQN = {
  NAO_RETIDO: 1,
  RETIDO_PELO_TOMADOR: 2,
  RETIDO_PELO_INTERMEDIARIO: 3,
} as const;

export interface DpsEmitente {
  /** CNPJ do prestador, 14 dígitos. */
  cnpj: string;
  /** Inscrição municipal. Omitida do XML quando ausente (E0116 só exige com registro no CNC). */
  inscricaoMunicipal?: string | null;
  /** Código IBGE do município do emitente (7 dígitos) — cLocEmi. */
  municipioIbge: string;
  opSimpNac: number;
  regEspTrib: number;
}

export interface DpsTomador {
  cnpj?: string | null;
  cpf?: string | null;
  nome: string;
  /**
   * Endereço é OPCIONAL no layout — o tomador é identificado pelo CNPJ/CPF e o
   * sistema nacional resolve o resto pelo cadastro. Sem `municipioIbge` e `cep`
   * o grupo `<end>` inteiro é omitido.
   *
   * Isso não é preciosismo: um CEP genérico de cidade (terminado em -000) não
   * existe na base dos Correios como CEP de entrega, e a SEFIN rejeita com
   * E0240 ("o CEP não existe ou não pertence ao município"). Mandar endereço
   * errado é pior do que não mandar.
   */
  municipioIbge?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  email?: string | null;
}

export interface DpsServico {
  /** Código IBGE do município onde o serviço foi prestado. */
  municipioPrestacaoIbge: string;
  /** Código de tributação nacional, 6 dígitos. */
  cTribNac: string;
  cTribMun?: string | null;
  descricao: string;
}

export interface DpsInput {
  /** 1 = Produção, 2 = Produção Restrita. */
  ambiente: 1 | 2;
  /** Data/hora da emissão. */
  emitidoEm: Date;
  /** Competência (mês do serviço). */
  competencia: Date;
  serie: string;
  nDps: bigint | number;
  emitente: DpsEmitente;
  tomador: DpsTomador;
  servico: DpsServico;
  /** Valor do serviço em reais. */
  valorServico: number;
}

export interface BuiltDps {
  xml: string;
  /** infDPS/@Id — "DPS" + 42 dígitos. */
  id: string;
}

/** Escapa texto para conteúdo de elemento XML. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function el(name: string, value: string | number | bigint): string {
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

/** Elemento opcional: string vazia quando o valor não existe — nunca `<IM/>`. */
function optionalEl(name: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text ? el(name, text) : '';
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Data/hora no formato TSDateTimeUTC: AAAA-MM-DDThh:mm:ss-03:00.
 *
 * Sem milissegundos e com offset explícito — "Z" é rejeitado. O Brasil não tem
 * horário de verão desde 2019, então -03:00 é constante.
 */
export function formatDpsDateTime(date: Date): string {
  const shifted = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
    `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}-03:00`
  );
}

/** Competência no formato AAAA-MM-DD, no fuso de São Paulo. */
export function formatCompetence(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Monta o Id da DPS: "DPS" + cLocEmi(7) + tpInscFed(1) + inscrição(14) + série(5) + nDPS(15).
 *
 * tpInscFed: 1 = CPF, 2 = CNPJ. CPF é preenchido à esquerda com zeros até 14.
 */
export function buildDpsId(params: {
  municipioIbge: string;
  documento: string;
  serie: string;
  nDps: bigint | number;
}): string {
  // Município NÃO é preenchido com zeros: um código IBGE tem exatamente 7
  // dígitos, e completar um código truncado produziria um Id bem-formado
  // apontando para OUTRO município — erro que passa por toda validação de
  // formato e só aparece como rejeição obscura da SEFIN.
  const municipio = onlyDigits(params.municipioIbge);
  if (municipio.length !== 7) {
    throw new Error(
      `Código IBGE do município inválido ("${params.municipioIbge}") — são exatamente 7 dígitos.`,
    );
  }

  const documento = onlyDigits(params.documento);
  if (documento.length !== 11 && documento.length !== 14) {
    throw new Error(
      `Documento do emitente inválido ("${params.documento}") — CPF tem 11 dígitos e CNPJ tem 14.`,
    );
  }
  const tpInscFed = documento.length === 14 ? '2' : '1';
  // Aqui o preenchimento É correto: o leiaute reserva 14 posições para a
  // inscrição federal e manda completar CPF com zeros à esquerda.
  const inscricao = documento.padStart(14, '0');
  const serie = onlyDigits(params.serie).padStart(5, '0');
  const numero = String(params.nDps).padStart(15, '0');

  const id = `DPS${municipio}${tpInscFed}${inscricao}${serie}${numero}`;
  if (!/^DPS\d{42}$/.test(id)) {
    throw new Error(
      `Id da DPS inválido (${id}) — esperado "DPS" seguido de 42 dígitos. Verifique município, CNPJ, série e número.`,
    );
  }
  return id;
}

/**
 * Monta o XML da DPS para um prestador MEI.
 *
 * O grupo tributário segue as regras que se aplicam especificamente ao MEI, e o
 * ponto contraintuitivo é que **não se envia ISS zerado — não se envia ISS**:
 *   E0174 — regEspTrib tem de ser 0 (Nenhum) quando o prestador é MEI.
 *   E0162 — regApTribSN é PROIBIDO para opSimpNac 1 ou 2, então nem aparece.
 *   E0583 — tpRetISSQN é obrigatoriamente 1 (Não Retido): MEI nunca sofre
 *           retenção de ISS, porque o imposto já está dentro do DAS.
 *   E0600 — é proibido informar alíquota (pAliq) quando o prestador é MEI.
 *   E0676 — o grupo tribFed é proibido para MEI.
 *   E0710 — em totTrib, pTotTribSN é proibido para MEI; usamos indTotTrib=0.
 */
export function buildDpsXml(input: DpsInput): BuiltDps {
  const { emitente, tomador, servico } = input;

  const cnpjEmitente = onlyDigits(emitente.cnpj);
  if (cnpjEmitente.length !== 14) {
    throw new Error(`CNPJ do emitente inválido: "${emitente.cnpj}".`);
  }

  const id = buildDpsId({
    municipioIbge: emitente.municipioIbge,
    documento: cnpjEmitente,
    serie: input.serie,
    nDps: input.nDps,
  });

  const valor = Number(input.valorServico);
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error(`Valor do serviço inválido para emissão: ${input.valorServico}.`);
  }

  const descricao = servico.descricao.trim();
  if (descricao.length < 1) {
    throw new Error('Descrição do serviço é obrigatória na DPS.');
  }

  const prest = [
    el('CNPJ', cnpjEmitente),
    optionalEl('IM', emitente.inscricaoMunicipal),
    `<regTrib>${el('opSimpNac', emitente.opSimpNac)}${el('regEspTrib', emitente.regEspTrib)}</regTrib>`,
  ].join('');

  // O grupo <end> só é montado com município E CEP presentes. Endereço parcial
  // ou com CEP genérico é rejeitado (E0240); sem endereço, a SEFIN resolve pelo
  // cadastro do CNPJ.
  const municipioTomador = onlyDigits(tomador.municipioIbge ?? '');
  const cepTomador = onlyDigits(tomador.cep ?? '');
  const temEndereco = municipioTomador.length === 7 && cepTomador.length === 8;

  const enderecoTomador = temEndereco
    ? `<end><endNac>${el('cMun', municipioTomador)}${el('CEP', cepTomador)}</endNac>` +
      optionalEl('xLgr', tomador.logradouro) +
      optionalEl('nro', tomador.numero) +
      optionalEl('xCpl', tomador.complemento) +
      optionalEl('xBairro', tomador.bairro) +
      `</end>`
    : '';

  const toma = [
    tomador.cnpj ? el('CNPJ', onlyDigits(tomador.cnpj)) : '',
    !tomador.cnpj && tomador.cpf ? el('CPF', onlyDigits(tomador.cpf)) : '',
    el('xNome', tomador.nome),
    enderecoTomador,
    optionalEl('email', tomador.email),
  ].join('');

  const serv = [
    `<locPrest>${el('cLocPrestacao', onlyDigits(servico.municipioPrestacaoIbge).padStart(7, '0'))}</locPrest>`,
    `<cServ>${el('cTribNac', servico.cTribNac)}${optionalEl('cTribMun', servico.cTribMun)}${el('xDescServ', descricao)}</cServ>`,
  ].join('');

  const valores =
    `<vServPrest>${el('vServ', valor.toFixed(2))}</vServPrest>` +
    `<trib>` +
    `<tribMun>${el('tribISSQN', TRIB_ISSQN.OPERACAO_TRIBUTAVEL)}${el('tpRetISSQN', TP_RET_ISSQN.NAO_RETIDO)}</tribMun>` +
    `<totTrib>${el('indTotTrib', 0)}</totTrib>` +
    `</trib>`;

  const infDps =
    `<infDPS Id="${id}">` +
    el('tpAmb', input.ambiente) +
    el('dhEmi', formatDpsDateTime(input.emitidoEm)) +
    el('verAplic', VER_APLIC) +
    el('serie', onlyDigits(input.serie).padStart(5, '0')) +
    el('nDPS', String(input.nDps)) +
    el('dCompet', formatCompetence(input.competencia)) +
    el('tpEmit', 1) + // 1 = Prestador. Emissão por tomador/intermediário ainda não existe no sistema nacional.
    el('cLocEmi', onlyDigits(emitente.municipioIbge).padStart(7, '0')) +
    `<prest>${prest}</prest>` +
    `<toma>${toma}</toma>` +
    `<serv>${serv}</serv>` +
    `<valores>${valores}</valores>` +
    `</infDPS>`;

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<DPS xmlns="${NFSE_NAMESPACE}" versao="${DPS_LAYOUT_VERSION}">${infDps}</DPS>`;

  return { xml, id };
}

/** Motivos aceitos no evento de cancelamento e101101. */
export const CANCEL_REASON = {
  ERRO_NA_EMISSAO: 1,
  SERVICO_NAO_PRESTADO: 2,
  OUTROS: 9,
} as const;

export interface CancelEventInput {
  ambiente: 1 | 2;
  /** Chave de acesso da NFS-e, 50 dígitos. */
  chaveAcesso: string;
  /** CNPJ de quem pede o cancelamento (o próprio prestador). */
  cnpjAutor: string;
  ocorridoEm: Date;
  /** Descrição curta (5-60 caracteres). */
  descricao: string;
  motivoCodigo: number;
  /** Justificativa (15-255 caracteres). */
  motivo: string;
}

/**
 * Monta o pedido de registro do evento de cancelamento (e101101).
 *
 * VALIDADO contra a SEFIN em produção restrita (14/08/2026): o ciclo
 * emitir → consultar → cancelar respondeu HTTP 201. Duas correções foram
 * necessárias, ambas descobertas ali:
 *   1. o Id é `PRE[0-9]{56}` (TSIdPedRegEvt), não "EVT"+59 (TSIdEvento, que é o
 *      identificador do evento que a SEFIN gera em resposta);
 *   2. `nPedRegEvento` NÃO é filho de infPedReg — depois de chNFSe vem direto o
 *      elemento do evento.
 * O campo do corpo JSON é `pedidoRegistroEventoXmlGZipB64` (o nome alternativo
 * devolve HTTP 500).
 *
 * Reproduzível com `npm run probe:painter-nfse-cancel`.
 */
export function buildCancelEventXml(input: CancelEventInput): { xml: string; id: string } {
  const chave = onlyDigits(input.chaveAcesso);
  if (chave.length !== 50) {
    throw new Error(`Chave de acesso inválida (${chave.length} dígitos, esperado 50).`);
  }

  const tpEvento = 'e101101';

  // O identificador do PEDIDO de registro é `TSIdPedRegEvt`, cujo padrão no XSD
  // é `PRE[0-9]{56}` = "PRE" + chave(50) + tipo do evento(6). NÃO leva o
  // sequencial, e NÃO usa o prefixo "EVT".
  //
  // "EVT" + 59 dígitos é o `TSIdEvento` — o identificador do EVENTO que a SEFIN
  // gera em resposta, não o do nosso pedido. Confundir os dois é rejeição
  // E1235 ("Falha no esquema XML do DF-e", pattern constraint failed), que foi
  // exatamente o que a produção restrita devolveu na primeira tentativa.
  const id = `PRE${chave}${tpEvento.slice(1)}`;
  if (!/^PRE\d{56}$/.test(id)) {
    throw new Error(`Id do pedido de registro de evento inválido (${id}).`);
  }

  const infPedReg =
    `<infPedReg Id="${id}">` +
    el('tpAmb', input.ambiente) +
    el('verAplic', VER_APLIC) +
    el('dhEvento', formatDpsDateTime(input.ocorridoEm)) +
    el('CNPJAutor', onlyDigits(input.cnpjAutor)) +
    el('chNFSe', chave) +
    // NÃO existe <nPedRegEvento> dentro de infPedReg: depois de chNFSe vem
    // direto o elemento do evento. Enviá-lo é rejeição E1235 ("has invalid
    // child element 'nPedRegEvento' ... List of possible elements expected:
    // e101101, e105102, ..."). O sequencial existe só como campo de entrada
    // nosso, e nem entra no Id do pedido.
    `<${tpEvento}>` +
    el('xDesc', input.descricao) +
    el('cMotivo', input.motivoCodigo) +
    el('xMotivo', input.motivo) +
    `</${tpEvento}>` +
    `</infPedReg>`;

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<pedRegEvento xmlns="${NFSE_NAMESPACE}" versao="${DPS_LAYOUT_VERSION}">${infPedReg}</pedRegEvento>`;

  return { xml, id };
}

/** Limite de xDescServ no leiaute: 1300, com reticências acima de 1297 (NT 2.4.5). */
const MAX_SERVICE_DESCRIPTION = 1300;

export interface ServicoTaskRef {
  name: string;
  serialNumber: string | null;
  customer?: { fantasyName: string | null; corporateName: string | null } | null;
  truck?: {
    plate: string | null;
    chassisNumber: string | null;
    category: string | null;
    implementType: string | null;
  } | null;
}

/**
 * Descrição do serviço (xDescServ) na DPS.
 *
 * Segue a forma que as notas REAIS deste negócio já usam, e não um texto
 * genérico:
 *   - as 42 NFS-e que o próprio aerografista emitiu pelo portal citam o
 *     serviço e o veículo ("PRESTAÇÃO DE SERVIÇOS EM REFORMA E PINTURA DE
 *     CAMINHÃO BETONEIRA", "Caminhão Confiança (Morango Lado Esquerdo)
 *     Placa: FIB-9473");
 *   - as notas que a empresa emite pela Elotech usam
 *     "Referente aos serviços executados no veículo {categoria} {implemento}
 *     de n série: X, placa: Y, chassi: Z."
 *
 * Uma descrição vaga é problema fiscal de verdade: é ela que liga a nota ao
 * serviço prestado numa eventual conferência.
 */
export function buildServiceDescription(
  fallback: string,
  airbrushing: {
    description: string | null;
    task: {
      name: string;
      serialNumber: string | null;
      customer?: { fantasyName: string | null; corporateName: string | null } | null;
      truck?: {
        plate: string | null;
        chassisNumber: string | null;
        category: string | null;
        implementType: string | null;
      } | null;
    } | null;
  },
): string {
  const linhas: string[] = [];

  /** Fecha cada trecho com ponto — sem isso as frases saem coladas. */
  const frase = (texto: string): string => {
    const limpo = texto.trim().replace(/\s+/g, ' ');
    if (!limpo) return '';
    return /[.!?]$/.test(limpo) ? limpo : `${limpo}.`;
  };

  // 1. A natureza do serviço, sempre.
  linhas.push(frase(fallback));

  // 2. O que foi feito nesta aerografia, quando o usuário descreveu.
  const detalhe = airbrushing.description?.trim();
  if (detalhe) linhas.push(frase(detalhe));

  // 3. O veículo, no formato das notas da Elotech.
  const task = airbrushing.task;
  const truck = task?.truck;
  const tipo = [
    truck?.category ? (TRUCK_CATEGORY_LABELS[truck.category as never] ?? truck.category) : null,
    truck?.implementType
      ? (IMPLEMENT_TYPE_LABELS[truck.implementType as never] ?? truck.implementType)
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  // O nº de série é da ORDEM DE SERVIÇO, não do veículo — só entra na frase do
  // veículo quando existe veículo. Sem essa guarda, uma aerografia sem caminhão
  // produzia "no veículo de n série: 999", que afirma algo falso.
  const temVeiculo = Boolean(truck?.plate || truck?.chassisNumber || tipo);
  const identificadores = temVeiculo
    ? [
        task?.serialNumber ? `n série: ${task.serialNumber}` : null,
        truck?.plate ? `placa: ${truck.plate}` : null,
        truck?.chassisNumber ? `chassi: ${truck.chassisNumber}` : null,
      ]
        .filter(Boolean)
        .join(', ')
    : '';

  if (tipo && identificadores) {
    linhas.push(`Referente aos serviços executados no veículo ${tipo} de ${identificadores}.`);
  } else if (tipo) {
    linhas.push(`Referente aos serviços executados no veículo ${tipo}.`);
  } else if (identificadores) {
    linhas.push(`Referente aos serviços executados no veículo de ${identificadores}.`);
  } else if (task?.name) {
    linhas.push(`Referente à ordem de serviço ${task.serialNumber ?? task.name}.`);
  }

  // 4. O cliente final, que é quem identifica o veículo no dia a dia.
  const cliente = task?.customer?.fantasyName || task?.customer?.corporateName;
  if (cliente) linhas.push(frase(`Cliente: ${cliente}`));

  // NT 2.4.5: xDescServ aceita 1300 caracteres, com reticências acima de 1297.
  const texto = linhas.filter(Boolean).join(' ');
  return texto.length > MAX_SERVICE_DESCRIPTION
    ? `${texto.slice(0, MAX_SERVICE_DESCRIPTION - 3)}...`
    : texto;
}

