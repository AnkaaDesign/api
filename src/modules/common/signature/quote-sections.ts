/**
 * O que cada função do contato enxerga do orçamento — e, portanto, qual PDF ela
 * recebe para assinar.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *   Até aqui a coleta congelava UM documento e mandava o mesmo arquivo a todo
 *   mundo que a tarefa listava como responsável. Isso obrigava a uma escolha
 *   ruim: ou o gestor de frota recebia a tabela de preços para poder assinar a
 *   conferência do veículo, ou o financeiro deixava de assinar para não ver a
 *   arte que o cliente ainda não aprovou. Não havia terceira opção, porque o
 *   documento era um só.
 *
 *   Agora o envelope congela N RECORTES. Cada contato recebe o recorte que a
 *   união das funções dele pede, e assina só aquele — com hash próprio, âncoras
 *   próprias e selo PAdES próprio. Quem tem o mesmo recorte compartilha o mesmo
 *   PDF, então a coleta comum (todo mundo COMERCIAL, todo mundo recebendo tudo)
 *   continua produzindo um único arquivo, como sempre produziu.
 *
 * O QUE NUNCA É RECORTADO
 *   Cabeçalho, número do orçamento, datas de emissão e validade, destinatário,
 *   cláusula de aceitação do meio eletrônico, bloco de assinaturas e rodapé com
 *   o código de verificação. É o "texto básico": sem ele o arquivo não é um
 *   documento assinável, é um anexo solto. Por isso não há chave para ele — não
 *   se pode desligar o que sustenta o ato.
 */

import { RESPONSIBLE_ROLE } from '@constants/enums';

/**
 * As seções recortáveis, NA ORDEM CANÔNICA.
 *
 * A ordem é a de leitura do documento e é o que define `variantKey`: dois
 * conjuntos iguais têm de produzir a mesma chave, senão a deduplicação falha e
 * o mesmo recorte vira dois PDFs. Acrescentar uma seção nova no MEIO muda a
 * chave dos recortes já congelados — o que só é seguro porque a chave é
 * comparada apenas dentro de um envelope, e um envelope nunca renasce.
 * Ainda assim: acrescente no fim.
 */
export const QUOTE_SECTIONS = [
  'VEHICLE',
  'SERVICES',
  'PRICING',
  'DELIVERY',
  'PAYMENT',
  'GUARANTEE',
  'LAYOUT',
] as const;

export type QuoteSection = (typeof QUOTE_SECTIONS)[number];

export const QUOTE_SECTION_LABELS: Record<QuoteSection, string> = {
  VEHICLE: 'Identificação do veículo',
  SERVICES: 'Lista de serviços',
  PRICING: 'Valores e desconto',
  DELIVERY: 'Prazo de entrega',
  PAYMENT: 'Condições de pagamento',
  GUARANTEE: 'Garantias',
  LAYOUT: 'Layout',
};

/**
 * O que cada seção acrescenta ao documento, em uma linha — texto de tela.
 *
 * Escrito do ponto de vista de quem MARCA a caixa no modal de envio: a pergunta
 * que ele está respondendo é "esta pessoa precisa ver isto?", não "que elemento
 * de HTML isto liga".
 */
export const QUOTE_SECTION_DESCRIPTIONS: Record<QuoteSection, string> = {
  VEHICLE: 'Série, placa, chassi, categoria e tipo de implemento.',
  SERVICES: 'A relação numerada dos serviços, com as observações de cada um.',
  PRICING: 'Valor de cada serviço, subtotal, desconto e total.',
  DELIVERY: 'Prazo em dias úteis e quantas tarefas correm simultaneamente.',
  PAYMENT: 'Forma de pagamento, parcelas e vencimentos.',
  GUARANTEE: 'Prazo e termos da garantia.',
  LAYOUT: 'As imagens do layout aprovado.',
};

/** Todas as seções — o instrumento inteiro. */
export const FULL_SECTIONS: readonly QuoteSection[] = QUOTE_SECTIONS;

/**
 * O recorte PADRÃO de cada função.
 *
 * Padrão, não regra: o operador sobrescreve contato a contato no momento de
 * emitir a coleta (ver `signatureCreateEnvelopeSchema.signers`). O que está aqui
 * é o que acontece quando ele não mexe em nada — e é por isso que precisa ser o
 * comportamento certo na maioria das vezes, e nunca o mais permissivo.
 *
 *  · COMERCIAL, VENDEDOR, REPRESENTANTE, COORDENADOR e COMPRAS conduzem ou
 *    aprovam a negociação inteira: recebem tudo.
 *  · FINANCEIRO recebe tudo MENOS o layout. Preço, prazo, pagamento e garantia
 *    são exatamente o objeto dele; a arte não é, e ela circula antes de estar
 *    aprovada.
 *  · MARKETING recebe o texto básico e o layout. É a arte que ele aprova; o
 *    valor da obra não é assunto dele e não deveria sair do círculo que precisa
 *    dele.
 *  · GESTOR DE FROTA e MOTORISTA começam com NENHUMA seção — e, sem seção
 *    nenhuma, não recebem nada para assinar. Estão no cadastro como contato
 *    operacional do veículo, não como quem obriga a empresa. Quando um deles
 *    PRECISA assinar (conferência de implemento, por exemplo), o operador marca
 *    as seções na emissão e ele passa a receber. Assinar por padrão seria o
 *    inverso: colher a assinatura de quem provavelmente não tem poderes, o que
 *    é justamente a disputa que a declaração de representação existe para
 *    enfrentar.
 */
