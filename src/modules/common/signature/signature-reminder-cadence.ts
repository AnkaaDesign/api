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

/**
 * A REGRA DO CLIENTE, escrita uma vez. Decisão dele, 17/09/2026.
 *
 * Quatro toques, e só quatro: um logo depois do convite, outro dois dias depois
 * daquele, e os dois últimos colados no VENCIMENTO — cinco dias antes e um dia
 * antes. Substitui a cadência de 11/09 (três dias úteis em rajada, depois de 5
 * em 5), que tinha duas propriedades ruins: entregava ~8 mensagens num
 * orçamento de 30 dias, e não sabia onde ficava o prazo — num orçamento de
 * validade curta ela cobrava no começo e calava justamente na semana em que a
 * decisão acontece.
 */
export const CUSTOMER_REMINDER_PLAN = {
  /** 1º lembrete: dias civis depois do CONVITE. */
  AFTER_INVITE: 1,
  /** 2º lembrete: dias civis depois do 1º lembrete REALIZADO (não do convite). */
  AFTER_FIRST_REMINDER: 2,
  /** 3º lembrete: dias civis ANTES do vencimento. */
  BEFORE_DEADLINE_EARLY: 5,
  /** 4º e último: dias civis ANTES do vencimento. */
  BEFORE_DEADLINE_LAST: 1,
} as const;

