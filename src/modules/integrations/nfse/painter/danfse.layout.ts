/**
 * Geometria e tipografia do DANFSe, conforme a **Nota Técnica nº 008 SE/CGNFS-e
 * — "Especificações Técnicas do DANFSe", versão 1.02, de 14/07/2026** (vigente;
 * as versões 1.0 e 1.01 foram superadas).
 *
 * Este arquivo é a tradução literal da NT para constantes. Todo número aqui tem
 * origem numa seção da NT, citada no comentário. Não ajuste "no olho": se algo
 * parece errado, confira contra a NT antes de mexer.
 *
 * As medidas da NT estão em CENTÍMETROS (seção 2.4.5) e o pdfkit trabalha em
 * pontos, daí a conversão em `cm()`.
 */

/** Pontos por centímetro (72 dpi ÷ 2,54). */
/** Versão da NT que este layout implementa. Travada por teste. */
export const NT_VERSION = '1.02';

export const PT_PER_CM = 72 / 2.54;

export const cm = (value: number): number => value * PT_PER_CM;

/**
 * Margem do corpo impresso até a borda do formulário — NT 2.2.2: "no mínimo,
 * 0,15cm e no máximo 0,20cm em cada lateral (inclusive nas margens superior e
 * inferior)". Usamos o meio da faixa.
 *
 * Atenção: isto é a moldura da PÁGINA. As coordenadas dos blocos (2.4.5) são
 * medidas a partir da borda do papel e começam em 0,30cm — ou seja, o conteúdo
 * fica dentro desta moldura, não sobre ela.
 */
export const PAGE_BORDER_INSET_CM = 0.18;

/** NT 2.2.3: "página deverá ter borda de 1 (um) ponto de espessura". */
export const PAGE_BORDER_WIDTH = 1;

/** NT 2.2.3: "As linhas divisórias dos blocos ... 0,5 (meio) ponto". */
export const BLOCK_LINE_WIDTH = 0.5;

/**
 * NT 2.2.3: sombreamento "na cor cinza claro (5% de densidade)" no cabeçalho,
 * nos títulos de bloco e nos campos "Emitente da NFS-e" e "Valor Líquido da
 * NFS-e + IBS/CBS"; branco (0%) no restante.
 */
export const SHADE_5_PERCENT = '#f2f2f2';

/** NT 2.4: "em preto sólido (K100)". */
export const BLACK = '#000000';

/** NT 2.4.3: expressão de homologação "em vermelho sólido (M100/Y100)". */
export const RED_M100_Y100 = '#ed1c24';

/** NT 2.5.1 / 2.5.2: marca d'água "em cinza (K35)". */
export const GRAY_K35 = '#a6a6a6';

/**
 * NT 2.4: "fontes Arial para os títulos/labels e Microsoft Sans Serif para os
 * conteúdos".
 *
 * Nem Arial nem Microsoft Sans Serif podem ser embutidas aqui: são fontes
 * proprietárias e o repositório não tem licença nem os arquivos. Usamos
 * Helvetica, que é métricamente compatível com Arial e é uma das 14 fontes
 * padrão do PDF — portanto renderiza igual em qualquer leitor, sem embutir
 * nada. A substituição é visualmente indistinguível em corpo pequeno e não
 * afeta nenhuma regra de conteúdo da NT.
 */
export const FONT_LABEL = 'Helvetica-Bold';
export const FONT_LABEL_REGULAR = 'Helvetica';
export const FONT_CONTENT = 'Helvetica';

/** Tamanhos de fonte, em pontos — NT 2.4.1 a 2.4.4. */
export const FONT_SIZE = {
  /** 2.4.1 — títulos dos blocos: 7pt, negrito, caixa alta. */
  blockTitle: 7,
  /** 2.4.2 — títulos dos campos: 6pt, negrito, Primeira Maiúscula. */
  fieldLabel: 6,
  /** 2.4.2 — títulos dos campos do bloco de identificação: 7pt, negrito, CAIXA ALTA. */
  identLabel: 7,
  /** 2.4.3 / 2.4.4 — conteúdo dos campos: 7pt, normal. */
  content: 7,
  /** 2.4.3 — "DANFSe v2.0" e "Documento Auxiliar da NFS-e": 9pt, negrito. */
  headerTitle: 9,
  /** 2.4.3 — nome do município do emitente: 8pt, normal. */
  headerCity: 8,
  /** 2.4.3 — ambiente gerador e tipo de ambiente: 6pt, normal. */
  headerEnv: 6,
  /** 2.4.3 — complemento do QR Code: 6pt, normal, em 3 linhas. */
  qrCaption: 6,
  /** 2.5.1 / 2.5.2 — marca d'água: mínimo 50pt. */
  watermark: 50,
} as const;

/**
 * Colunas da grade (NT 2.4.5). A página útil tem 20,40cm de largura, dividida
 * em 4 colunas de 5,09cm.
 */
export const COL = { c0: 0.3, c1: 5.41, c2: 10.51, c3: 15.62 } as const;

/** Larguras usuais: uma coluna, duas colunas, largura total. */
export const WIDTH = { one: 5.09, two: 10.19, three: 15.3, full: 20.4 } as const;

/** Altura padrão de um campo e passo vertical entre linhas (NT 2.4.5). */
export const FIELD_H = 0.63;
export const ROW_STEP = 0.645;

/**
 * Coordenadas Y de cada bloco, exatamente como a NT 2.4.5 as define.
 * Mexer aqui desalinha o documento inteiro.
 */