export const ROLE_DEFAULT_SECTIONS: Record<RESPONSIBLE_ROLE, readonly QuoteSection[]> = {
  [RESPONSIBLE_ROLE.COMMERCIAL]: FULL_SECTIONS,
  [RESPONSIBLE_ROLE.SELLER]: FULL_SECTIONS,
  [RESPONSIBLE_ROLE.REPRESENTATIVE]: FULL_SECTIONS,
  [RESPONSIBLE_ROLE.COORDINATOR]: FULL_SECTIONS,
  [RESPONSIBLE_ROLE.PURCHASING]: FULL_SECTIONS,
  [RESPONSIBLE_ROLE.FINANCIAL]: ['VEHICLE', 'SERVICES', 'PRICING', 'DELIVERY', 'PAYMENT', 'GUARANTEE'],
  [RESPONSIBLE_ROLE.MARKETING]: ['LAYOUT'],
  [RESPONSIBLE_ROLE.FLEET_MANAGER]: [],
  [RESPONSIBLE_ROLE.DRIVER]: [],
};

/**
 * Ordena, deduplica e descarta o que não é seção conhecida.
 *
 * Descartar em silêncio é deliberado: a entrada vem de um corpo HTTP e de
 * envelopes antigos, e uma seção que não existe mais não é um erro do operador —
 * é uma seção que saiu do documento. Recusar a emissão por causa dela puniria
 * quem não fez nada errado.
 */
export function canonicalSections(input: readonly string[] | null | undefined): QuoteSection[] {
  const wanted = new Set(input ?? []);
  return QUOTE_SECTIONS.filter(s => wanted.has(s));
}

/**
 * Chave de deduplicação de um recorte.
 *
 * `'BASE'` para o conjunto vazio, e não string vazia: a chave entra num índice
 * único e num nome de arquivo, e string vazia some em ambos.
 */
export function variantKeyOf(sections: readonly QuoteSection[]): string {
  return sections.length ? sections.join('+') : 'BASE';
}

/** União dos recortes padrão das funções do contato, em ordem canônica. */
export function sectionsForRoles(roles: readonly string[] | null | undefined): QuoteSection[] {
  const union = new Set<string>();
  for (const role of roles ?? []) {
    for (const section of ROLE_DEFAULT_SECTIONS[role as RESPONSIBLE_ROLE] ?? []) {
      union.add(section);
    }
  }
  return canonicalSections([...union]);
}

export function isFullSections(sections: readonly QuoteSection[]): boolean {
  return sections.length === QUOTE_SECTIONS.length;
}

export function hasSection(
  sections: readonly string[] | null | undefined,
  section: QuoteSection,
): boolean {
  return (sections ?? []).includes(section);
}

/**
 * Nome legível do recorte, para tela, para o nome do arquivo e para a trilha.
 *
 * "Documento completo" quando é tudo — a alternativa seria listar as sete
 * seções, o que não informa nada num painel onde o completo é o caso comum.
 */
export function describeSections(sections: readonly QuoteSection[]): string {
  if (isFullSections(sections)) return 'Documento completo';
  if (sections.length === 0) return 'Somente texto básico';
  return sections.map(s => QUOTE_SECTION_LABELS[s]).join(', ');
}

/**
 * Sufixo de arquivo do recorte. Vazio para o completo, para que o documento
 * único da coleta comum continue se chamando exatamente como sempre se chamou.
 */
export function variantFilenameSuffix(sections: readonly QuoteSection[]): string {
  if (isFullSections(sections)) return '';
  if (sections.length === 0) return '-basico';
  if (sections.length === 1) return `-${sections[0].toLowerCase()}`;
  // Um recorte de quatro ou cinco seções produziria um nome ilegível. O que
  // identifica de fato é a AUSÊNCIA: "sem layout" diz mais do que a lista das
  // seis que ficaram.
  const missing = QUOTE_SECTIONS.filter(s => !sections.includes(s));
  if (missing.length <= 2) return `-sem-${missing.map(s => s.toLowerCase()).join('-')}`;
  return `-${sections.map(s => s.toLowerCase()).join('-')}`;
}