/** A cadência INTERNA (contra-assinatura da Ankaa) — inalterada desde 11/09. */
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
 * A CADÊNCIA INTERNA — cobrança da NOSSA caneta (grupo 1).
 *
 * Os 3 primeiros dias úteis depois que o cliente fechou, e depois de 5 em 5.
 * Continua ancorada no último envio porque quem recebe é gente de casa: não há
 * template da Meta a proteger, não há prazo do lado de fora para mirar, e o que
 * se quer é insistência decrescente até alguém assinar. O lado do CLIENTE não
 * usa mais isto — ver `dueCustomerReminder`.
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
export function isInternalReminderDue(state: ReminderState, now: Date): boolean {
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

// ── A CADÊNCIA DO CLIENTE ────────────────────────────────────────────────────

/**
 * O dia civil de São Paulo como uma data à meia-noite UTC.
 *
 * Toda a aritmética abaixo é de CALENDÁRIO — "cinco dias antes do vencimento" é
 * uma conta de dias, não de 120 horas. Reduzir cada instante ao seu dia civil
 * antes de somar é o que impede que um convite das 23h e um vencimento das 8h
 * produzam um lembrete de meio dia de diferença do pretendido.
 */
function civilDay(date: Date): Date {
  const [y, m, d] = spDay(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Rótulo `YYYY-MM-DD` de uma data CIVIL (as que `customerReminderSchedule`
 * devolve).
 *
 * NÃO use `spDay` para isto: uma data civil é meia-noite UTC, e meia-noite UTC
 * em São Paulo ainda é 21h do dia ANTERIOR. `spDay` a converteria de volta ao
 * fuso e devolveria o dia errado — o mesmo erro de três horas contra o qual o
 * cabeçalho do teste avisa, só que no sentido inverso.
 */
export function civilDayKey(civil: Date): string {
  return civil.toISOString().slice(0, 10);
}

function addDays(civil: Date, days: number): Date {
  return new Date(civil.getTime() + days * 86_400_000);
}

/** Dia útil? Em datas civis (meia-noite UTC), `getUTCDay` é o dia da semana em SP. */
function isBusinessCivil(civil: Date): boolean {
  const weekday = civil.getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

function nextBusiness(civil: Date): Date {
  let day = civil;
  while (!isBusinessCivil(day)) day = addDays(day, 1);
  return day;
}

function previousBusiness(civil: Date): Date {
  let day = civil;
  while (!isBusinessCivil(day)) day = addDays(day, -1);
  return day;
}

/**
 * OS DIAS em que o cliente será cobrado, do convite ao vencimento.
 *
 * O CALENDÁRIO INTEIRO É CALCULADO DE UMA VEZ, e não um passo por vez como fazia
 * a cadência antiga. É o que permite as duas coisas que o plano novo exige e a
 * anterior não sabia fazer: mirar o VENCIMENTO (que só se conhece olhando os
 * dois extremos ao mesmo tempo) e garantir que os quatro toques caiam em quatro
 * dias distintos, mesmo numa validade curta em que eles se atropelariam.
 *
 * FIM DE SEMANA, E POR QUE OS DOIS LADOS DESVIAM PARA LADOS OPOSTOS
 *   Os dois primeiros lembretes são ancorados no CONVITE e empurram para a
 *   frente: atrasar um toque de abertura não custa nada. Os dois últimos são
 *   ancorados no VENCIMENTO e puxam para TRÁS: empurrar "um dia antes de vencer"
 *   para a segunda-feira seguinte é entregá-lo depois do vencimento, que é a
 *   única forma de errar que não tem conserto. Antes é cedo demais; depois é
 *   inútil.
 *
 * SEM COLISÃO E SEM RETROCESSO: cada dia escolhido é estritamente posterior ao
 * anterior. Em validade curta os toques do fim comem os do começo — e é a ordem
 * certa de perder: quem recebe um lembrete de "vence em 5 dias" está mais perto
 * de decidir do que quem recebe o segundo "acabou de sair".
 */
export function customerReminderSchedule(invitedAt: Date, deadlineAt: Date): Date[] {
  const invite = civilDay(invitedAt);
  const deadline = civilDay(deadlineAt);
  const days: Date[] = [];

  /** Nunca no dia do convite, nunca no dia do vencimento (ou depois). */
  const fits = (day: Date): boolean =>
    day.getTime() > invite.getTime() &&
    day.getTime() < deadline.getTime() &&
    (days.length === 0 || day.getTime() > days[days.length - 1].getTime());

  const forward = (target: Date): void => {
    let day = nextBusiness(target);
    // Colidiu com o lembrete anterior (um convite de sexta joga o 1º para
    // segunda): anda mais um dia útil em vez de virar duplicata descartada.
    while (days.length > 0 && day.getTime() <= days[days.length - 1].getTime()) {
      day = nextBusiness(addDays(day, 1));
    }
    if (fits(day)) days.push(day);
  };

  const backward = (target: Date): void => {
    const day = previousBusiness(target);
    // Aqui não se anda para a frente para escapar de colisão: o alvo é o
    // vencimento, e adiar é o erro que não se conserta. Colidiu, some.
    if (fits(day)) days.push(day);
  };

  forward(addDays(invite, CUSTOMER_REMINDER_PLAN.AFTER_INVITE));
  // "Dois dias depois do SEGUNDO envio" conta do dia em que o 1º lembrete
  // realmente saiu, não do convite: se ele escorregou para segunda, o 2º é
  // quarta. Sem o 1º (validade curtíssima), cai de volta na emissão.
  const firstReminder = days[0];
  forward(
    firstReminder
      ? addDays(firstReminder, CUSTOMER_REMINDER_PLAN.AFTER_FIRST_REMINDER)
      : addDays(invite, CUSTOMER_REMINDER_PLAN.AFTER_INVITE + CUSTOMER_REMINDER_PLAN.AFTER_FIRST_REMINDER),
  );
  backward(addDays(deadline, -CUSTOMER_REMINDER_PLAN.BEFORE_DEADLINE_EARLY));
  backward(addDays(deadline, -CUSTOMER_REMINDER_PLAN.BEFORE_DEADLINE_LAST));

  return days;
}

export interface CustomerReminderState extends ReminderState {
  /** Vencimento do envelope. É a âncora dos dois últimos toques. */
  deadlineAt: Date;
}

export interface DueCustomerReminder {
  /** Índice do toque no calendário — 0 é o primeiro. */
  index: number;
  /** O dia em que ele estava previsto (pode ser anterior a hoje, se houve queda). */
  scheduledFor: Date;
  /** Quantos toques o calendário tem ao todo. Vai para a trilha: "2 de 4". */
  total: number;
}

/**
 * O toque que está na hora, ou `null`.
 *
 * DEVOLVE O ÍNDICE, e não um booleano, porque quem chama precisa GRAVAR em que
 * ponto do calendário parou: com o vencimento na conta, `reminderCount` deixou
 * de ser "quantos saíram" e passou a ser "até onde o calendário foi consumido".
 * São coisas diferentes no dia em que a API passa dois dias fora do ar.
 *
 * NÃO SE COBRA O ATRASO ACUMULADO. Se dois toques venceram durante uma queda,
 * sai o MAIS RECENTE e o outro é dado por perdido — nunca os dois no mesmo dia.
 * O lembrete atrasado de "vence em 5 dias", entregue no dia em que faltam 2, não
 * é uma mensagem tardia: é uma mensagem FALSA, e ainda por cima empurra a
 * verdadeira para depois do prazo.
 */
export function dueCustomerReminder(
  state: CustomerReminderState,
  now: Date,
): DueCustomerReminder | null {
  // Sábado e domingo continuam de fora, como na cadência antiga: o calendário só
  // produz dias úteis, e esta guarda cobre a rodada que acorda no fim de semana
  // para recuperar um dia perdido.
  if (!isBusinessDaySP(now)) return null;

  const schedule = customerReminderSchedule(state.invitedAt, state.deadlineAt);
  if (state.reminderCount >= schedule.length) return null;

  // Duas mensagens no mesmo dia civil, nunca — nem que o calendário tenha sido
  // recalculado no meio do caminho por uma mudança de prazo.
  if (state.lastReminderAt && spDayDiff(state.lastReminderAt, now) < 1) return null;

  const today = civilDay(now);
  let index = -1;
  for (let i = state.reminderCount; i < schedule.length; i++) {
    if (schedule[i].getTime() <= today.getTime()) index = i;
  }
  if (index < 0) return null;

  return { index, scheduledFor: schedule[index], total: schedule.length };
}