export const BLOCK_Y = {
  cabecalho: 0.3,
  dadosNfse: 1.48,
  prestador: 4.34,
  tomador: 6.92,
  destinatario: 8.86,
  intermediario: 10.8,
  servico: 12.74,
  issqn: 14.43,
  federal: 17.02,
  ibsCbs: 18.32,
  valorTotal: 20.9,
  informacoesComplementares: 22.27,
  canhoto: 28.1,
} as const;

/** Caixas do cabeçalho e do QR Code (NT 2.4.3 e 2.4.5). */
export const HEADER = {
  height: 1.16,
  logo: { x: 0.49, y: 0.44, w: 4.0, h: 0.85 },
  titulo: { x: 5.41, y: 0.3, w: 10.19, h: 1.16 },
  municipio: { x: 15.62, y: 0.3, w: 5.09, h: 1.16 },
} as const;

/** NT 2.4.3: QR Code com no mínimo 1,52 × 1,52 cm, em X 17,48 / Y 1,67. */
export const QR = {
  x: 17.48,
  y: 1.67,
  size: 1.52,
  caption: { x: 15.8, y: 3.36, w: 4.72, h: 0.68 },
  /** NT 2.4.3: endereço do QR Code, com a chave concatenada após o "=". */
  baseUrl: 'https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=',
  /** NT 2.4.3: texto complementar, disposto em 3 linhas. */
  captionText:
    'A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ' +
    'ou pela consulta da chave de acesso no portal nacional da NFS-e',
} as const;

/** NT 12 (notas do item 2.4.5): "Os campos sem informações no XML devem ser preenchidos com um traço (-)". */
export const EMPTY = '-';

/** NT 2.4.5, notas 2 a 4: "A altura mínima do bloco [colapsado] é de 0,32cm". */
export const COLLAPSED_H = 0.32;

/** Textos literais exigidos pela NT quando um bloco é colapsado (2.3.1 a 2.3.3). */
export const COLLAPSE_TEXT = {
  tomador: 'TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e',
  destinatario: 'DESTINATARIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e',
  intermediario: 'INTERMEDIARIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e',
  issqnNaoSujeita: 'TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN',
} as const;

/**
 * Descrição completa do regime, como o emissor oficial imprime. A NT manda usar
 * a descrição da opção do leiaute (truncada em 37 caracteres com reticências),
 * e não uma sigla nossa.
 */
export const OP_SIMP_NAC_DESCRICAO: Record<string, string> = {
  '1': 'Não Optante',
  '2': 'Optante - Microempreendedor Individual (MEI)',
  '3': 'Optante - Microempresa ou Empresa de Pequeno Porte',
};

/** NT 2.4.3 — descrições do cabeçalho. */
export const HEADER_TEXT = {
  titulo: 'DANFSe v2.0',
  subtitulo: 'Documento Auxiliar da NFS-e',
  /** NT 2.4.3, observação: exigido quando tpAmb = 2 (homologação). */
  semValidade: 'NFS-e SEM VALIDADE JURÍDICA',
} as const;

/** NT 2.5.1 / 2.5.2 — marcas d'água. */
export const WATERMARK = {
  cancelada: 'CANCELADA',
  substituida: 'SUBSTITUÍDA',
} as const;

/**
 * NT 2.4.5, nota 10: é OBRIGATÓRIO constar a informação de totais aproximados
 * de tributos (Lei nº 12.741/2012), no formato exato abaixo.
 */
export const totaisAproximadosTexto = (
  federais: string,
  estaduais: string,
  municipais: string,
): string =>
  // Grafia e pontuação copiadas do emissor oficial: "aproximados" minúsculo,
  // separadores com ponto e vírgula e ponto e vírgula final.
  'Totais aproximados dos Tributos cfe. Lei nº 12.741/2012: ' +
  `Federais: ${federais}; Estaduais: ${estaduais}; Municipais: ${municipais};`;

/**
 * ⚠️ CONFLITO NORMATIVO CONHECIDO, deixado explícito de propósito.
 *
 * A nota 10 da NT torna OBRIGATÓRIA a linha de totais aproximados de tributos.
 * O leiaute da DPS/NFS-e, por sua vez, PROÍBE `pTotTribSN` para prestador MEI —
 * ou seja, o XML de um MEI não traz esses totais. A NT não resolve o conflito.
 *
 * A escolha aqui é imprimir a linha (cumprindo a obrigatoriedade) com traço nos
 * valores que o XML não informa. Preencher com "R$ 0,00" seria pior: afirmaria
 * que os tributos são zero, o que o documento não permite concluir.
 * Confirmar o tratamento com a contabilidade antes de considerar isto fechado.
 */

/** Descrições das opções do leiaute, usadas em vez do código cru (NT 2.4.5). */
export const DESCRICAO = {
  tpEmit: {
    '1': 'Prestador',
    '2': 'Tomador',
    '3': 'Intermediário',
  } as Record<string, string>,
  opSimpNac: OP_SIMP_NAC_DESCRICAO,
  tribISSQN: {
    '1': 'Operação tributável',
    '2': 'Exportação de serviço',
    '3': 'Não Incidência',
    '4': 'Imunidade',
  } as Record<string, string>,
  tpRetISSQN: {
    '1': 'Não Retido',
    '2': 'Retido pelo Tomador',
    '3': 'Retido pelo Intermediário',
  } as Record<string, string>,
  cStat: {
    '100': 'NFS-e gerada',
    '101': 'NFS-e cancelada',
    '102': 'NFS-e substituída',
    // 107 é o status das notas deste projeto: o leiaute classifica a nota de MEI
    // com código próprio, e não com o 100 genérico.
    '107': 'NFS-e MEI',
  } as Record<string, string>,
} as const;

/**
 * NT 2.4.5: "Preencher com reticências (...), caso a descrição supere N
 * caracteres". Corta preservando a informação inicial, que é a que identifica.
 */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}
