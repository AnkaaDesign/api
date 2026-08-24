/**
 * Geração do DANFSe (Documento Auxiliar da NFS-e) a partir do XML autorizado.
 *
 * Segue a **Nota Técnica nº 008 SE/CGNFS-e — versão 1.02, de 14/07/2026**, que é
 * a vigente (a 1.0, de 05/05/2026, e a 1.01 foram superadas). As coordenadas de
 * bloco são idênticas entre as versões; o que a 1.02 mudou e importa aqui é a
 * data de suspensão da API, a contagem de caracteres dos campos e o tratamento
 * de vPis/vCofins/tpRetPisCofins.
 *
 * Por que geramos em casa: a API nacional de DANFSe não atende mais.
 * A própria NT 008 (§1) determina que "a API de geração do DANFSe será
 * sobrestada (suspensa) na data de **03 de agosto de 2026**" — já passou. As
 * sondas confirmam: SEFIN devolve **501 Not Implemented** e o `/danfse` do ADN
 * devolve **503 "No server is available"**. Não há API substituta; a geração do
 * PDF passou a ser responsabilidade do emitente.
 *
 * Este documento é AUXILIAR: o documento fiscal é o XML. O PDF serve para
 * conferência humana e anexo, e por isso o critério aqui é legibilidade e
 * fidelidade aos dados — não reprodução pixel a pixel do modelo oficial.
 *
 * Nenhuma rede, nenhum disco: XML entra, Buffer sai.
 */

import { XMLParser } from 'fast-xml-parser';
import PDFDocument from 'pdfkit';

export interface DanfseParty {
  documento: string | null;
  inscricaoMunicipal: string | null;
  telefone: string | null;
  nome: string | null;
  municipio: string | null;
  uf: string | null;
  codigoIbge: string | null;
  cep: string | null;
  endereco: string | null;
  email: string | null;
}

export interface DanfseData {
  // ── Identificação (NT 2.1.2) ──
  chaveAcesso: string | null;
  numeroNfse: string | null;
  competencia: string | null;
  dataHoraNfse: string | null;
  numeroDps: string | null;
  serieDps: string | null;
  dataHoraDps: string | null;
  tpEmit: string | null;
  cStat: string | null;
  finalidade: string | null;
  /** tpAmb da DPS: 1 = produção, 2 = homologação. Decide "SEM VALIDADE JURÍDICA". */
  tpAmb: number | null;
  /** ambGer: 1 = Prefeitura, 2 = Sistema Nacional. É informativo no cabeçalho. */
  ambGer: string | null;
  municipioEmitente: string | null;

  // ── Partes (NT 2.1.3 a 2.1.6) ──
  prestador: DanfseParty;
  prestadorOpSimpNac: string | null;
  prestadorRegApTribSN: string | null;
  tomador: DanfseParty;
  /**
   * Destinatário da operação — grupo `IBSCBS/dest` do leiaute (NT 005, item
   * 2.1.1). Só existe nas notas do leiaute da Reforma Tributária; nas demais
   * vem inteiro vazio.
   */
  destinatario: DanfseParty;
  /**
   * `IBSCBS/indDest` (NT 005): 0 = o destinatário é o próprio tomador/adquirente;
   * 1 = é outra pessoa. Ausente nas notas anteriores à Reforma.
   */
  indDest: string | null;

  // ── Serviço (NT 2.1.7) ──
  cTribNac: string | null;
  cTribMun: string | null;
  cNBS: string | null;
  localPrestacao: string | null;
  descricaoTributacao: string | null;
  descricaoServico: string | null;

  // ── Tributação municipal (NT 2.1.8) ──
  tribISSQN: string | null;
  municipioIncidencia: string | null;
  regEspTrib: string | null;
  tpImunidade: string | null;
  suspensaoExigibilidade: string | null;
  numeroProcessoSuspensao: string | null;
  beneficioMunicipal: string | null;
  calculoBM: string | null;
  totalDeducoesReducoes: number | null;
  descontoIncondicionado: number | null;
  bcIssqn: number | null;
  aliquotaAplicada: string | null;
  retencaoIssqn: string | null;
  issqnApurado: number | null;

  // ── Tributação federal (NT 2.1.9) ──
  vIrrf: number | null;
  vContribPrev: number | null;
  vContribSociais: number | null;
  vPis: number | null;
  vCofins: number | null;
  /** 1 = PIS/COFINS Retido — muda o cálculo das linhas federais (NT v1.02). */
  tpRetPisCofins: string | null;
  vTotTribFed: number | null;
  vTotTribEst: number | null;
  vTotTribMun: number | null;

  // ── Valor total (NT 2.1.11) ──
  valorServico: number | null;
  descontoCondicionado: number | null;
  totalRetencoes: number | null;
  valorLiquido: number | null;
  totalIbsCbs: number | null;
  valorLiquidoMaisIbsCbs: number | null;

  // ── Informações complementares (NT 2.1.12) ──
  informacoesComplementares: string | null;
  chaveSubstituida: string | null;

  cancelada: boolean;
  substituida: boolean;
}


const parser = new XMLParser({
  // Precisa do @_Id para derivar a chave quando chNFSe não vem.
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Sem isto, "00001" vira 1 e município/CNPJ perdem os zeros à esquerda.
  parseTagValue: false,
  // A assinatura vem com prefixo de namespace; sem remover, os nós dela
  // aparecem com nomes qualificados e atrapalham a navegação.
  removeNSPrefix: true,
  trimValues: true,
});

/** Primeiro caminho que existir, entre vários candidatos. Nada aqui pode lançar. */
function pick(source: any, ...paths: string[]): string | null {
  for (const path of paths) {
    let cursor = source;
    let ok = true;
    for (const segment of path.split('.')) {
      if (cursor === null || cursor === undefined || typeof cursor !== 'object') {
        ok = false;
        break;
      }
      cursor = cursor[segment];
    }
    if (!ok || cursor === null || cursor === undefined) continue;
    if (typeof cursor === 'object') continue;
    const value = String(cursor).trim();
    if (value) return value;
  }
  return null;
}

function toNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatCnpjCpf(document: string | null): string {
  const digits = (document ?? '').replace(/\D/g, '');
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  return document ?? '-';
}

/** Chave em grupos de 4 — 50 dígitos corridos são impossíveis de conferir a olho. */
export function formatAccessKey(key: string | null): string {
  const digits = (key ?? '').replace(/\D/g, '');
  if (!digits) return '-';
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Moeda formatada à mão, de propósito.
 *
 * `Intl.NumberFormat('pt-BR', {style:'currency'})` insere um NBSP (U+00A0) entre
 * "R$" e o número, e no pdfkit isso sai como espaço torto ou caractere ausente.
 */
export function formatCurrency(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  const [inteiro, centavos] = Math.abs(value).toFixed(2).split('.');
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${value < 0 ? '-' : ''}R$ ${comMilhar},${centavos}`;
}

export function formatCep(value: string | null): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length !== 8) return digits || null;
  // nn.nnn-nnn — máscara que a NT 2.4.5 especifica e que o emissor oficial usa.
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}-${digits.slice(5)}`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * UF a partir dos dois primeiros dígitos do código IBGE do município.
 *
 * O leiaute NÃO tem campo de UF no endereço nacional (`TCEndereco/endNac` só
 * traz `cMun` e `CEP` — XSD v1.01), então o município do tomador saía como
 * "Ibiporã / -" enquanto a consulta pública do portal mostra "Ibiporã/PR".
 *
 * Isto não é inventar dado que não está no XML (o que a NT 2.1 proíbe): a UF
 * está DENTRO do código do município, é o prefixo dele. A tabela é a do IBGE e
 * não muda — 26 estados e o Distrito Federal.
 */
const UF_POR_PREFIXO_IBGE: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
  '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR',
  '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

export function ufDoCodigoIbge(codigo: string | null): string | null {
  const digits = (codigo ?? '').replace(/\D/g, '');
  if (digits.length !== 7) return null;
  return UF_POR_PREFIXO_IBGE[digits.slice(0, 2)] ?? null;
}

/** Código IBGE como o emissor oficial imprime: nn.nnnnn. */
export function formatIbge(value: string | null): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length !== 7) return digits || EMPTY_DASH;
  return `${digits.slice(0, 2)}.${digits.slice(2)}`;
}

