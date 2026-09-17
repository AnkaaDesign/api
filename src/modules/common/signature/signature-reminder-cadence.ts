// api/src/modules/common/signature/signature-reminder-cadence.ts
//
// QUANDO o lembrete de assinatura pendente sai. Funções PURAS, sem Prisma e sem
// relógio implícito — o `now` é sempre parâmetro.
//
// POR QUE ESTÁ FORA DO SERVIÇO
//   É a única lógica de toda a feature que o `tsc` não consegue conferir de
//   forma alguma: errar aqui não quebra tipo nenhum, produz uma cadência
//   silenciosamente errada, e o sintoma aparece semanas depois na conversa de um
//   cliente ("por que vocês me mandaram isso cinco dias seguidos?"). Separada,
//   ela tem teste — `npm run test:signature-reminders`.

/** A REGRA, escrita uma vez. Decisão dele, 11/09/2026. */
export const REMINDER_BUSINESS_DAY_BURST = 3;
export const REMINDER_INTERVAL_DAYS = 5;

/**
 * Data no calendário de São Paulo, como `YYYY-MM-DD`.
 *
 * A cadência é contada em DIAS CIVIS, não em janelas de 24 h: um lembrete às
 * 23h30 e outro às 00h10 são dois dias para quem recebe e quarenta minutos para
 * um `Date`. É a leitura de quem recebe que vale.
 */
export function spDay(date: Date): string {
  return date.toLocaleString('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** Dias civis inteiros de `from` até `to`, no calendário de São Paulo. */
export function spDayDiff(from: Date, to: Date): number {
  const [fy, fm, fd] = spDay(from).split('-').map(Number);
  const [ty, tm, td] = spDay(to).split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * Segunda a sexta no calendário de São Paulo.
 *
 * FERIADO NÃO É TRATADO, e é escolha. A tabela de feriados nacionais, estaduais
 * e municipais teria de ser mantida à mão para evitar que um lembrete caísse num
 * feriado — sendo que ele apenas cairia, seria lido no dia seguinte, e o custo
 * de errar é zero. Sábado e domingo ficam de fora porque são 2 dias em 7, não
 * por delicadeza.
 */
export function isBusinessDaySP(date: Date): boolean {
  const weekday = date.toLocaleString('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
  });
  return weekday !== 'Sat' && weekday !== 'Sun';
}

export interface ReminderState {
  /** Último lembrete enviado, ou `null` se ainda não houve nenhum. */
  lastReminderAt: Date | null;
  /** Quantos já saíram para este signatário. */
  reminderCount: number;
  /** Emissão do envelope — é quando o convite saiu. Âncora do primeiro lembrete. */
  invitedAt: Date;
}

/**
 * A CADÊNCIA: os 3 primeiros dias úteis depois do convite, e depois de 5 em 5
 * dias.
 *
 * POR QUE NÃO TODO DIA, que foi o pedido inicial
 *   Validade padrão são 30 dias. "Todo dia" são 29 mensagens para quem não
 *   assina — e a Meta mede qualidade POR TEMPLATE a partir de bloqueio e
 *   denúncia de quem recebe. Um template pausado por qualidade some sem aviso, e
 *   o que dói não é perder o lembrete: é o CONVITE, que sai do mesmo número,
 *   perder alcance junto. Esta cadência entrega ~8 mensagens no mesmo período,
 *   concentradas onde a decisão acontece.
 *
 * ANCORADA NO ÚLTIMO ENVIO, nunca numa contagem de dias desde a emissão. Se a
 * API passar a quinta-feira fora do ar, a rodada de sexta manda UM lembrete, e
 * não dois para compensar.
 */
export function isReminderDue(state: ReminderState, now: Date): boolean {
  if (!isBusinessDaySP(now)) return false;

  const anchor = state.lastReminderAt ?? state.invitedAt;
  const daysSinceAnchor = spDayDiff(anchor, now);

  // Mesmo dia civil do convite ou do último lembrete: nunca. É o que impede o
  // convite e o primeiro lembrete de chegarem com minutos de diferença.
  if (daysSinceAnchor < 1) return false;

  // Os três primeiros: um por dia útil.
  if (state.reminderCount < REMINDER_BUSINESS_DAY_BURST) return true;

  // Depois: de 5 em 5 dias, e sempre num dia útil (a guarda do topo). Cair num
  // sábado empurra para segunda, e a próxima âncora passa a ser ela — a cadência
  // se acomoda em torno da semana em vez de derrapar.
  return daysSinceAnchor >= REMINDER_INTERVAL_DAYS;
}

/**
 * QUANDO o lado do cliente terminou — a âncora da cobrança da contra-assinatura.
 *
 * A cadência do grupo 1 não pode ser ancorada na EMISSÃO como a do cliente: numa
 * coleta que levou doze dias para o cliente fechar, o primeiro lembrete interno
 * nasceria "atrasado em doze dias" e três cobranças sairiam de enfiada no mesmo
 * dia em que o aviso acabou de ser enviado. O relógio da nossa caneta começa a
 * correr quando a bola passa para o nosso lado, e não antes.
 *
 * Devolve `null` enquanto houver QUALQUER responsável do cliente sem assinar —
 * aí não há o que contra-assinar, e cobrar seria pedir um ato que a própria
 * ordem sequencial do envelope recusaria (`assertSignable`).
 *
 * Função pura, aqui e não no serviço, pelo mesmo motivo do resto do arquivo:
 * errar isto não quebra tipo nenhum e o sintoma aparece semanas depois, numa
 * conversa.
 */
export function customerSideCompletedAt(
  signers: ReadonlyArray<{ orderGroup: number; status: string; signedAt: Date | null }>,
): Date | null {
  const customers = signers.filter(s => s.orderGroup === 0);
  if (customers.length === 0) return null;
  let latest: Date | null = null;
  for (const signer of customers) {
    if (signer.status !== 'SIGNED' || !signer.signedAt) return null;
    if (!latest || signer.signedAt.getTime() > latest.getTime()) latest = signer.signedAt;
  }
  return latest;
}
