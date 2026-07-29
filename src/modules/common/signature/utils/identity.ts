/**
 * Normalização e mascaramento de identificadores para o selo e a trilha.
 *
 * A invariante que governa este arquivo: **mascare a exibição, nunca o registro.**
 * O CPF completo vive em `EnvelopeSigner.informedCpf` e na página anexa de
 * auditoria (que só as partes recebem); a forma mascarada aparece no selo visual,
 * no rodapé de cada página e no portal público — artefatos que circulam por
 * WhatsApp, e-mail e impressão. Se o valor mascarado virar o único registro, a
 * capacidade de identificar o signatário é destruída, e isso é fatal sob o
 * CPC art. 429, II.
 */

import { isValidCPF } from '@utils/validators';

/** Remove tudo que não é dígito. */
export function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '');
}

/**
 * Valida um CPF por mod-11.
 *
 * Filtro de digitação, nada além disso: prova formato, não existência, não
 * situação cadastral, não titularidade. Nunca chame isto de "verificação" na UI
 * nem imprima "CPF verificado" no selo com base só nisto.
 */
export function isCpfWellFormed(cpf: string): boolean {
  const digits = onlyDigits(cpf);
  if (digits.length !== 11) return false;
  // CPFs de dígito repetido passam na aritmética mod-11 e precisam de rejeição explícita.
  if (/^(\d)\1{10}$/.test(digits)) return false;
  return isValidCPF(digits);
}