/** Código de tributação nacional como nn.nn.nn (NT 2.4.5). */
export function formatCodigoTributacao(value: string | null): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length !== 6) return value || EMPTY_DASH;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

/** Série e número sem zeros à esquerda — o emissor oficial imprime "1", não "00001". */
export function stripLeadingZeros(value: string | null): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits) return EMPTY_DASH;
  return String(Number(digits));
}

/** Data e hora COM segundos: DD/MM/AAAA hh:mm:ss (NT 2.4.5). */
export function formatDateTimeSeconds(value: string | null): string {
  if (!value) return EMPTY_DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

const EMPTY_DASH = '-';

export function formatDate(value: string | null): string {
  if (!value) return '-';
  const [ymd] = String(value).split('T');
  const parts = ymd.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
}

/**
 * Extrai os campos do XML autorizado.
 *
 * Defensivo por princípio: nomes e aninhamentos variam entre versões do leiaute,
 * e um DANFSe que estoura porque um campo opcional faltou é pior do que um
 * DANFSe com um "-" no lugar. Nenhum campo é obrigatório aqui.
 */
/**
 * Mapa código IBGE → nome do município, montado A PARTIR DO PRÓPRIO XML.
 *
 * O XML não traz `xMun` nas partes, só o código. O emissor oficial resolve pela
 * tabela do IBGE, que não temos aqui — mas o documento já carrega três pares
 * código/nome (emissão, prestação e incidência), e na prática são justamente os
 * municípios envolvidos. Resolver por eles respeita a regra da NT 2.1 ("não
 * poderão ser impressas informações que não constem do arquivo da NFS-e") e
 * cobre o caso real; o que não estiver no mapa cai em traço.
 */
function buildMunicipioMap(inf: any, dps: any): Record<string, string> {
  const map: Record<string, string> = {};
  const add = (codigo: string | null, nome: string | null) => {
    const c = (codigo ?? '').replace(/\D/g, '');
    if (c.length === 7 && nome) map[c] = nome;
  };
  add(pick(dps, 'cLocEmi'), pick(inf, 'xLocEmi'));
  add(pick(dps, 'serv.locPrest.cLocPrestacao'), pick(inf, 'xLocPrestacao'));
  add(pick(inf, 'cLocIncid'), pick(inf, 'xLocIncid'));
  return map;
}

function buildParty(node: any, ender: any, municipios: Record<string, string> = {}): DanfseParty {
  const endNac = ender?.endNac ?? ender ?? {};
  const logradouro = [pick(ender ?? {}, 'xLgr'), pick(ender ?? {}, 'nro'), pick(ender ?? {}, 'xCpl')]
    .filter(Boolean)
    .join(', ');
  const bairro = pick(ender ?? {}, 'xBairro');

  return {
    documento: pick(node, 'CNPJ') ?? pick(node, 'CPF') ?? pick(node, 'NIF'),
    inscricaoMunicipal: pick(node, 'IM'),
    telefone: pick(node, 'fone'),
    nome: pick(node, 'xNome') ?? pick(node, 'xFant'),
    municipio:
      pick(endNac, 'xMun') ??
      pick(ender ?? {}, 'xMun') ??
      municipios[(pick(endNac, 'cMun') ?? pick(ender ?? {}, 'cMun') ?? '').replace(/\D/g, '')] ??
      null,
    uf:
      pick(endNac, 'UF') ??
      pick(ender ?? {}, 'UF') ??
      ufDoCodigoIbge(pick(endNac, 'cMun') ?? pick(ender ?? {}, 'cMun')),
    codigoIbge: pick(endNac, 'cMun') ?? pick(ender ?? {}, 'cMun'),
    cep: formatCep(pick(endNac, 'CEP') ?? pick(ender ?? {}, 'CEP')),
    endereco: [logradouro || null, bairro].filter(Boolean).join(' - ') || null,
    email: pick(node, 'email'),
  };
}

export function parseNfseXml(nfseXml: string): DanfseData {
  const root = parser.parse(nfseXml) ?? {};
  const nfse = root.NFSe ?? root.nfse ?? root;
  const inf = nfse.infNFSe ?? nfse.InfNFSe ?? {};

  const dps = inf.DPS?.infDPS ?? inf.dps?.infDPS ?? {};
  const emit = inf.emit ?? {};
  const prest = dps.prest ?? {};
  const toma = dps.toma ?? {};
  const serv = dps.serv ?? {};
  const cServ = serv.cServ ?? {};
  const ibsCbs = dps.IBSCBS ?? {};
  const dest = ibsCbs.dest ?? {};
  const valoresDps = dps.valores ?? {};
  const tribMun = valoresDps.trib?.tribMun ?? {};
  const tribFed = valoresDps.trib?.tribFed ?? {};
  const valoresNfse = inf.valores ?? {};

  const municipios = buildMunicipioMap(inf, dps);

  const idAttr = String(inf['@_Id'] ?? '');
  // NT 2.4.5: "Informar o id da NFS-e sem o prefixo 'NFS'".
  const chaveAcesso =
    pick(inf, 'chNFSe') ?? (/^NFS\d{50}$/.test(idAttr) ? idAttr.slice(3) : null);

  const cStat = pick(inf, 'cStat');
  const localPrestacao = [
    pick(inf, 'xLocPrestacao'),
    pick(serv, 'locPrest.cLocPrestacao'),
  ].filter(Boolean)[0] ?? null;

  return {
    chaveAcesso,
    numeroNfse: pick(inf, 'nNFSe'),
    competencia: pick(dps, 'dCompet'),
    dataHoraNfse: pick(inf, 'dhProc'),
    numeroDps: pick(dps, 'nDPS'),
    serieDps: pick(dps, 'serie'),
    dataHoraDps: pick(dps, 'dhEmi'),
    tpEmit: pick(dps, 'tpEmit'),
    cStat,
    finalidade: pick(dps, 'IBSCBS.finNFSe') ?? pick(inf, 'finNFSe'),
    // Só tpAmb decide homologação. `ambGer` é o ambiente GERADOR e vale 2 em
    // toda nota do Sistema Nacional — confundir os dois carimbaria "SEM
    // VALIDADE JURÍDICA" em nota real.
    tpAmb: Number(pick(dps, 'tpAmb') ?? '') || null,
    ambGer: pick(inf, 'ambGer'),
    municipioEmitente: pick(inf, 'xLocEmi'),

    // `emit` é o retrato do CNPJ na base nacional, montado pela SEFIN, e vence
    // nos dados de IDENTIDADE (nome, endereço). No CONTATO é o contrário: o
    // cadastro do CNPJ costuma trazer o e-mail e o telefone do CONTADOR — nas
    // notas do Claudemir, `PARALEGAL@CONSIGA.COM.BR` —, enquanto `prest/fone` e
    // `prest/email` são o que o próprio prestador declarou nesta DPS. Os dois
    // estão no XML, então imprimir o declarado não fere a NT 2.1; imprimir o do
    // contador é que dá ao leitor um canal que não é do emitente.
    prestador: buildParty(
      {
        ...prest,
        ...emit,
        ...(pick(prest, 'fone') ? { fone: pick(prest, 'fone') } : {}),
        ...(pick(prest, 'email') ? { email: pick(prest, 'email') } : {}),
      },
      emit.enderNac ?? emit.ender ?? prest.end ?? null,
      municipios,
    ),
    prestadorOpSimpNac: pick(prest, 'regTrib.opSimpNac'),
    prestadorRegApTribSN: pick(prest, 'regTrib.regApTribSN'),
    tomador: buildParty(toma, toma.end ?? null, municipios),
    destinatario: buildParty(dest, dest.end ?? null, municipios),
    indDest: pick(ibsCbs, 'indDest'),

    cTribNac: pick(cServ, 'cTribNac'),
    cTribMun: pick(cServ, 'cTribMun'),
    cNBS: pick(cServ, 'cNBS'),
    localPrestacao,
    descricaoTributacao: pick(inf, 'xTribNac') ?? pick(inf, 'xTribMun'),
    descricaoServico: pick(cServ, 'xDescServ'),

    tribISSQN: pick(tribMun, 'tribISSQN'),
    municipioIncidencia: pick(inf, 'xLocIncid') ?? pick(inf, 'cLocIncid'),
    regEspTrib: pick(prest, 'regTrib.regEspTrib'),
    tpImunidade: pick(tribMun, 'tpImunidade'),
    suspensaoExigibilidade: pick(tribMun, 'exigSusp.tpSusp'),
    numeroProcessoSuspensao: pick(tribMun, 'exigSusp.nProcesso'),
    beneficioMunicipal: pick(tribMun, 'BM.tpBM'),
    calculoBM: pick(tribMun, 'BM.vRedBCBM'),
    totalDeducoesReducoes: toNumber(pick(valoresDps, 'vDedRed')),
    descontoIncondicionado: toNumber(pick(valoresDps, 'vDescIncond')),
    bcIssqn: toNumber(pick(valoresNfse, 'vBC') ?? pick(tribMun, 'vBC')),
    aliquotaAplicada: pick(valoresNfse, 'pAliqAplic') ?? pick(tribMun, 'pAliq'),
    retencaoIssqn: pick(tribMun, 'tpRetISSQN'),
    issqnApurado: toNumber(pick(valoresNfse, 'vISSQN')),

    vIrrf: toNumber(pick(tribFed, 'vRetIRRF')),
    vContribPrev: toNumber(pick(tribFed, 'vRetCP')),
    vContribSociais: toNumber(pick(tribFed, 'vRetCSLL')),
    vPis: toNumber(pick(tribFed, 'piscofins.vPis')),
    vCofins: toNumber(pick(tribFed, 'piscofins.vCofins')),
    tpRetPisCofins: pick(tribFed, 'piscofins.tpRetPisCofins'),
    // Totais aproximados de tributos (Lei 12.741/2012). Para MEI o leiaute
    // proíbe pTotTribSN, então normalmente vêm ausentes — e ausência vira
    // traço, nunca zero.
    vTotTribFed: toNumber(pick(valoresDps, 'trib.totTrib.vTotTrib.vTotTribFed')),
    vTotTribEst: toNumber(pick(valoresDps, 'trib.totTrib.vTotTrib.vTotTribEst')),
    vTotTribMun: toNumber(pick(valoresDps, 'trib.totTrib.vTotTrib.vTotTribMun')),

    valorServico: toNumber(pick(dps, 'valores.vServPrest.vServ')),
    descontoCondicionado: toNumber(pick(valoresDps, 'vDescCond')),
    totalRetencoes: toNumber(pick(valoresNfse, 'vTotalRet')),
    valorLiquido: toNumber(pick(valoresNfse, 'vLiq')),
    totalIbsCbs: toNumber(pick(inf, 'IBSCBS.totCIBS.vTotIBSCBS')),
    valorLiquidoMaisIbsCbs: toNumber(pick(valoresNfse, 'vTotNF')),

    informacoesComplementares: pick(dps, 'infAdic.xInfComp') ?? pick(inf, 'xInfComp'),
    chaveSubstituida: pick(dps, 'subst.chSubstda') ?? pick(inf, 'chSubstda'),

    cancelada: cStat === '101',
    substituida: cStat === '102',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Renderização — NT 008 SE/CGNFS-e, seções 2.2 a 2.5
//
// A NT define uma grade FIXA em centímetros (item 2.4.5) e manda obedecer a
// disposição do Anexo I (item 2.2.4). Por isso aqui não há fluxo de texto: cada
// campo é desenhado numa coordenada declarada em `danfse.layout.ts`, que é a
// tradução literal da tabela da NT.
//
// Regras estruturais que o código precisa respeitar:
//   2.2   — uma ÚNICA página, retrato, A4 mínimo
//   2.2.3 — borda da página de 1pt; linhas de bloco de 0,5pt; sombreamento 5%
//   2.4   — tudo em preto sólido; exceções: expressão de homologação (vermelho)
//           e marca d'água (cinza K35)
//   2.4.3 — QR Code obrigatório, com posição e tamanho mínimos definidos
//   nota 12 — campo sem informação no XML recebe traço (-)
// ═══════════════════════════════════════════════════════════════════════════════

import {
  BLACK,
  BLOCK_LINE_WIDTH,
  BLOCK_Y,
  COL,
  COLLAPSE_TEXT,
  COLLAPSED_H,
  DESCRICAO,
  EMPTY,
  FIELD_H,
  FONT_CONTENT,
  FONT_LABEL,
  FONT_SIZE,
  GRAY_K35,
  HEADER,
  HEADER_TEXT,
  PAGE_BORDER_INSET_CM,
  PAGE_BORDER_WIDTH,
  PT_PER_CM,
  QR,
  RESERVA_ABAIXO_DESCRICAO,
  RED_M100_Y100,
  ROW_STEP,
  SHADE_5_PERCENT,
  WATERMARK,
  WIDTH,
  cm,
  totaisAproximadosTexto,
  truncate,
} from './danfse.layout';

/** Valor pronto para impressão: nota 12 da NT manda traço quando não há dado. */
function show(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY;
  const text = String(value).trim();
  return text === '' ? EMPTY : text;
}

/** Valor monetário; ausente vira traço, não "R$ 0,00" (que afirmaria zero). */
function showMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? EMPTY : formatCurrency(value);
}

function describe(map: Record<string, string>, code: string | null): string {
  if (!code) return EMPTY;
  return map[code] ?? code;
}

interface Cell {
  label: string;
  value: string;
  x: number;
  y: number;
  w: number;
  /** Sombreamento 5% — NT 2.2.3 (apenas "Emitente da NFS-e" e "Valor Líquido + IBS/CBS"). */
  shaded?: boolean;
  /** Rótulos do bloco de identificação são 7pt CAIXA ALTA (NT 2.4.2). */
  identLabel?: boolean;
  h?: number;
  /**
   * Campo de texto corrido: o conteúdo QUEBRA em várias linhas dentro da caixa,
   * até o fim dela. Só a "Descrição do Serviço" é assim; todo o resto da grade
   * da NT é campo de uma linha.
   */
  multiline?: boolean;
}

/**
 * Texto de UMA linha, garantido.
 *
 * ⚠️ `lineBreak: false` NÃO impede a quebra. No pdfkit (`_text`), basta
 * `options.width` estar definido para o LineWrapper entrar em ação; `lineBreak`
 * só decide se a largura é herdada das margens quando não foi informada. Ou
 * seja: todo campo desta grade — que sempre informa `width` — quebrava em
 * silêncio, e a linha excedente era desenhada ABAIXO da caixa, em cima do bloco
 * seguinte, que depois a cobria com o próprio fundo. Era assim que a segunda
 * linha da descrição do serviço "sumia": ela estava lá, escondida atrás da
 * faixa cinza do bloco de ISSQN.
 *
 * O que realmente limita é `height` + `ellipsis`: o wrapper para ao encher a
 * altura e fecha o que coube com reticências, como a NT 2.4.5 manda quando o
 * conteúdo não cabe no campo. Nada é desenhado fora da caixa.
 */
function drawClampedText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  options: { align?: 'center' } = {},
): void {
  doc.text(text, x, y, {
    width,
    // Meio ponto de folga: `height` menor que a altura da linha não desenha nada.
    height: doc.currentLineHeight(true) + 0.5,
    ellipsis: '...',
    align: options.align,
  });
}

/**
 * Desenha um campo: moldura de 0,5pt, rótulo em negrito e conteúdo abaixo.
 * Coordenadas sempre explícitas — a NT define posição absoluta, não fluxo.
 */
function drawCell(doc: PDFKit.PDFDocument, cell: Cell): void {
  const x = cm(cell.x);
  const y = cm(cell.y);
  const w = cm(cell.w);
  const h = cm(cell.h ?? FIELD_H);

  if (cell.shaded) {
    doc.save();
    doc.rect(x, y, w, h).fill(SHADE_5_PERCENT);
    doc.restore();
  }

  doc.save();
  doc.lineWidth(BLOCK_LINE_WIDTH).rect(x, y, w, h).stroke(BLACK);
  doc.restore();

  // Espaçamento interno em PONTOS, derivado do corpo da fonte — não em
  // centímetros arredondados. O valor antigo (rótulo em 0,05cm, conteúdo em
  // 0,24cm) colidia: um rótulo de 7pt ocupa ~0,247cm de altura e invadia a
  // linha de baixo. Aqui a linha do conteúdo começa depois do rótulo, sempre.
  const pad = cm(0.08);
  const labelSize = cell.identLabel ? FONT_SIZE.identLabel : FONT_SIZE.fieldLabel;
  const labelY = y + 1.6;
  const valueY = labelY + labelSize + 1.4;

  doc.font(FONT_LABEL).fontSize(labelSize).fillColor(BLACK);
  drawClampedText(doc, cell.label, x + pad, labelY, w - pad * 2);

  doc.font(FONT_CONTENT).fontSize(FONT_SIZE.content).fillColor(BLACK);
  if (cell.multiline) {
    // O texto usa a caixa inteira, do fim do rótulo até a borda de baixo. O que
    // não couber vira reticências — e nada é desenhado fora da moldura.
    doc.text(cell.value, x + pad, valueY, {
      width: w - pad * 2,
      height: Math.max(y + h - valueY - 1.5, doc.currentLineHeight(true) + 0.5),
      ellipsis: '...',
    });
  } else {
    drawClampedText(doc, cell.value, x + pad, valueY, w - pad * 2);
  }
}

/**
 * Altura (cm) que a caixa precisa ter para caber `texto` inteiro em `largura`.
 *
 * Mede com a MESMA fonte e corpo do desenho — por isso o `font`/`fontSize`
 * antes. Soma o recuo do rótulo (o conteúdo começa abaixo dele) e a folga da
 * borda de baixo.
 */
function alturaNecessaria(doc: PDFKit.PDFDocument, texto: string, larguraCm: number): number {
  doc.font(FONT_CONTENT).fontSize(FONT_SIZE.content);
  const recuoConteudo = 1.6 + FONT_SIZE.fieldLabel + 1.4; // igual ao valueY de drawCell
  const alturaTexto = doc.heightOfString(texto, { width: cm(larguraCm - 0.16) });
  // Uma linha de sobra, e ela é necessária: o pdfkit decide elidir olhando se a
  // PRÓXIMA linha caberia, e não tem como saber que a linha atual é a última.
  // Com a caixa medida no talo, a última linha do texto saía com reticências
  // mesmo estando inteira dentro dela.
  const sobra = doc.currentLineHeight(true);
  return (recuoConteudo + alturaTexto + sobra + 2) / PT_PER_CM;
}

/** Faixa de título de bloco: 7pt, negrito, CAIXA ALTA, com sombreamento 5% (NT 2.4.1 / 2.2.3). */
function drawBlockTitle(
  doc: PDFKit.PDFDocument,
  title: string,
  y: number,
  w: number = WIDTH.one,
  h: number = FIELD_H,
): void {
  const px = cm(COL.c0);
  const py = cm(y);
  const pw = cm(w);
  const ph = cm(h);

  doc.save();
  doc.rect(px, py, pw, ph).fill(SHADE_5_PERCENT);
  doc.restore();
  doc.save();
  doc.lineWidth(BLOCK_LINE_WIDTH).rect(px, py, pw, ph).stroke(BLACK);
  doc.restore();

  doc.font(FONT_LABEL).fontSize(FONT_SIZE.blockTitle).fillColor(BLACK);
  // Centralizado verticalmente na caixa, seja qual for a altura dela.
  drawClampedText(doc, title, px + cm(0.08), py + (ph - FONT_SIZE.blockTitle) / 2, pw - cm(0.16));
}

/** Bloco colapsado: só a frase literal exigida pela NT 2.3, largura total. */
function drawCollapsedBlock(doc: PDFKit.PDFDocument, text: string, y: number): void {
  const px = cm(COL.c0);
  const py = cm(y);
  const pw = cm(WIDTH.full);
  // NT 2.3, notas 2 a 4: altura mínima do bloco colapsado é 0,32cm.
  const ph = cm(0.32);

  // Sem sombreamento e com o texto CENTRALIZADO — é assim que o emissor
  // oficial imprime essas linhas, diferente das faixas de título de bloco.
  doc.save();
  doc.lineWidth(BLOCK_LINE_WIDTH).rect(px, py, pw, ph).stroke(BLACK);
  doc.restore();

  doc.font(FONT_LABEL).fontSize(FONT_SIZE.blockTitle).fillColor(BLACK);
  drawClampedText(doc, text, px, py + (ph - FONT_SIZE.blockTitle) / 2, pw, { align: 'center' });
}

/** Linhas de um bloco de parte (prestador/tomador), conforme a grade da NT 2.4.5. */
function drawPartyBlock(
  doc: PDFKit.PDFDocument,
  title: string,
  y: number,
  party: DanfseParty,
  extraRow?: Cell[],
): void {
  drawBlockTitle(doc, title, y);

  const r1 = y;
  const r2 = y + ROW_STEP;
  const r3 = y + ROW_STEP * 2;

  drawCell(doc, { label: 'CNPJ / CPF / NIF', value: formatCnpjCpf(party.documento), x: COL.c1, y: r1, w: WIDTH.one });
  drawCell(doc, { label: 'Indicador Municipal (Inscrição)', value: show(party.inscricaoMunicipal), x: COL.c2, y: r1, w: WIDTH.one });
  drawCell(doc, { label: 'Telefone', value: show(party.telefone), x: COL.c3, y: r1, w: WIDTH.one });

  drawCell(doc, { label: 'Nome / Nome Empresarial', value: show(party.nome), x: COL.c0, y: r2, w: WIDTH.two });
  drawCell(doc, {
    label: 'Município / Sigla UF',
    value: party.municipio || party.uf ? `${show(party.municipio)} / ${show(party.uf)}` : EMPTY,
    x: COL.c2,
    y: r2,
    w: WIDTH.one,
  });
  drawCell(doc, {
    label: 'Código IBGE / CEP',
    value:
      party.codigoIbge || party.cep
        ? `${formatIbge(party.codigoIbge)} / ${show(party.cep)}`
        : EMPTY,
    x: COL.c3,
    y: r2,
    w: WIDTH.one,
  });

  drawCell(doc, { label: 'Endereço', value: show(party.endereco), x: COL.c0, y: r3, w: WIDTH.two });
  drawCell(doc, { label: 'E-mail', value: show(party.email), x: COL.c2, y: r3, w: WIDTH.two });

  if (extraRow) {
    for (const cell of extraRow) drawCell(doc, cell);
  }
}

/**
 * Estado que o XML da NFS-e NÃO revela e que precisa vir de fora.
 *
 * Descoberto testando o cancelamento contra a SEFIN: depois de cancelar,
 * `GET /nfse/{chave}` continua devolvendo `cStat` 107 — o cancelamento é um
 * EVENTO à parte, não uma alteração da nota. Ou seja, o XML autorizado que
 * guardamos nunca vai dizer que a nota foi cancelada, e a marca d'água
 * "CANCELADA" exigida pela NT 2.5.1 jamais apareceria se dependesse só dele.
 */
export interface DanfseOverrides {
  cancelada?: boolean;
  substituida?: boolean;
}

/** Gera o DANFSe conforme a NT 008. Resolve com o Buffer do PDF. */
export async function generateDanfsePdf(
  nfseXml: string,
  overrides: DanfseOverrides = {},
): Promise<Buffer> {
  const parsed = parseNfseXml(nfseXml);
  const d: DanfseData = {
    ...parsed,
    cancelada: overrides.cancelada ?? parsed.cancelada,
    substituida: overrides.substituida ?? parsed.substituida,
  };

  // QR Code é exigido pela NT 2.4.3 — gerado antes de abrir o documento porque
  // a API do qrcode é assíncrona e o pdfkit desenha de forma síncrona.
  const qrPng = await buildQrCode(d.chaveAcesso);

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        // Margem zero: a NT posiciona tudo por coordenada absoluta a partir da
        // borda do papel. Qualquer margem do pdfkit deslocaria a grade inteira.
        margin: 0,
        info: {
          Title: `DANFSe ${d.numeroNfse ?? ''}`.trim(),
          Author: d.prestador.nome ?? 'NFS-e',
          Subject: 'Documento Auxiliar da NFS-e',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', c => chunks.push(c as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      drawPageBorder(doc);
      drawHeader(doc, d);
      drawIdentification(doc, d, qrPng);

      // NT 2.3.1 a 2.3.3 e notas 2/3/4: quando um bloco é colapsado, "as
      // coordenadas (X/Y) dos blocos devem ser ajustada conforme as informações
      // preenchidas" e o espaço recuperado vai para "Descrição do Serviço"
      // e/ou "Informações Complementares". Por isso daqui em diante o Y é um
      // CURSOR, e não a coordenada fixa da tabela: deixar os vãos em branco
      // violaria a norma e ficaria feio.
      let y = drawParties(doc, d);
      y = drawService(doc, d, y);
      y = drawIssqn(doc, d, y);
      y = drawFederal(doc, d, y);
      y = drawIbsCbs(doc, d, y);
      y = drawTotals(doc, d, y);
      drawComplementary(doc, d, y);
      // O canhoto é opcional pela NT (nota 11), mas o emissor oficial IMPRIME.
      // Como o objetivo é sair igual ao documento do portal, imprimimos também.
      drawCanhoto(doc, d);
      drawWatermark(doc, d);

      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** NT 2.4.3: QR Code apontando para a consulta pública, com a chave concatenada. */
async function buildQrCode(chave: string | null): Promise<Buffer | null> {
  if (!chave) return null;
  try {
    // Import tardio: o gerador é usado em testes puros que não precisam do QR.
    const qrcode = await import('qrcode');
    return await qrcode.toBuffer(`${QR.baseUrl}${chave}`, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 300,
      type: 'png',
    });
  } catch {
    return null;
  }
}

/** NT 2.2.3: borda de página de 1pt. */
function drawPageBorder(doc: PDFKit.PDFDocument): void {
  const inset = cm(PAGE_BORDER_INSET_CM);
  doc.save();
  doc
    .lineWidth(PAGE_BORDER_WIDTH)
    .rect(inset, inset, doc.page.width - inset * 2, doc.page.height - inset * 2)
    .stroke(BLACK);
  doc.restore();
}

/** NT 2.4.3: logo à esquerda, título ao centro, município/ambiente à direita. */
function drawHeader(doc: PDFKit.PDFDocument, d: DanfseData): void {
  const y = cm(BLOCK_Y.cabecalho);
  const h = cm(HEADER.height);

  doc.save();
  doc.rect(cm(COL.c0), y, cm(WIDTH.full), h).fill(SHADE_5_PERCENT);
  doc.restore();
  doc.save();
  doc.lineWidth(BLOCK_LINE_WIDTH).rect(cm(COL.c0), y, cm(WIDTH.full), h).stroke(BLACK);
  doc.restore();

  // Logomarca oficial da NFS-e. A NT indica um PNG hospedado no gov.br; baixar
  // em tempo de geração de documento fiscal seria uma dependência de rede
  // inaceitável, então o arquivo é opcional em disco e há uma marca tipográfica
  // como reserva.
  const logoBox = { x: cm(HEADER.logo.x), y: cm(HEADER.logo.y), w: cm(HEADER.logo.w), h: cm(HEADER.logo.h) };
  let logoDrawn = false;
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const logoPath = path.join(process.cwd(), 'assets', 'nfse-logo.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, logoBox.x, logoBox.y, { fit: [logoBox.w, logoBox.h] });
      logoDrawn = true;
    }
  } catch {
    logoDrawn = false;
  }
  if (!logoDrawn) {
    doc.font(FONT_LABEL).fontSize(13).fillColor(BLACK);
    drawClampedText(doc, 'NFS-e', logoBox.x, logoBox.y + cm(0.18), logoBox.w);
    doc.font(FONT_CONTENT).fontSize(5.5);
    drawClampedText(doc, 'PADRÃO NACIONAL', logoBox.x, logoBox.y + cm(0.58), logoBox.w);
  }

  // Centro: "DANFSe v2.0" + "Documento Auxiliar da NFS-e", 9pt negrito.
  const homologacao = d.tpAmb === 2 || d.tpAmb === null;
  const tx = cm(HEADER.titulo.x);
  const tw = cm(HEADER.titulo.w);
  doc.font(FONT_LABEL).fontSize(FONT_SIZE.headerTitle).fillColor(BLACK);
  drawClampedText(doc, HEADER_TEXT.titulo, tx, y + cm(homologacao ? 0.1 : 0.24), tw, { align: 'center' });
  drawClampedText(doc, HEADER_TEXT.subtitulo, tx, y + cm(homologacao ? 0.44 : 0.62), tw, { align: 'center' });

  if (homologacao) {
    // NT 2.4.3, observação: exigida apenas em homologação, negrito 9pt, vermelho
    // sólido, ABAIXO do título "Documento Auxiliar da NFS-e".
    doc.fillColor(RED_M100_Y100);
    drawClampedText(doc, HEADER_TEXT.semValidade, tx, y + cm(0.78), tw, { align: 'center' });
    doc.fillColor(BLACK);
  }

  // Direita: município do emitente (8pt) + ambiente gerador e tipo (6pt).
  const mx = cm(HEADER.municipio.x);
  const mw = cm(HEADER.municipio.w);
  doc.font(FONT_CONTENT).fontSize(FONT_SIZE.headerCity).fillColor(BLACK);
  // O emissor oficial imprime "Município: Nome - UF" e os ambientes como
  // NÚMERO cru ("Ambiente Gerador: 2"), não traduzidos.
  const ufEmitente = d.prestador.uf ? ` - ${d.prestador.uf}` : '';
  drawClampedText(
    doc,
    `Município: ${show(d.municipioEmitente)}${ufEmitente}`,
    mx + cm(0.08),
    y + cm(0.12),
    mw - cm(0.16),
  );
  doc.fontSize(FONT_SIZE.headerEnv);
  drawClampedText(doc, `Ambiente Gerador: ${show(d.ambGer)}`, mx + cm(0.08), y + cm(0.52), mw - cm(0.16));
  drawClampedText(doc, `Tipo de Ambiente: ${d.tpAmb ?? EMPTY}`, mx + cm(0.08), y + cm(0.8), mw - cm(0.16));
}

/** NT 2.1.2 / 2.4.5: bloco "Dados da NFS-e", com chave, QR Code e identificação. */
function drawIdentification(doc: PDFKit.PDFDocument, d: DanfseData, qrPng: Buffer | null): void {
  const y = BLOCK_Y.dadosNfse;

  drawCell(doc, {
    label: 'CHAVE DE ACESSO DA NFS-e',
    value: show(d.chaveAcesso),
    x: COL.c0,
    y,
    w: WIDTH.three,
    h: 0.77,
    identLabel: true,
  });

  const r1 = 2.27;
  const r2 = 2.96;
  const r3 = 3.65;
  const idCell = (label: string, value: string, x: number, yy: number, shaded = false): void =>
    drawCell(doc, { label, value, x, y: yy, w: WIDTH.one, h: 0.67, identLabel: true, shaded });

  idCell('NÚMERO DA NFS-e', show(d.numeroNfse), COL.c0, r1);
  idCell('COMPETÊNCIA DA NFS-e', formatDate(d.competencia), COL.c1, r1);
  idCell('DATA E HORA DA EMISSÃO DA NFS-e', formatDateTimeSeconds(d.dataHoraNfse), COL.c2, r1);

  // Série e número sem zeros à esquerda, como o emissor oficial imprime.
  idCell('NÚMERO DA DPS', stripLeadingZeros(d.numeroDps), COL.c0, r2);
  idCell('SÉRIE DA DPS', stripLeadingZeros(d.serieDps), COL.c1, r2);
  idCell('DATA E HORA DA EMISSÃO DA DPS', formatDateTimeSeconds(d.dataHoraDps), COL.c2, r2);

  // NT 2.2.3: "Emitente da NFS-e" é um dos dois campos com sombreamento.
  idCell('EMITENTE DA NFS-e', describe(DESCRICAO.tpEmit, d.tpEmit), COL.c0, r3, true);
  idCell('SITUAÇÃO DA NFS-e', truncate(describe(DESCRICAO.cStat, d.cStat), 37), COL.c1, r3);
  idCell('FINALIDADE', truncate(show(d.finalidade), 37), COL.c2, r3);

  // QR Code (NT 2.4.3) — posição e tamanho mínimos fixados pela norma.
  if (qrPng) {
    doc.image(qrPng, cm(QR.x), cm(QR.y), { width: cm(QR.size), height: cm(QR.size) });
  } else {
    doc.save();
    doc.lineWidth(BLOCK_LINE_WIDTH).rect(cm(QR.x), cm(QR.y), cm(QR.size), cm(QR.size)).stroke(BLACK);
    doc.restore();
  }

  doc.font(FONT_CONTENT).fontSize(FONT_SIZE.qrCaption).fillColor(BLACK);
  doc.text(QR.captionText, cm(QR.caption.x), cm(QR.caption.y), {
    width: cm(QR.caption.w),
    align: 'center',
    lineGap: -0.5,
  });
}

function drawParties(doc: PDFKit.PDFDocument, d: DanfseData): number {
  // Prestador tem uma linha extra: Simples Nacional e regime de apuração (NT 2.1.3).
  const extra = BLOCK_Y.prestador + ROW_STEP * 3;
  drawPartyBlock(doc, 'PRESTADOR / FORNECEDOR', BLOCK_Y.prestador, d.prestador, [
    {
      label: 'Simples Nacional na Data de Competência',
      value: truncate(describe(DESCRICAO.opSimpNac, d.prestadorOpSimpNac), 37),
      x: COL.c0,
      y: extra,
      w: WIDTH.one,
    },
    {
      label: 'Regime de Apuração Tributária pelo SN',
      value: show(d.prestadorRegApTribSN),
      x: COL.c1,
      y: extra,
      w: WIDTH.one,
    },
  ]);

  const temTomador = Boolean(d.tomador.documento || d.tomador.nome);
  let cursor: number;
  if (temTomador) {
    drawPartyBlock(doc, 'TOMADOR / ADQUIRENTE', BLOCK_Y.tomador, d.tomador);
    cursor = BLOCK_Y.tomador + ROW_STEP * 3;
  } else {
    drawCollapsedBlock(doc, COLLAPSE_TEXT.tomador, BLOCK_Y.tomador);
    cursor = BLOCK_Y.tomador + COLLAPSED_H + 0.02;
  }

  // ── Destinatário da operação ────────────────────────────────────────────────
  //
  // "Destinatário" é um PAPEL À PARTE do tomador/adquirente, e existe só no
  // grupo `IBSCBS/dest` do leiaute da Reforma Tributária (NT 005 SE/CGNFS-e,
  // item 2.1.1). Quem manda nele é `IBSCBS/indDest`:
  //   0 = tomador = adquirente = destinatário  → o grupo `dest` nem é enviado;
  //   1 = o destinatário é outra pessoa        → aí sim vem o grupo `dest`.
  //
  // Nas notas do aerografista quem contrata e quem recebe o serviço é a mesma
  // pessoa (a Ankaa), então não existe `dest` a imprimir — e não existirá nem
  // quando migrarmos para o leiaute da Reforma, porque lá o caso é indDest = 0.
  //
  // Isso NÃO é "destinatário não identificado". A NT 008, item 2.3.2 e nota 3
  // do item 2.4.5, dá a frase própria para este caso: o bloco declara que o
  // destinatário é o próprio tomador — que está identificado logo acima, com
  // CNPJ e razão social. A frase de "não identificado" (nota 2) é para quando o
  // documento não diz quem recebeu, e dizê-la aqui era afirmar algo falso sobre
  // a nota.
  const temDestinatario = Boolean(d.destinatario.documento || d.destinatario.nome);
  if (temDestinatario) {
    drawPartyBlock(doc, 'DESTINATÁRIO DA OPERAÇÃO', cursor, d.destinatario);
    cursor += ROW_STEP * 3;
  } else if (d.indDest === '0' || (d.indDest === null && temTomador)) {
    drawCollapsedBlock(doc, COLLAPSE_TEXT.destinatarioEhTomador, cursor);
    cursor += COLLAPSED_H + 0.02;
  } else {
    drawCollapsedBlock(doc, COLLAPSE_TEXT.destinatario, cursor);
    cursor += COLLAPSED_H + 0.02;
  }

  // NT 2.3.1: sem intermediário na operação.
  drawCollapsedBlock(doc, COLLAPSE_TEXT.intermediario, cursor);
  cursor += COLLAPSED_H + 0.02;
  return cursor;
}

function drawService(doc: PDFKit.PDFDocument, d: DanfseData, y: number): number {
  drawBlockTitle(doc, 'SERVIÇO PRESTADO', y);

  drawCell(doc, {
    label: 'Código de Tributação Nacional / Municipal',
    value: `${formatCodigoTributacao(d.cTribNac)} / ${show(d.cTribMun)}`,
    x: COL.c1,
    y,
    w: WIDTH.one,
  });
  drawCell(doc, { label: 'Código da NBS', value: show(d.cNBS), x: COL.c2, y, w: WIDTH.one });
  drawCell(doc, {
    label: 'Local da Prestação / Sigla UF / País',
    value: `${show(d.localPrestacao)} / ${show(d.prestador.uf)} / ${EMPTY}`,
    x: COL.c3,
    y,
    w: WIDTH.one,
  });

  // NT 2.4.5: "Não há título (label) deste campo no DANFSe" — só o texto.
  const descTribY = y + ROW_STEP;
  drawTextBox(doc, truncate(show(d.descricaoTributacao), 167), descTribY, 0.4);

  // "Descrição do Serviço" é um dos quadros que absorvem o espaço recuperado
  // pelos blocos colapsados (NT 2.3.1/2.3.2) — e é o ÚNICO campo da grade que
  // aceita várias linhas: `xDescServ` tem 1300 caracteres de leiaute, contra os
  // ~165 que cabem numa linha de 20,40cm a 7pt.
  //
  // Por isso a caixa CRESCE até caber o texto, em vez de ficar com a altura de
  // um campo comum. Antes ela era fixa em FIELD_H e a segunda linha era
  // desenhada por cima do bloco de baixo, que a cobria — a descrição parecia
  // cortada no meio da frase, e foi o que aconteceu em 5 das 7 notas já
  // emitidas.
  const descServY = descTribY + 0.42;
  const descricao = truncate(show(d.descricaoServico), 1297);
  const disponivel = BLOCK_Y.canhoto - 0.1 - RESERVA_ABAIXO_DESCRICAO - descServY;
  const descServH = Math.min(
    Math.max(alturaNecessaria(doc, descricao, WIDTH.full), FIELD_H),
    Math.max(disponivel, FIELD_H),
  );

  drawCell(doc, {
    label: 'Descrição do Serviço',
    value: descricao,
    x: COL.c0,
    y: descServY,
    w: WIDTH.full,
    h: descServH,
    multiline: true,
  });

  return descServY + descServH + 0.02;
}

/** Quadro de largura total sem rótulo, com o texto ocupando toda a caixa. */
function drawTextBox(doc: PDFKit.PDFDocument, text: string, y: number, h: number): void {
  doc.save();
  doc.lineWidth(BLOCK_LINE_WIDTH).rect(cm(COL.c0), cm(y), cm(WIDTH.full), cm(h)).stroke(BLACK);
  doc.restore();
  doc.font(FONT_CONTENT).fontSize(FONT_SIZE.content).fillColor(BLACK);
  doc.text(text, cm(COL.c0 + 0.08), cm(y + 0.08), {
    width: cm(WIDTH.full - 0.16),
    height: cm(h - 0.1),
    ellipsis: '...',
    lineGap: -1,
  });
}

function drawIssqn(doc: PDFKit.PDFDocument, d: DanfseData, y: number): number {

  // NT 2.3.1 / nota 4: só colapsa quando NÃO há incidência de ISSQN. Um MEI é
  // tributável (tribISSQN = 1) — o ISS apenas está incluso no DAS —, então o
  // bloco é exibido com traço nos campos sem valor, conforme a nota 12.
  const semIncidencia = d.tribISSQN === '3' || d.tribISSQN === '4';
  if (semIncidencia) {
    drawCollapsedBlock(doc, COLLAPSE_TEXT.issqnNaoSujeita, y);
    return y + COLLAPSED_H + 0.02;
  }

  drawBlockTitle(doc, 'TRIBUTAÇÃO MUNICIPAL (ISSQN)', y);
  const r2 = y + ROW_STEP;
  const r3 = y + ROW_STEP * 2;
  const r4 = y + ROW_STEP * 3;

  drawCell(doc, { label: 'Tipo de Tributação do ISSQN', value: describe(DESCRICAO.tribISSQN, d.tribISSQN), x: COL.c1, y, w: WIDTH.one });
  drawCell(doc, {
    label: 'Município / Sigla UF / País da Incidência do ISSQN',
    value: `${show(d.municipioIncidencia)} / ${show(d.prestador.uf)} / ${EMPTY}`,
    x: COL.c2,
    y,
    w: WIDTH.two,
  });

  // NT 2.4.5, nota 5: "Esta linha poderá ser suprimida caso não existam dados em
  // todos os campos da mesma linha no arquivo XML". Para MEI as duas linhas do
  // meio são sempre inteiramente vazias, e o emissor oficial as suprime — sem
  // isso o bloco fica com duas faixas de traços que não dizem nada.
  let linha = r2;

  const temRegime = [
    d.regEspTrib,
    d.tpImunidade,
    d.suspensaoExigibilidade,
    d.numeroProcessoSuspensao,
  ].some(v => v !== null && v !== undefined && String(v).trim() !== '');
  if (temRegime) {
    drawCell(doc, { label: 'Regime Especial de Tributação do ISSQN', value: show(d.regEspTrib), x: COL.c0, y: linha, w: WIDTH.one });
    drawCell(doc, { label: 'Tipo de Imunidade do ISSQN', value: show(d.tpImunidade), x: COL.c1, y: linha, w: WIDTH.one });
    drawCell(doc, { label: 'Suspensão da Exigibilidade do ISSQN', value: show(d.suspensaoExigibilidade), x: COL.c2, y: linha, w: WIDTH.one });
    drawCell(doc, { label: 'Número Processo Suspensão', value: show(d.numeroProcessoSuspensao), x: COL.c3, y: linha, w: WIDTH.one });
    linha += ROW_STEP;
  }

  const temBeneficio = [
    d.beneficioMunicipal,
    d.calculoBM,
    d.totalDeducoesReducoes,
    d.descontoIncondicionado,
  ].some(v => v !== null && v !== undefined && String(v).trim() !== '');
  if (temBeneficio) {
    drawCell(doc, { label: 'Benefício Municipal', value: show(d.beneficioMunicipal), x: COL.c0, y: linha, w: WIDTH.one });
    drawCell(doc, { label: 'Cálculo do BM', value: show(d.calculoBM), x: COL.c1, y: linha, w: WIDTH.one });
    drawCell(doc, { label: 'Total Deduções/Reduções', value: showMoney(d.totalDeducoesReducoes), x: COL.c2, y: linha, w: WIDTH.one });
    drawCell(doc, { label: 'Desconto Incondicionado', value: showMoney(d.descontoIncondicionado), x: COL.c3, y: linha, w: WIDTH.one });
    linha += ROW_STEP;
  }

  drawCell(doc, { label: 'BC ISSQN', value: showMoney(d.bcIssqn), x: COL.c0, y: linha, w: WIDTH.one });
  drawCell(doc, { label: 'Alíquota Aplicada', value: show(d.aliquotaAplicada), x: COL.c1, y: linha, w: WIDTH.one });
  drawCell(doc, { label: 'Retenção do ISSQN', value: describe(DESCRICAO.tpRetISSQN, d.retencaoIssqn), x: COL.c2, y: linha, w: WIDTH.one });
  drawCell(doc, { label: 'ISSQN Apurado', value: showMoney(d.issqnApurado), x: COL.c3, y: linha, w: WIDTH.one });
  return linha + FIELD_H + 0.02;
}

function drawFederal(doc: PDFKit.PDFDocument, d: DanfseData, y: number): number {
  const r2 = y + ROW_STEP;
  drawBlockTitle(doc, 'TRIBUTAÇÃO FEDERAL (EXCETO CBS)', y);

  // NT v1.02: quando tpRetPisCofins = 1 (PIS/COFINS Retido), "Contribuições
  // Sociais - Retidas" é o SOMATÓRIO de vRetCSLL + vPis + vCofins, e as linhas
  // de débito próprio de PIS e COFINS retornam 0,00. Nos demais casos, cada
  // campo mostra o próprio valor. Foi justamente isto que a 1.02 mudou.
  const pisCofinsRetido = d.tpRetPisCofins === '1';
  const contribSociais = pisCofinsRetido
    ? (d.vContribSociais ?? 0) + (d.vPis ?? 0) + (d.vCofins ?? 0)
    : d.vContribSociais;

  drawCell(doc, { label: 'IRRF', value: showMoney(d.vIrrf), x: COL.c1, y, w: WIDTH.one });
  drawCell(doc, { label: 'Contribuição Previdenciária - Retida', value: showMoney(d.vContribPrev), x: COL.c2, y, w: WIDTH.one });
  drawCell(doc, { label: 'Contribuições Sociais - Retidas', value: showMoney(contribSociais), x: COL.c3, y, w: WIDTH.one });

  // NT, nota 6: esta linha é impressa para competências até o fim de 2026.
  const competenciaAno = Number((d.competencia ?? '').slice(0, 4));
  if (!Number.isFinite(competenciaAno) || competenciaAno <= 2026) {
    drawCell(doc, { label: 'PIS - Débito Apuração Própria', value: pisCofinsRetido ? formatCurrency(0) : showMoney(d.vPis), x: COL.c0, y: r2, w: WIDTH.one });
    drawCell(doc, { label: 'COFINS - Débito Apuração Própria', value: pisCofinsRetido ? formatCurrency(0) : showMoney(d.vCofins), x: COL.c1, y: r2, w: WIDTH.one });
    drawCell(doc, { label: 'Descrição Contrib. Sociais - Retidas', value: show(d.tpRetPisCofins), x: COL.c2, y: r2, w: WIDTH.two });
    return r2 + FIELD_H + 0.02;
  }
  return y + FIELD_H + 0.02;
}

function drawIbsCbs(doc: PDFKit.PDFDocument, d: DanfseData, y: number): number {
  drawBlockTitle(doc, 'TRIBUTAÇÃO IBS/CBS', y);

  const r2 = y + ROW_STEP;
  const r3 = y + ROW_STEP * 2;
  const r4 = y + ROW_STEP * 3;

  drawCell(doc, { label: 'CST / cClassTrib', value: EMPTY, x: COL.c1, y, w: WIDTH.one });
  drawCell(doc, { label: 'Indicador de Operação / Código IBGE Incidência / Município / UF', value: EMPTY, x: COL.c2, y, w: WIDTH.two });

  drawCell(doc, { label: 'Exclusões e Reduções da Base de Cálculo', value: EMPTY, x: COL.c0, y: r2, w: WIDTH.one });
  drawCell(doc, { label: 'Base de Cálculo Após Exclusões e Reduções', value: EMPTY, x: COL.c1, y: r2, w: WIDTH.one });
  drawCell(doc, { label: 'Red. Alíquota IBS / Red. Alíquota CBS', value: EMPTY, x: COL.c2, y: r2, w: WIDTH.one });
  drawCell(doc, { label: 'Alíquota - IBS UF / IBS Mun', value: EMPTY, x: COL.c3, y: r2, w: WIDTH.one });

  drawCell(doc, { label: 'Alíq. Efetiva Municipal - IBS', value: EMPTY, x: COL.c0, y: r3, w: WIDTH.one });
  drawCell(doc, { label: 'Valor Apurado Municipal - IBS', value: EMPTY, x: COL.c1, y: r3, w: WIDTH.one });
  drawCell(doc, { label: 'Alíq. Efetiva Estadual - IBS', value: EMPTY, x: COL.c2, y: r3, w: WIDTH.one });
  drawCell(doc, { label: 'Valor Apurado Estadual - IBS', value: EMPTY, x: COL.c3, y: r3, w: WIDTH.one });

  drawCell(doc, { label: 'Valor Total Apurado - IBS', value: EMPTY, x: COL.c0, y: r4, w: WIDTH.one });
  drawCell(doc, { label: 'Alíquota - CBS', value: EMPTY, x: COL.c1, y: r4, w: WIDTH.one });
  drawCell(doc, { label: 'Alíquota Efetiva - CBS', value: EMPTY, x: COL.c2, y: r4, w: WIDTH.one });
  drawCell(doc, { label: 'Valor Total Apurado - CBS', value: EMPTY, x: COL.c3, y: r4, w: WIDTH.one });
  return r4 + FIELD_H + 0.02;
}

function drawTotals(doc: PDFKit.PDFDocument, d: DanfseData, y: number): number {
  const r2 = y + 0.69;
  drawBlockTitle(doc, 'VALOR TOTAL DA NFS-e', y);

  const cell = (label: string, value: string, x: number, yy: number, shaded = false): void =>
    drawCell(doc, { label, value, x, y: yy, w: WIDTH.one, h: 0.67, shaded });

  cell('Valor da Operação / Serviço', showMoney(d.valorServico), COL.c1, y);
  cell('Desconto Incondicionado', showMoney(d.descontoIncondicionado), COL.c2, y);
  cell('Desconto Condicionado', showMoney(d.descontoCondicionado), COL.c3, y);

  cell('Total das Retenções (ISSQN / Federais)', showMoney(d.totalRetencoes), COL.c0, r2);
  cell('Valor Líquido da NFS-e', showMoney(d.valorLiquido), COL.c1, r2);
  cell('Total do IBS/CBS', formatCurrency(d.totalIbsCbs ?? 0), COL.c2, r2);
  // NT 2.2.3: o outro campo com sombreamento obrigatório.
  cell(
    'Valor Líquido da NFS-e + IBS/CBS',
    formatCurrency(d.valorLiquidoMaisIbsCbs ?? 0),
    COL.c3,
    r2,
    true,
  );
  return r2 + 0.67 + 0.02;
}

function drawComplementary(doc: PDFKit.PDFDocument, d: DanfseData, y: number): void {
  // NT 2.4.5: a faixa de título deste bloco tem 0,39cm (e não os 0,63cm dos
  // demais). Usar a altura padrão fazia o título invadir a caixa do conteúdo.
  drawBlockTitle(doc, 'INFORMAÇÕES COMPLEMENTARES', y, WIDTH.full, 0.39);

  // Sem canhoto (bloco opcional, NT 2.3.3 / nota 11), o quadro pode ocupar o
  // espaço até o fim da área útil.
  const contentY = y + 0.41;  // logo abaixo da faixa de 0,39cm
  const contentH = BLOCK_Y.canhoto - 0.1 - contentY;

  doc.save();
  doc
    .lineWidth(BLOCK_LINE_WIDTH)
    .rect(cm(COL.c0), cm(contentY), cm(WIDTH.full), cm(contentH))
    .stroke(BLACK);
  doc.restore();

  const linhas: string[] = [];
  if (d.informacoesComplementares) linhas.push(d.informacoesComplementares);
  // NT, nota 7: em substituição, informar a chave da NFS-e substituída.
  if (d.chaveSubstituida) linhas.push(`NFS-e Subst.: ${d.chaveSubstituida}`);
  // NT, nota 10: a linha é obrigatória. Os valores saem do XML; ausentes viram
  // traço (nota 12) em vez de "R$ 0,00", que afirmaria tributo zero — ver o
  // conflito normativo documentado em danfse.layout.ts.
  linhas.push(
    totaisAproximadosTexto(
      showMoney(d.vTotTribFed),
      showMoney(d.vTotTribEst),
      showMoney(d.vTotTribMun),
    ),
  );

  doc.font(FONT_CONTENT).fontSize(FONT_SIZE.content).fillColor(BLACK);
  // NT 2.4.5: "As informações devem ser separadas por pipes ( | )".
  doc.text(linhas.join(' | '), cm(COL.c0 + 0.1), cm(contentY + 0.16), {
    width: cm(WIDTH.full - 0.16),
    height: cm(contentH - 0.2),
    ellipsis: '...',
  });
}

/**
 * Canhoto (NT 2.1.13 / 2.4.5, bloco opcional pela nota 11).
 *
 * Fica ancorado no RODAPÉ, na coordenada fixa da NT (Y 28,10cm), e não no fluxo
 * dos blocos acima — é assim no modelo do Anexo I e no documento que o portal
 * gera.
 */
function drawCanhoto(doc: PDFKit.PDFDocument, d: DanfseData): void {
  const y = BLOCK_Y.canhoto;
  const h = 0.67;

  const cell = (label: string, value: string, x: number, w: number): void => {
    doc.save();
    doc.lineWidth(BLOCK_LINE_WIDTH).rect(cm(x), cm(y), cm(w), cm(h)).stroke(BLACK);
    doc.restore();
    doc.font(FONT_LABEL).fontSize(FONT_SIZE.fieldLabel).fillColor(BLACK);
    drawClampedText(doc, label, cm(x) + cm(0.08), cm(y) + 1.6, cm(w) - cm(0.16));
    if (value) {
      doc.font(FONT_CONTENT).fontSize(FONT_SIZE.content).fillColor(BLACK);
      drawClampedText(
        doc,
        value,
        cm(x) + cm(0.08),
        cm(y) + 1.6 + FONT_SIZE.fieldLabel + 1.4,
        cm(w) - cm(0.16),
      );
    }
  };

  cell('DATA CIENTIFICAÇÃO:', '', COL.c0, WIDTH.one);
  cell('IDENTIFICAÇÃO E ASSINATURA', '', COL.c1, WIDTH.one);
  cell(
    'Nº NFS-e / CHAVE NFS-e',
    `${show(d.numeroNfse)} / ${show(d.chaveAcesso)}`,
    COL.c2,
    WIDTH.two,
  );
}

/** NT 2.5.1 / 2.5.2: marca d'água diagonal, mínimo 50pt, Arial, cinza K35. */
function drawWatermark(doc: PDFKit.PDFDocument, d: DanfseData): void {
  const text = d.cancelada
    ? WATERMARK.cancelada
    : d.substituida
      ? WATERMARK.substituida
      : null;
  if (!text) return;

  doc.save();
  doc.rotate(-45, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.font(FONT_CONTENT).fontSize(FONT_SIZE.watermark).fillColor(GRAY_K35);
  doc.text(text, 0, doc.page.height / 2 - 30, { width: doc.page.width, align: 'center' });
  doc.restore();
}
