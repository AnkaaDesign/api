/**
 * E-mails da cerimônia de assinatura eletrônica de orçamento.
 *
 * Arquivo SEPARADO de `email-templates.ts` de propósito: esta cópia é
 * juridicamente relevante (descreve o método de autenticação que a
 * `ACCEPTANCE_CLAUSE` invoca) e não deve ser editada de passagem junto com o
 * e-mail de recuperação de senha.
 *
 * Mecanismo: função TS que devolve HTML, igual a `email-templates.ts`. O
 * caminho Handlebars existe no repositório mas lê templates do disco a partir
 * de `process.cwd()/src/templates/emails`, e o `nest-cli.json` não copia assets
 * para `dist` — em produção não haveria arquivo para ler.
 */

import { COMPANY } from '../config/company';

const LOGO_URL = `${process.env.WEB_APP_URL || 'https://ankaadesign.com.br'}/branding/logo.png`;

const GREEN = '#16802B';
const INK = '#1a1a1a';
const MUTED = '#5f6b60';
const LINE = '#e2e8e3';

export interface SignatureEmailBase {
  signerName: string;
  budgetNumber: string | number;
}

/** Escapa interpolação vinda do cadastro. Nome de cliente pode conter `&`, `<`. */
function esc(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Casca comum. O preheader é o trecho que o cliente mostra ao lado do assunto
 * na lista — sem ele, aparece o começo do HTML.
 */
function shell(opts: {
  title: string;
  subtitle: string;
  preheader: string;
  body: string;
  footerNote: string;
}): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(opts.title)} - ${COMPANY.name}</title>
<style>
  body { font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif; line-height:1.6;
         color:${INK}; background:#f4f6f4; max-width:600px; margin:0 auto; padding:20px; }
  .header { background:#ffffff; padding:28px 24px 22px; text-align:center;
            border:1px solid ${LINE}; border-bottom:3px solid ${GREEN}; border-radius:8px 8px 0 0; }
  .header h1 { margin:0 0 4px; font-size:21px; font-weight:600; color:${INK}; }
  .header p { margin:0; font-size:14px; color:${MUTED}; }
  .content { background:#ffffff; padding:30px; border:1px solid ${LINE}; border-top:none; }
  .content p { margin:0 0 14px; }
  .footer { background:#f8f9fa; padding:20px; text-align:center; border:1px solid ${LINE};
            border-top:none; border-radius:0 0 8px 8px; font-size:13px; color:${MUTED}; }
  .footer p { margin:4px 0; }
  .button { display:inline-block; padding:14px 34px; background:${GREEN}; color:#ffffff !important;
            text-decoration:none; border-radius:6px; font-weight:bold; font-size:16px; }
  .code { background:#f2f7f3; border:1px solid #cfe3d4; border-left:4px solid ${GREEN};
          border-radius:6px; padding:20px 15px; font-family:'SFMono-Regular',Consolas,'Courier New',monospace;
          font-size:34px; letter-spacing:8px; font-weight:bold; color:${GREEN};
          text-align:center; margin:24px 0; }
  .alert { background:#fff3cd; border:1px solid #ffeaa7; border-radius:6px; padding:15px; margin:20px 0; }
  .muted { color:${MUTED}; font-size:14px; }
  .linkbox { word-break:break-all; background:#f5f7f5; padding:12px; border-radius:6px;
             font-size:13px; color:${MUTED}; }
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<div class="header">
  <img src="${LOGO_URL}" width="180" alt="${COMPANY.name}"
       style="display:block;margin:0 auto 14px;width:180px;max-width:60%;height:auto;border:0;">
  <h1>${esc(opts.title)}</h1>
  <p>${esc(opts.subtitle)}</p>
</div>
<div class="content">
${opts.body}
</div>
<div class="footer">
  <p>${opts.footerNote}</p>
  <p>${COMPANY.email} &nbsp;|&nbsp; ${COMPANY.phone}</p>
  <p style="margin-top:10px;color:#9aa89d;">${COMPANY.name} — ${COMPANY.website}</p>
</div>
</body>
</html>`;
}

export interface InvitationEmailData extends SignatureEmailBase {
  signingUrl: string;
  deadlineDate: string;
  totalFormatted?: string | null;
  /** Reenvio manual pelo operador muda a abertura, não o resto. */
  isResend?: boolean;
}

export function generateSignatureInvitationEmail(data: InvitationEmailData): {
  subject: string;
  html: string;
} {
  const subject = data.isResend
    ? `Reenvio: orçamento nº ${data.budgetNumber} aguarda sua assinatura`
    : `Orçamento nº ${data.budgetNumber} — assinatura eletrônica | ${COMPANY.name}`;

  const opening = data.isResend
    ? `Estamos reenviando o link de assinatura do orçamento nº <strong>${esc(data.budgetNumber)}</strong>.`
    : `O orçamento nº <strong>${esc(data.budgetNumber)}</strong>${
        data.totalFormatted ? `, no valor total de <strong>${esc(data.totalFormatted)}</strong>,` : ''
      } está pronto para sua revisão e assinatura eletrônica.`;

  return {
    subject,
    html: shell({
      title: 'Assinatura eletrônica de orçamento',
      subtitle: `Orçamento nº ${data.budgetNumber}`,
      preheader: `Seu orçamento está pronto para assinatura. O link é pessoal e vale até ${data.deadlineDate}.`,
      footerNote: `Este é um e-mail automático referente ao orçamento nº ${esc(data.budgetNumber)}.`,
      body: `
<p>Olá, ${esc(data.signerName)}.</p>
<p>${opening}</p>
<p>No link abaixo você lê o documento na íntegra, confere os valores e, se estiver de acordo, assina eletronicamente. Leva poucos minutos, funciona no celular ou no computador, e não é preciso imprimir nem instalar nada.</p>
<p style="text-align:center;margin:26px 0;">
  <a href="${data.signingUrl}" class="button">Revisar e assinar o orçamento</a>
</p>
<p class="muted">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
<p class="linkbox">${esc(data.signingUrl)}</p>
<div class="alert">
  <strong>Este link é pessoal.</strong> Ele foi gerado para você, registra quem acessou o documento
  e vale até <strong>${esc(data.deadlineDate)}</strong>. Não encaminhe este e-mail.
</div>
<p class="muted"><strong>Como funciona:</strong> você lê o orçamento, confirma seus dados,
recebe um código de uso único neste mesmo e-mail, digita o código e conclui. Ao final você recebe
o documento assinado, com carimbo do tempo e código de verificação pública.</p>`,
    }),
  };
}

export interface OtpEmailData extends SignatureEmailBase {
  code: string;
  expiryMinutes: number;
}

/**
 * O código NÃO vai no assunto nem no preheader: os dois vazam para a prévia da
 * notificação na tela de bloqueio e para logs de servidor de e-mail.
 *
 * Este e-mail também não carrega nenhum link clicável além do `mailto:` de
 * suporte. É a prática correta para mensagem de código (reduz superfície de
 * phishing) e ajuda a entregabilidade.
 */
export function generateSignatureOtpEmail(data: OtpEmailData): {
  subject: string;
  html: string;
} {
  return {
    subject: `Código de assinatura — orçamento nº ${data.budgetNumber}`,
    html: shell({
      title: 'Código de uso único',
      subtitle: `Orçamento nº ${data.budgetNumber}`,
      preheader: `Código para concluir a assinatura. Válido por ${data.expiryMinutes} minutos. Não compartilhe.`,
      footerNote: 'E-mail automático. Nunca responda esta mensagem com o seu código.',
      body: `
<p>Olá, ${esc(data.signerName)}.</p>
<p>Use o código abaixo para concluir a assinatura eletrônica do orçamento nº <strong>${esc(data.budgetNumber)}</strong>:</p>
<div class="code">${esc(data.code)}</div>
<p style="text-align:center;" class="muted">
  Expira em <strong>${data.expiryMinutes} minutos</strong> e só pode ser usado uma vez.
</p>
<div class="alert">
  <strong>Nunca repasse este código a ninguém.</strong> Nenhum atendente da ${COMPANY.name} vai
  pedir que você envie ou dite este código — nem por telefone, nem por WhatsApp, nem respondendo
  a este e-mail. Se alguém pedir, é golpe.
</div>
<p class="muted">Se você não solicitou este código, ignore esta mensagem — ele perde a validade
sozinho e nenhuma assinatura será registrada.</p>`,
    }),
  };
}

export interface AnkaaNoticeEmailData extends SignatureEmailBase {
  /**
   * A tela INTERNA do orçamento, atrás do login — não um link de assinatura.
   *
   * A contra-assinatura da Ankaa passou a acontecer em sessão autenticada, e o
   * link deste aviso mudou junto por uma razão de segurança, não de navegação:
   * um link que ASSINE sem código é uma capability de obrigar a empresa viajando
   * por e-mail. Quem recebesse a mensagem encaminhada, ou tivesse acesso à caixa,
   * fecharia o negócio. Este endereço não assina nada por si — ele leva a uma
   * página que exige credencial.
   */
  quoteUrl: string;
  /** Quantos responsáveis do cliente assinaram. Vai no corpo, para dar o porquê. */
  signedCount?: number;
}

export function generateAnkaaCountersignEmail(data: AnkaaNoticeEmailData): {
  subject: string;
  html: string;
} {
  const quantos =
    data.signedCount && data.signedCount > 0
      ? `${data.signedCount} ${data.signedCount === 1 ? 'responsável' : 'responsáveis'} do cliente`
      : 'Todos os responsáveis do cliente';
  return {
    subject: `Orçamento nº ${data.budgetNumber} — pronto para sua assinatura`,
    html: shell({
      title: 'Pronto para contra-assinatura',
      subtitle: `Orçamento nº ${data.budgetNumber}`,
      preheader: 'Todos os responsáveis do cliente já assinaram.',
      footerNote: 'E-mail automático da cerimônia de assinatura.',
      body: `
<p>Olá, ${esc(data.signerName)}.</p>
<p>${esc(quantos)} já ${data.signedCount === 1 ? 'assinou' : 'assinaram'} o orçamento nº <strong>${esc(data.budgetNumber)}</strong>. Falta apenas a sua contra-assinatura para concluir.</p>
<p>Ela é feita <strong>dentro do sistema</strong>, na tela do orçamento: um botão, sem código de verificação.</p>
<p style="text-align:center;margin:26px 0;">
  <a href="${data.quoteUrl}" class="button">Abrir o orçamento e contra-assinar</a>
</p>
<p class="linkbox">${esc(data.quoteUrl)}</p>`,
    }),
  };
}

/**
 * A COBRANÇA da contra-assinatura, dias depois do aviso.
 *
 * Existe porque a cadência de lembretes passou a alcançar o grupo 1 (o nosso
 * lado). Até 17/09 o aviso de contra-assinatura saía UMA vez, sem `await` e
 * best-effort: se a mensagem falhasse — telefone errado, disjuntor do WhatsApp
 * aberto, servidor de e-mail recusando —, ninguém era cobrado de novo e a coleta
 * ficava parada com o cliente já tendo assinado.
 *
 * NÃO REPETE O AVISO, pela mesma razão do lembrete do cliente: quem recebe isto
 * já foi avisado. A informação nova é UMA — há quanto tempo está parado.
 */
export interface AnkaaCountersignReminderEmailData extends AnkaaNoticeEmailData {
  /** Dias civis desde que o último responsável do cliente assinou. */
  daysPending: number;
}

export function generateAnkaaCountersignReminderEmail(data: AnkaaCountersignReminderEmailData): {
  subject: string;
  html: string;
} {
  const tempo =
    data.daysPending <= 0
      ? 'hoje'
      : data.daysPending === 1
        ? 'desde ontem'
        : `há ${data.daysPending} dias`;
  return {
    subject: `Orçamento nº ${data.budgetNumber} — contra-assinatura pendente ${tempo}`,
    html: shell({
      title: 'Contra-assinatura pendente',
      subtitle: `Orçamento nº ${data.budgetNumber}`,
      preheader: `O cliente assinou ${tempo} e a coleta aguarda a Ankaa.`,
      footerNote: 'E-mail automático da cerimônia de assinatura.',
      body: `
<p>Olá, ${esc(data.signerName)}.</p>
<p>O orçamento nº <strong>${esc(data.budgetNumber)}</strong> está assinado pelo cliente ${esc(tempo)} e continua aguardando a contra-assinatura da ${COMPANY.name}.</p>
<p>Enquanto ela não sai, o documento final não é emitido e o orçamento não é aprovado.</p>
<p style="text-align:center;margin:26px 0;">
  <a href="${data.quoteUrl}" class="button">Abrir o orçamento e contra-assinar</a>
</p>
<p class="linkbox">${esc(data.quoteUrl)}</p>`,
    }),
  };
}

export interface RefusalNoticeEmailData extends SignatureEmailBase {
  /** Quem RECUSOU. `signerName` é quem RECEBE o aviso. */
  refusedByName: string;
  reason: string;
  quoteUrl: string;
}

/**
 * O aviso de recusa para o comercial.
 *
 * O motivo vai num bloco DESTACADO e entre aspas: é a frase de outra pessoa, e
 * misturá-la ao texto do sistema faria parecer que a Ankaa está afirmando
 * aquilo. É também a única informação da mensagem que não se deduz do resto.
 */
export function generateRefusalNoticeEmail(data: RefusalNoticeEmailData): {
  subject: string;
  html: string;
} {
  return {
    subject: `Orçamento nº ${data.budgetNumber} — assinatura recusada pelo cliente`,
    html: shell({
      title: 'Assinatura recusada',
      subtitle: `Orçamento nº ${data.budgetNumber}`,
      preheader: `${data.refusedByName} recusou a assinatura.`,
      footerNote: 'E-mail automático da cerimônia de assinatura.',
      body: `
<p>Olá, ${esc(data.signerName)}.</p>
<p><strong>${esc(data.refusedByName)}</strong> recusou a assinatura do orçamento nº <strong>${esc(data.budgetNumber)}</strong>.</p>
<p>Motivo informado:</p>
<p class="linkbox">&ldquo;${esc(data.reason)}&rdquo;</p>
<p>A coleta <strong>não foi encerrada</strong>: as assinaturas já colhidas continuam valendo, e quem ainda não assinou ainda pode. O que ela não pode é se concluir enquanto este responsável estiver de fora.</p>
<p>Para retomar, use <strong>Pedir novamente</strong> na tela do orçamento — ou ajuste a proposta, lembrando que o reajuste invalida as assinaturas já colhidas e exige uma coleta nova.</p>
<p style="text-align:center;margin:26px 0;">
  <a href="${data.quoteUrl}" class="button">Abrir o orçamento</a>
</p>
<p class="linkbox">${esc(data.quoteUrl)}</p>`,
    }),
  };
}

export interface CollectionPausedEmailData extends SignatureEmailBase {
  refusedByName: string;
}

/**
 * Aviso aos DEMAIS responsáveis. Ver a nota do gerador de WhatsApp: o MOTIVO da
 * recusa não entra aqui — ele é posição interna do cliente e vai só para o nosso
 * comercial.
 */
export function generateCollectionPausedEmail(data: CollectionPausedEmailData): {
  subject: string;
  html: string;
} {
  return {
    subject: `Orçamento nº ${data.budgetNumber} — coleta de assinaturas pausada`,
    html: shell({
      title: 'Coleta pausada',
      subtitle: `Orçamento nº ${data.budgetNumber}`,
      preheader: 'As assinaturas já registradas continuam valendo.',
      footerNote: 'E-mail automático da cerimônia de assinatura.',
      body: `
<p>Olá, ${esc(data.signerName)}.</p>
<p>A coleta de assinaturas do orçamento nº <strong>${esc(data.budgetNumber)}</strong> foi pausada:
<strong>${esc(data.refusedByName)}</strong> não aprovou a proposta.</p>
<p><strong>As assinaturas já registradas continuam valendo</strong> — nada do que você assinou foi perdido.</p>
<p>Vamos retomar o contato. Se o orçamento for alterado, você recebe um novo link para revisar e assinar.</p>`,
    }),
  };
}

export interface VoidedEmailData extends SignatureEmailBase {
  reason: string;
  hadSigned: boolean;
  /**
   * O que mudou, item a item. Opcional só para não quebrar chamadores antigos —
   * quando vem preenchida, é ela que o leitor lê, e o `reason` fica sendo o
   * resumo de uma linha.
   */
  changes?: Array<{
    label: string;
    subject: string | null;
    before: string | null;
    after: string | null;
  }>;
}

/**
 * Tabela "antes → depois" das alterações.
 *
 * `<table>` e estilos inline, não flexbox: Outlook desktop ignora display:flex e
 * empilharia tudo numa coluna só. É feio de escrever e é o que funciona nos
 * clientes que os clientes usam.
 */
function changesTable(changes: NonNullable<VoidedEmailData['changes']>): string {
  if (!changes.length) return '';
  const rows = changes
    .map(c => {
      const title = c.subject ? `${esc(c.label)} — ${esc(c.subject)}` : esc(c.label);
      // Uma inclusão não tem "antes" e uma remoção não tem "depois"; escrever
      // uma seta com um dos lados vazio parece dado faltando, não novidade.
      const value =
        c.before && c.after
          ? `<span style="text-decoration:line-through;color:${MUTED};">${esc(c.before)}</span>
             <span style="color:${MUTED};">&nbsp;→&nbsp;</span>
             <strong>${esc(c.after)}</strong>`
          : c.after
            ? `<strong>${esc(c.after)}</strong>`
            : c.before
              ? `<span style="text-decoration:line-through;color:${MUTED};">${esc(c.before)}</span>`
              : '<span style="color:#6b7280;">alterado</span>';
      return `<tr>
  <td style="padding:8px 12px;border-bottom:1px solid ${LINE};font-size:14px;color:${MUTED};white-space:nowrap;">${title}</td>
  <td style="padding:8px 12px;border-bottom:1px solid ${LINE};font-size:14px;text-align:right;">${value}</td>
</tr>`;
    })
    .join('\n');
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
  style="border-collapse:collapse;border:1px solid ${LINE};border-radius:6px;margin:18px 0;">
${rows}
</table>`;
}

export interface ReminderEmailData extends SignatureEmailBase {
  signingUrl: string;
  deadlineDate: string;
  /** Dias inteiros restantes de validade. Nunca negativo. */
  daysLeft: number;
}

/**
 * Lembrete de que a assinatura segue pendente.
 *
 * Deliberadamente MAIS CURTO que o convite. O convite precisa explicar a
 * cerimônia para quem nunca assinou eletronicamente; o lembrete fala com alguém
 * que já leu tudo isso. Repetir a explicação transformaria o lembrete num
 * segundo convite, e a pessoa pararia de abrir os dois.
 *
 * O assunto carrega o PRAZO e não o número do orçamento: na caixa de entrada, o
 * que faz abrir é "faltam 2 dias", não "nº 839" — que ela já viu três vezes.
 */
export function generateSignatureReminderEmail(data: ReminderEmailData): {
  subject: string;
  html: string;
} {
  const prazoFrase =
    data.daysLeft <= 0
      ? 'hoje é o último dia de validade'
      : data.daysLeft === 1
        ? 'a validade vence amanhã'
        : `faltam ${data.daysLeft} dias para a validade vencer`;

  const subject =
    data.daysLeft <= 0
      ? `Último dia: orçamento nº ${data.budgetNumber} aguarda sua assinatura`
      : `Faltam ${data.daysLeft} dia${data.daysLeft === 1 ? '' : 's'}: orçamento nº ${
          data.budgetNumber
        } aguarda sua assinatura`;

  return {
    subject,
    html: shell({
      title: 'Assinatura pendente',
      subtitle: `Orçamento nº ${data.budgetNumber}`,
      preheader: `${prazoFrase.charAt(0).toUpperCase()}${prazoFrase.slice(1)}.`,
      footerNote: `Este é um e-mail automático referente ao orçamento nº ${esc(data.budgetNumber)}.`,
      body: `
<p>Olá, ${esc(data.signerName)}.</p>
<p>O orçamento nº <strong>${esc(data.budgetNumber)}</strong> ainda aguarda sua assinatura — <strong>${esc(
        prazoFrase,
      )}</strong> (validade até ${esc(data.deadlineDate)}).</p>
<p style="text-align:center;margin:26px 0;">
  <a href="${data.signingUrl}" class="button">Revisar e assinar o orçamento</a>
</p>
<p class="muted">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
<p class="linkbox">${esc(data.signingUrl)}</p>
<p class="muted">Se já não houver interesse na proposta, basta responder este e-mail — assim
paramos os lembretes e liberamos a agenda de produção.</p>`,
    }),
  };
}

export interface ExpiredEmailData extends SignatureEmailBase {
  hadSigned: boolean;
  /** Data em que a validade venceu, já formatada em pt-BR. */
  expiredOn: string;
}

/**
 * A validade venceu sem todas as assinaturas.
 *
 * O e-mail diz o mesmo que o WhatsApp e acrescenta o que só cabe aqui: a data
 * exata do vencimento. Ver a nota gêmea em `generateSignatureExpiredWhatsApp`
 * sobre o tom — o prazo é nosso, a validade é do PREÇO, e o cliente não
 * descumpriu coisa alguma — e sobre por que a iniciativa da proposta nova é
 * dele, e não nossa.
 *
 * SAIU o "nenhuma providência é necessária da sua parte": era verdade enquanto
 * nós prometíamos voltar com valores novos. Agora contradiria o parágrafo de
 * cima, que pede exatamente uma providência de quem ainda quiser o serviço.
 */
export function generateSignatureExpiredEmail(data: ExpiredEmailData): {
  subject: string;
  html: string;
} {
  return {
    subject: `Orçamento nº ${data.budgetNumber} — validade encerrada`,
    html: shell({
      title: 'Validade encerrada',
      subtitle: `Orçamento nº ${data.budgetNumber}`,
      preheader: 'Se ainda houver interesse, fale com o nosso comercial.',
      footerNote: 'E-mail automático da cerimônia de assinatura.',
      body: `
<p>Olá, ${esc(data.signerName)}.</p>
<p>A validade do orçamento nº <strong>${esc(data.budgetNumber)}</strong> venceu em
<strong>${esc(data.expiredOn)}</strong>, e a coleta de assinaturas foi encerrada.</p>
${
  data.hadSigned
    ? `<div class="alert"><strong>Sua assinatura ficou registrada.</strong>
       O que venceu foi o prazo de validade do orçamento — não a assinatura que você fez.</div>`
    : '<p>O link de assinatura que você recebeu não vale mais.</p>'
}
<p>Se ainda houver interesse neste serviço, entre em contato com o nosso time comercial para
avaliarmos uma nova proposta: basta responder este e-mail ou falar com
${esc(COMPANY.directorName)}, ${esc(COMPANY.directorTitle)}, pelo ${esc(COMPANY.phone)}.</p>`,
    }),
  };
}

export function generateEnvelopeVoidedEmail(data: VoidedEmailData): {
  subject: string;
  html: string;
} {
  return {
    subject: `Importante: o orçamento nº ${data.budgetNumber} foi alterado`,
    html: shell({
      title: 'Orçamento alterado',
      subtitle: `Orçamento nº ${data.budgetNumber}`,
      preheader: 'O link de assinatura enviado antes não vale mais.',
      footerNote: 'E-mail automático da cerimônia de assinatura.',
      body: `
<p>Olá, ${esc(data.signerName)}.</p>
<p>O orçamento nº <strong>${esc(data.budgetNumber)}</strong> foi alterado pela ${COMPANY.name}.${
        data.changes?.length ? ' Veja o que mudou:' : ` ${esc(data.reason)}`
      }</p>
${changesTable(data.changes ?? [])}
${
  data.hadSigned
    ? `<div class="alert"><strong>A assinatura que você já havia registrado foi invalidada.</strong>
       É a conduta correta: ninguém deve ficar vinculado a um documento diferente daquele que leu e aceitou.</div>`
    : ''
}
<p>Uma nova versão será enviada para sua revisão, com um novo link. O link anterior não vale mais.</p>
<p class="muted">Nenhuma providência é necessária da sua parte neste momento.</p>`,
    }),
  };
}