/** `12345678901` → `123.456.789-01` */
export function formatCpf(cpf: string): string {
  const d = onlyDigits(cpf);
  if (d.length !== 11) return cpf ?? '';
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * `12345678901` → `***.456.789-**`
 *
 * Oculta os três primeiros dígitos e os dois verificadores. Este formato — e não
 * o `123.***.***-01` usado por bancos e e-commerce — é o que tem lastro
 * normativo: LDO 2011 (Lei 12.309/2010, art. 87, §5º), repetido nas LDOs
 * seguintes, e consolidado no PARECER n. 00001/2021/CONJUR-CGU/CGU/AGU, que
 * orienta o formato `***.999.999-**`. Em uso contínuo no Portal da Transparência
 * desde 2009.
 *
 * Ressalva honesta: é regra de transparência da administração pública, não
 * comando da LGPD para particulares. Mas é a única convenção com respaldo e
 * adotá-la é gratuito.
 */
export function maskCpf(cpf: string | null | undefined): string {
  const d = onlyDigits(cpf);
  if (d.length !== 11) return '***.***.***-**';
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/**
 * Partes da máscara do CPF, para confirmação parcial: o signatário completa os
 * dígitos ocultos em vez de digitar o documento inteiro às cegas.
 * `52998224725` → { prefix: '529', hidden: 6, suffix: '25' }
 */
export function cpfMaskParts(cpf: string | null | undefined): {
  prefix: string;
  hiddenLength: number;
  suffix: string;
} {
  const d = onlyDigits(cpf);
  if (d.length !== 11) return { prefix: '', hiddenLength: 0, suffix: '' };
  return { prefix: d.slice(0, 3), hiddenLength: 6, suffix: d.slice(9) };
}

/**
 * `43984283228` → `+55 43 9****-3228`
 *
 * Não há convenção legal para telefone; esta preserva DDD e os 4 últimos dígitos,
 * o suficiente para o signatário reconhecer o próprio número sem expô-lo.
 */
export function maskPhone(phone: string | null | undefined): string {
  const d = onlyDigits(phone);
  if (d.length < 10) return '+55 ** ****-****';

  // Descarta o código do país quando presente (11 dígitos nacionais no máximo).
  const national = d.length > 11 && d.startsWith('55') ? d.slice(2) : d;
  if (national.length < 10) return '+55 ** ****-****';

  const ddd = national.slice(0, 2);
  const rest = national.slice(2);
  const last4 = rest.slice(-4);
  const firstOfSubscriber = rest.slice(0, 1);
  const hidden = '*'.repeat(Math.max(rest.length - 5, 0));

  return `+55 ${ddd} ${firstOfSubscriber}${hidden}-${last4}`;
}

/**
 * Partes da máscara do telefone, para a confirmação parcial na tela.
 * `43984283228` → { prefix: '+55 43 9', hidden: 4, suffix: '3228' }
 */
export function phoneMaskParts(phone: string | null | undefined): {
  prefix: string;
  hiddenLength: number;
  suffix: string;
} {
  const d = onlyDigits(phone);
  const national = d.length > 11 && d.startsWith('55') ? d.slice(2) : d;
  if (national.length < 10) return { prefix: '+55', hiddenLength: 0, suffix: '' };
  const ddd = national.slice(0, 2);
  const rest = national.slice(2);
  return {
    prefix: `+55 ${ddd} ${rest.slice(0, 1)}`,
    hiddenLength: Math.max(rest.length - 5, 0),
    suffix: rest.slice(-4),
  };
}

/**
 * Recorte da parte local do e-mail: o que se mostra, o que se esconde.
 *
 * REGRA: ~40% do início visível, o resto mascarado, e SEMPRE o último
 * caractere antes do `@`. O domínio nunca é escondido.
 *
 * O número de asteriscos acompanha o comprimento real. A versão anterior usava
 * `***` fixo para não publicar o tamanho da parte local, mas o custo era alto e
 * o ganho pequeno: `k***a@gmail.com` fica idêntico para um endereço de 5 e um
 * de 25 caracteres, então o signatário não consegue reconhecer o próprio
 * e-mail — que é exatamente para isso que a máscara existe na cerimônia. O
 * comprimento também não é segredo real aqui: o domínio sai inteiro e o nome da
 * pessoa já vai impresso ao lado.
 *
 * As duas funções públicas (`maskEmail` e `emailMaskParts`) saem daqui, e não
 * cada uma da sua conta: elas alimentam a MESMA conferência — uma desenha a
 * máscara, a outra diz quantas caixas o signatário precisa preencher. Se
 * divergissem, a tela pediria um número de caracteres diferente do que a
 * máscara mostra e a conferência ficaria impossível de acertar.
 */
function splitEmailLocal(local: string): { head: string; hiddenLength: number; tail: string } {
  const n = local.length;
  // Curto demais para revelar qualquer coisa sem entregar o endereço inteiro.
  if (n <= 2) return { head: '', hiddenLength: n, tail: '' };

  // 40% do início, nunca menos de um caractere.
  let head = Math.max(1, Math.floor(n * 0.4));
  // Garante ao menos UM asterisco entre o início visível e o último caractere;
  // sem isto um endereço de 3 letras sairia sem máscara nenhuma.
  if (head > n - 2) head = n - 2;

  return { head: local.slice(0, head), hiddenLength: n - head - 1, tail: local.slice(-1) };
}

/** Separa `local@dominio`, devolvendo `null` quando não é um endereço utilizável. */
function splitEmail(email: string | null | undefined): { local: string; domain: string } | null {
  const raw = (email ?? '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at <= 0 || at === raw.length - 1) return null;
  const domain = raw.slice(at + 1);
  if (!domain.includes('.')) return null;
  return { local: raw.slice(0, at), domain };
}

/**
 * `kennedy.ankaa@gmail.com` → `kenne*******a@gmail.com`
 * `joao.silva@empresa.com.br` → `joao.****a@empresa.com.br`
 *
 * Como toda máscara deste arquivo: vale para EXIBIÇÃO. O endereço completo
 * continua em `EnvelopeSigner.declaredEmail`.
 */
export function maskEmail(email: string | null | undefined): string {
  const parts = splitEmail(email);
  if (!parts) return '***@***';
  const { head, hiddenLength, tail } = splitEmailLocal(parts.local);
  return `${head}${'*'.repeat(hiddenLength)}${tail}@${parts.domain}`;
}

/**
 * Partes da máscara do e-mail, para a confirmação parcial na tela.
 * `kennedy.ankaa@gmail.com` → { prefix: 'kenne', hidden: 7, suffix: 'a', domain: 'gmail.com' }
 *
 * O signatário completa só os caracteres ocultos da parte local — o domínio
 * aparece inteiro. Digitar o endereço todo não provaria nada além de saber ler
 * a própria tela; o que liga a assinatura à pessoa é ela conhecer o endereço
 * que a Ankaa tem no cadastro.
 */
export function emailMaskParts(email: string | null | undefined): {
  prefix: string;
  hiddenLength: number;
  suffix: string;
  domain: string;
} {
  const parts = splitEmail(email);
  if (!parts) return { prefix: '', hiddenLength: 0, suffix: '', domain: '' };
  const { head, hiddenLength, tail } = splitEmailLocal(parts.local);
  return { prefix: head, hiddenLength, suffix: tail, domain: parts.domain };
}

/** `43984283228` → `(43) 98428-3228` (uso interno, não exibir ao público). */
export function formatPhone(phone: string | null | undefined): string {
  const d = onlyDigits(phone);
  const national = d.length > 11 && d.startsWith('55') ? d.slice(2) : d;
  if (national.length === 11) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  }
  if (national.length === 10) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  }
  return phone ?? '';
}

/** `12345678000199` → `12.345.678/0001-99` */
export function formatCnpj(cnpj: string | null | undefined): string {
  const d = onlyDigits(cnpj);
  if (d.length !== 14) return cnpj ?? '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Código público de verificação: Crockford base32 sem caracteres ambíguos
 * (I, L, O, U removidos), em grupos de 4 — `A7K9-2FMQ-XR4T`.
 *
 * Precisa ser ditável por telefone e transcrevível de uma folha impressa, então
 * legibilidade importa mais do que densidade. 12 caracteres do alfabeto de 32
 * dão 60 bits, muito além do necessário para não ser adivinhável.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function formatVerificationCode(bytes: Buffer): string {
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += CROCKFORD[bytes[i % bytes.length] % CROCKFORD.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

/** Normaliza a entrada do usuário no portal de verificação (case/hífens livres). */
export function normalizeVerificationCode(input: string): string {
  const clean = (input ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    // Tolerância de transcrição: o alfabeto Crockford não usa I/L/O/U.
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
  if (clean.length !== 12) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}`;
}
