/**
 * Nome de arquivo dos PDFs de orçamento e de dossiê.
 *
 * UMA fonte para os dois documentos, porque eles têm de sair iguais em TODAS as
 * portas por onde saem — o download interno, o link público do cliente e o
 * anexo do e-mail. Antes cada porta escrevia o seu: `orcamento-417.pdf` na
 * página pública, `orcamento-assinado-3f2a1b8c.pdf` no fallback do bloqueador
 * de pop-up, `dossie-orcamento-417.pdf` no servidor e
 * `MADEIREIRA X - dossie.pdf` na tela da tarefa. Quatro nomes para dois
 * documentos, e nenhum deles dizia de quem era o arquivo — o financeiro do
 * cliente recebia `orcamento-417.pdf` e tinha de abrir para saber.
 *
 * O nome carrega RAZÃO SOCIAL + rótulo + número, na ordem em que se procura um
 * arquivo: primeiro de quem é, depois o que é, depois qual é. O rótulo nomeia o
 * DOCUMENTO — "Orçamento" ou "Dossiê" —, que é o mesmo texto que as páginas
 * públicas imprimem no topo ("Orçamento Nº 0417", "Dossiê Nº 0417"), padding de
 * 4 dígitos incluído: o arquivo tem de ser pesquisável pelo que o cliente está
 * lendo na tela.
 *
 * O NÚMERO é o mesmo nos dois: `budgetNumber`. Não existe sequência separada
 * para o dossiê, e inventar uma só para o nome do arquivo criaria um número que
 * ninguém consegue procurar no sistema.
 */

/** Razão social, com recuo para nome fantasia e, por fim, um rótulo genérico. */
export function customerLabel(
  customer: { corporateName?: string | null; fantasyName?: string | null } | null | undefined,
): string {
  return customer?.corporateName?.trim() || customer?.fantasyName?.trim() || 'Cliente';
}

/** `0417` — o mesmo texto que a página imprime ao lado de "Nº". */
export function padBudgetNumber(budgetNumber: number | null | undefined): string {
  return budgetNumber == null ? '0000' : String(budgetNumber).padStart(4, '0');
}

/** `MADEIREIRA X LTDA - Orçamento 0417.pdf` */
export function budgetPdfFilename(
  customer: { corporateName?: string | null; fantasyName?: string | null } | null | undefined,
  budgetNumber: number | null | undefined,
): string {
  return `${sanitizeFilename(customerLabel(customer))} - Orçamento ${padBudgetNumber(budgetNumber)}.pdf`;
}

/** `MADEIREIRA X LTDA - Dossiê 0417.pdf` — mesmo número, outro documento. */
export function dossierPdfFilename(
  customer: { corporateName?: string | null; fantasyName?: string | null } | null | undefined,
  budgetNumber: number | null | undefined,
): string {
  return `${sanitizeFilename(customerLabel(customer))} - Dossiê ${padBudgetNumber(budgetNumber)}.pdf`;
}

/**
 * Tira do nome o que sistema de arquivos e cabeçalho HTTP não aceitam.
 *
 * Acentos FICAM: o destino é o `Downloads` do cliente, e "MADEIREIRA SÃO JOÃO"
 * virando "MADEIREIRA SAO JOAO" é degradação sem motivo — a versão ASCII existe
 * separada, só para o parâmetro legado do cabeçalho (ver `contentDisposition`).
 * O que sai são os separadores de caminho e os caracteres reservados do Windows,
 * mais os controles: qualquer um deles quebra a gravação ou, no caso do `"` e do
 * `\r\n`, escapa do valor do cabeçalho.
 */
export function sanitizeFilename(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      // Windows recusa nome terminado em ponto ou espaço.
      .replace(/[. ]+$/, '') || 'Documento'
  );
}

/**
 * Valor de `Content-Disposition` com o nome em UTF-8.
 *
 * Os dois parâmetros são obrigatórios, não redundantes: `filename` é ISO-8859-1
 * por especificação, então razão social com acento tem de viajar no `filename*`
 * (RFC 5987/6266). Mandar só o `filename` com bytes UTF-8 crus faz o navegador
 * gravar "MADEIREIRA SÃƒO JOÃƒO.pdf"; mandar só o `filename*` perde clientes
 * antigos, que caem para o nome derivado da URL (`documento.pdf`).
 */
export function contentDisposition(
  type: 'inline' | 'attachment',
  filename: string,
): string {
  const safe = sanitizeFilename(filename);
  const ascii = safe
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '')
    .trim();
  return (
    `${type}; filename="${ascii || 'documento.pdf'}"; ` +
    `filename*=UTF-8''${rfc5987(safe)}`
  );
}

/**
 * Percent-encoding do `ext-value` da RFC 5987.
 *
 * O `encodeURIComponent` deixa passar `'()*!` — e a apóstrofe é justamente o
 * DELIMITADOR do `filename*=UTF-8''…`. Razão social com apóstrofe ("D'ANGELO
 * TRANSPORTES") fecharia o valor no meio do nome.
 */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*!]/g,
    c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
