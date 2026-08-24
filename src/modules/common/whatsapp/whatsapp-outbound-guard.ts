// api/src/modules/common/whatsapp/whatsapp-outbound-guard.ts
//
// Guarda de saída do WhatsApp — o que separa "a Ankaa usando WhatsApp" de "um
// robô disparando link".
//
// POR QUE ESTE ARQUIVO EXISTE
//   O número anterior foi banido e o atual passou por um reach-out time-lock. Em
//   nenhum dos dois casos o conteúdo era ilegítimo: eram convites de assinatura
//   e avisos para clientes reais. O que a plataforma pune é o PADRÃO — muitas
//   conversas NOVAS abertas em rajada, sempre com link, sempre no mesmo segundo,
//   sem nenhum sinal de que existe um humano do outro lado. Este arquivo remove
//   esse padrão sem mentir sobre nada: as mensagens continuam as mesmas, o que
//   muda é o ritmo, o teto e a decisão de não insistir quando o servidor já
//   disse não.
//
// AS CINCO REGRAS, E POR QUE CADA UMA
//   1. FILA SERIALIZADA COM INTERVALO ALEATÓRIO. Duas mensagens no mesmo tick é
//      assinatura de automação; o intervalo fixo também é (um humano não manda
//      exatamente a cada 10,000 s). Depois de um período ocioso o intervalo é
//      ZERO, porque também é o que um humano faz: responde na hora quando não
//      estava mandando nada.
//   2. TETO SEPARADO PARA CONTATO FRIO. Abrir conversa com quem nunca falou com
//      o número é a ação cara — é exatamente ela que o time-lock restringe.
//      Mensagem para quem já respondeu não consome esse teto.
//   3. DISJUNTOR. Ao tomar um nack 463 o sistema PARA de tentar contato frio, em
//      vez de repetir a ação que gerou a restrição. Persistido no Redis: uma
//      trava de 12 h não pode ser esquecida porque a API reiniciou.
//   4. NADA DE REPETIR A MESMA MENSAGEM. Mesmo corpo para o mesmo número dentro
//      da janela = a definição operacional de flood, e o retry automático já
//      produziu isso antes.
//   5. CONTATO FRIO SÓ EM HORÁRIO COMERCIAL. Link de cobrança às 3 da manhã é o
//      que faz o destinatário DENUNCIAR — e denúncia é o que de fato bane.
//
// O QUE ESTE ARQUIVO NÃO FAZ
//   Não esconde nada da plataforma, não falsifica identidade de dispositivo, não
//   burla limite nenhum. Ele só nos faz caber, de verdade, dentro do uso que o
//   canal comporta. Quando o volume passar disso, a resposta certa é a API
//   oficial do WhatsApp Business, não um truque aqui.

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { CacheService } from '../cache/cache.service';

/**
 * CRITICAL é o código de uso único da assinatura: o cliente está com a tela
 * aberta esperando. Ele nunca é primeiro contato do ponto de vista do
 * destinatário — foi ELE quem pediu, tocando no link. Por isso anda na frente da
 * fila, com intervalo curto, não consome o teto de contato frio e responde a um
 * teto por destinatário próprio (`PER_RECIPIENT_PER_DAY_CRITICAL`).
 */
export type OutboundPriority = 'CRITICAL' | 'NORMAL';

export interface OutboundVerdict {
  allowed: boolean;
  /** Primeiro contato com este número (ninguém nunca respondeu de lá). */
  cold: boolean;
  /** Motivo em português, pronto para virar mensagem de operador. */
  reason?: string;
  /** Estável, para log e para a tela: BREAKER_COLD, COLD_DAILY_CAP, ... */
  code?: string;
}

export interface OutboundBreakerState {
  open: boolean;
  /** COLD = só bloqueia primeiro contato; ALL = bloqueia tudo. */
  scope: 'COLD' | 'ALL';
  until: string;
  reason: string;
}

/**
 * Tetos. Os de contato frio são política de negócio, não limite técnico.
 *
 * OS DOIS GRUPOS NÃO CARREGAM O MESMO RISCO, e é por isso que subiram em
 * proporções diferentes. O que a plataforma pune — e o que derrubou o número
 * anterior — é abrir CONVERSA NOVA em rajada; os tetos `COLD_*` são os que
 * governam isso, então sobem pouco e com relutância. Já o teto por
 * destinatário conta mensagens numa conversa que JÁ existe, que não consome
 * cota de `INDIVIDUAL_NEW_CHAT_MSG` nenhuma: subir esse é quase de graça.
 */
const COLD_PER_HOUR = 6;
const COLD_PER_DAY = 25;
/** Rede de segurança contra um lote acidental; não é um alvo. */
const GLOBAL_PER_DAY = 300;
const PER_RECIPIENT_PER_DAY = 12;

/**
 * Teto do CRITICAL no MESMO contador por destinatário.
 *
 * Existe porque o teto comum travava a cerimônia. `PER_RECIPIENT_PER_DAY` é
 * uma medida contra INSISTÊNCIA — mandar mais uma para quem não respondeu — e
 * o código de uso único é o oposto disso: o destinatário pediu, agora, com a
 * tela aberta. Um signatário que já tinha recebido convite, lembrete e avisos
 * chegava ao botão "Enviar código" e batia num teto que não foi feito para
 * ele; a assinatura ficava impossível de concluir até o dia virar, e a tela
 * ainda mandava tentar de novo em instantes.
 *
 * É a mesma leitura que já vale para o disjuntor logo abaixo: o 463 abre o
 * disjuntor de contato FRIO e não o de tudo, justamente para não deixar o
 * cliente preso no meio da cerimônia por um limite que não se aplica a ele.
 *
 * Não é isenção: continua havendo parede, e ela vale para o total do dia
 * daquele número (convites, lembretes e códigos somados). O que impede
 * enxurrada de OTP não é este teto — é o intervalo de 60 s entre reenvios e o
 * bloqueio em cinco tentativas, na própria cerimônia, mais a deduplicação de
 * corpo idêntico aqui do lado.
 */
const PER_RECIPIENT_PER_DAY_CRITICAL = 20;

/** Janela em que o mesmo corpo para o mesmo número é recusado. */
const IDENTICAL_BODY_TTL_SECONDS = 6 * 60 * 60;

/** Um contato "esquenta" ao responder e esfria de novo em 45 dias sem contato. */
const WARM_TTL_SECONDS = 45 * 24 * 60 * 60;

/** Resolução de JID: evita reconsultar `onWhatsApp` para o mesmo número. */
const JID_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Intervalo entre envios consecutivos, em ms: [mínimo, máximo]. */
const GAP_MS: Record<'CRITICAL' | 'WARM' | 'COLD', [number, number]> = {
  CRITICAL: [2000, 4500],
  WARM: [5000, 11000],
  COLD: [11000, 23000],
};

/**
 * Depois deste tempo sem enviar nada, o próximo envio sai sem espera.
 *
 * Sem isto, o convite de um orçamento único — o caso mais comum — pagaria 20 s
 * de atraso por uma proteção que só faz sentido contra rajada.
 */
const IDLE_RESET_MS = 3 * 60 * 1000;

/** Janela em que o primeiro contato é aceitável, em horário de São Paulo. */
const COLD_WINDOW = { startHour: 8, endHour: 20, days: [1, 2, 3, 4, 5, 6] };

/** Disjuntor: quanto tempo cada gatilho segura. */
const BREAKER_463_MS = 12 * 60 * 60 * 1000;
const BREAKER_STREAK_MS = 60 * 60 * 1000;
const REJECTION_STREAK_THRESHOLD = 3;
const REJECTION_STREAK_WINDOW_MS = 10 * 60 * 1000;

const NACK_REACHOUT_TIMELOCKED = '463';

const SP_TIMEZONE = 'America/Sao_Paulo';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween([min, max]: [number, number]): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Partes da data/hora em São Paulo.
 *
 * O processo da API roda em UTC (o service unit não força TZ), então derivar o
 * balde do dia de `new Date().getDate()` faria o teto diário virar às 21 h — e
 * a janela de horário comercial cobriria a madrugada de verdade.
 */
function spParts(now: Date): { day: string; hour: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: SP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    day: `${parts.year}${parts.month}${parts.day}`,
    // `hour12: false` devolve "24" à meia-noite em algumas engines.
    hour: parseInt(parts.hour, 10) % 24,
    weekday: weekdayMap[parts.weekday as string] ?? 0,
  };
}

@Injectable()
export class WhatsAppOutboundGuard {
  private readonly logger = new Logger(WhatsAppOutboundGuard.name);

  private readonly PREFIX = 'whatsapp:guard:';

  /** Fila serializada: um envio por vez, em ordem de chegada. */
  private chain: Promise<unknown> = Promise.resolve();
  private lastSendAt = 0;

  /** Rejeições recentes, para o gatilho de sequência do disjuntor. */
  private recentRejections: number[] = [];

  constructor(private readonly cache: CacheService) {}

  // ==========================================================================
  // RITMO
  // ==========================================================================

  /**
   * Executa `fn` na fila, respeitando o intervalo mínimo desde o envio anterior.
   *
   * A cadeia é reencadeada mesmo em caso de erro (`then(run, run)`): um envio que
   * lança não pode travar a fila para sempre.
   */
  async paced<T>(kind: 'CRITICAL' | 'WARM' | 'COLD', fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const idle = Date.now() - this.lastSendAt;
      if (idle < IDLE_RESET_MS) {
        const gap = randomBetween(GAP_MS[kind]);
        const wait = Math.max(0, gap - idle);
        if (wait > 0) {
          this.logger.debug(`Aguardando ${wait} ms antes do próximo envio (${kind}).`);
          await sleep(wait);
        }
      }
      try {
        return await fn();
      } finally {
        this.lastSendAt = Date.now();
      }
    };

    const result = this.chain.then(run, run) as Promise<T>;
    this.chain = result.catch(() => undefined);
    return result;
  }

  /**
   * Quanto tempo "digitando" antes de enviar.
   *
   * Proporcional ao tamanho do texto e com teto: é o sinal de presença que o
   * cliente oficial emite e um script normalmente não. Também dá ao destinatário
   * o meio segundo de contexto que separa "alguém está falando comigo" de
   * "chegou um bloco de texto do nada".
   */
  typingMs(text: string): number {
    const chars = (text ?? '').length;
    return Math.min(6000, 900 + chars * 22);
  }

  // ==========================================================================
  // QUENTE x FRIO
  // ==========================================================================

  private warmKey(phone: string): string {
    return `${this.PREFIX}warm:${phone}`;
  }

  private openedKey(phone: string): string {
    return `${this.PREFIX}opened:${phone}`;
  }

  /** Alguém respondeu deste número: ele deixa de ser primeiro contato. */
  async markInbound(phone: string): Promise<void> {
    if (!phone) return;
    try {
      await this.cache.set(this.warmKey(phone), new Date().toISOString(), WARM_TTL_SECONDS);
    } catch (error) {
      this.logger.error(`Falha ao marcar contato quente: ${error.message}`);
    }
  }

  /**
   * Já EXISTE conversa com este número — respondida ou apenas aberta por nós.
   *
   * A distinção entre as duas some de propósito, e a razão é o que o WhatsApp de
   * fato mede: a restrição de reach-out e a cota de `INDIVIDUAL_NEW_CHAT_MSG`
   * contam CONVERSAS NOVAS, não mensagens. A segunda mensagem para alguém que já
   * recebeu a primeira não abre conversa nenhuma.
   *
   * Contar as duas como "frio" fazia UMA cerimônia de assinatura — convite,
   * código de uso único, eventual aviso de anulação — consumir três das vinte
   * vagas diárias de primeiro contato de um único cliente, e pagar o intervalo
   * longo (11–23 s) em cada uma delas. O teto passava a limitar cinco clientes
   * por dia em vez de vinte, e o operador esperava por isso.
   *
   * O que protege contra insistência em quem nunca respondeu continua de pé: o
   * teto POR DESTINATÁRIO (6/dia), a deduplicação de corpo idêntico e o
   * disjuntor.
   */
  async hasOpenConversation(phone: string): Promise<boolean> {
    try {
      const [warm, opened] = await Promise.all([
        this.cache.exists(this.warmKey(phone)),
        this.cache.exists(this.openedKey(phone)),
      ]);
      return warm || opened;
    } catch {
      // Falha de cache não pode transformar contato conhecido em frio e barrar
      // um envio legítimo — mas também não pode liberar o teto. Trata como FRIO:
      // o caminho conservador é o que protege a conta.
      return false;
    }
  }

  // ==========================================================================
  // DISJUNTOR
  // ==========================================================================

  private get breakerKey(): string {
    return `${this.PREFIX}breaker`;
  }

  async breakerState(): Promise<OutboundBreakerState | null> {
    try {
      const state = await this.cache.getObject<OutboundBreakerState>(this.breakerKey);
      if (!state) return null;
      if (new Date(state.until).getTime() <= Date.now()) return null;
      return state;
    } catch {
      return null;
    }
  }

  private async openBreaker(
    scope: 'COLD' | 'ALL',
    durationMs: number,
    reason: string,
  ): Promise<void> {
    const until = new Date(Date.now() + durationMs);
    const state: OutboundBreakerState = {
      open: true,
      scope,
      until: until.toISOString(),
      reason,
    };
    try {
      await this.cache.setObject(this.breakerKey, state, Math.ceil(durationMs / 1000));
    } catch (error) {
      this.logger.error(`Falha ao gravar o disjuntor: ${error.message}`);
    }
    this.logger.error(
      `🔌 Disjuntor de saída ABERTO (${scope}) até ${until.toISOString()} — ${reason}`,
    );
  }

  async clearBreaker(): Promise<void> {
    await this.cache.del(this.breakerKey);
    this.recentRejections = [];
    this.logger.warn('Disjuntor de saída rearmado manualmente.');
  }

  /**
   * Registra o veredito do servidor.
   *
   * O 463 abre o disjuntor de contato FRIO e não o de tudo: a trava de reach-out
   * restringe INICIAR conversa, e derrubar junto o código de uso único deixaria
   * o cliente preso no meio da cerimônia por causa de um limite que não se aplica
   * a ele. Já uma sequência de rejeições de qualquer natureza é sinal de que algo
   * está errado com a conta ou com a sessão, e aí para tudo.
   */
  async noteRejection(errorCode: string | undefined, until?: Date | null): Promise<void> {
    const now = Date.now();
    this.recentRejections = this.recentRejections.filter(
      t => now - t < REJECTION_STREAK_WINDOW_MS,
    );
    this.recentRejections.push(now);

    if (errorCode === NACK_REACHOUT_TIMELOCKED) {
      const durationMs =
        until && until.getTime() > now
          ? Math.min(until.getTime() - now, 7 * 24 * 60 * 60 * 1000)
          : BREAKER_463_MS;
      await this.openBreaker(
        'COLD',
        durationMs,
        'WhatsApp recusou um primeiro contato (nack 463 — reach-out time-lock). ' +
          'Insistir agrava a restrição; use e-mail ou peça ao cliente que mande uma ' +
          'mensagem para o número da Ankaa.',
      );
      return;
    }

    if (this.recentRejections.length >= REJECTION_STREAK_THRESHOLD) {
      await this.openBreaker(
        'ALL',
        BREAKER_STREAK_MS,
        `${this.recentRejections.length} mensagens recusadas em menos de ` +
          `${Math.round(REJECTION_STREAK_WINDOW_MS / 60000)} minutos.`,
      );
    }
  }

  noteAccepted(): void {
    this.recentRejections = [];
  }

  // ==========================================================================
  // TETOS
  // ==========================================================================

  private async counter(key: string, ttlSeconds: number): Promise<number> {
    const value = await this.cache.incr(key);
    if (value === 1) await this.cache.expire(key, ttlSeconds);
    return value;
  }

  private async peek(key: string): Promise<number> {
    const raw = await this.cache.get<string | number>(key);
    const value = typeof raw === 'number' ? raw : parseInt(String(raw ?? '0'), 10);
    return Number.isFinite(value) ? value : 0;
  }

  private bodyKey(phone: string, message: string): string {
    const digest = createHash('sha1').update(message ?? '').digest('hex').slice(0, 16);
    return `${this.PREFIX}body:${phone}:${digest}`;
  }

  /**
   * Decide ANTES de escrever qualquer coisa no socket.
   *
   * Só lê contadores; quem os incrementa é `recordSent`, depois do ack. Contar
   * na intenção faria uma sessão caída consumir o teto do dia inteiro sem uma
   * única mensagem entregue.
   */
  async evaluate(args: {
    phone: string;
    message: string;
    priority: OutboundPriority;
    /** Extrato do servidor, quando conhecido — ver `WhatsAppAccountStanding`. */
    reachoutActive?: boolean;
  }): Promise<OutboundVerdict> {
    const { phone, message, priority } = args;
    const cold = !(await this.hasOpenConversation(phone)) && priority !== 'CRITICAL';

    const breaker = await this.breakerState();
    if (breaker && (breaker.scope === 'ALL' || cold)) {
      return {
        allowed: false,
        cold,
        code: breaker.scope === 'ALL' ? 'BREAKER_ALL' : 'BREAKER_COLD',
        reason:
          `Envio suspenso até ${new Date(breaker.until).toLocaleString('pt-BR', {
            timeZone: SP_TIMEZONE,
          })}: ${breaker.reason}`,
      };
    }

    if (cold && args.reachoutActive) {
      return {
        allowed: false,
        cold,
        code: 'REACHOUT_TIMELOCK',
        reason:
          'A conta está sob trava de primeiro contato do WhatsApp. Mensagens para quem ' +
          'nunca conversou com este número seriam recusadas. Use e-mail nesta coleta.',
      };
    }

    // Mesmo corpo, mesmo número, janela curta: é flood, e o retry automático já
    // produziu isso. Vale inclusive para CRITICAL — dois OTPs idênticos seriam
    // dois códigos diferentes, então corpos idênticos ali significam repetição.
    const duplicate = await this.cache
      .exists(this.bodyKey(phone, message))
      // Cache fora do ar não pode barrar um OTP legítimo: a fila e o disjuntor
      // continuam valendo, e o que se perde é a deduplicação, não o ritmo.
      .catch(() => false);
    if (duplicate) {
      return {
        allowed: false,
        cold,
        code: 'DUPLICATE_BODY',
        reason: 'Esta mesma mensagem já foi enviada para este número nas últimas horas.',
      };
    }

    const { day, hour, weekday } = spParts(new Date());

    const recipientCap =
      priority === 'CRITICAL' ? PER_RECIPIENT_PER_DAY_CRITICAL : PER_RECIPIENT_PER_DAY;
    if (await this.overCap(`${this.PREFIX}to:${phone}:${day}`, recipientCap)) {
      return {
        allowed: false,
        cold,
        code: 'RECIPIENT_DAILY_CAP',
        reason: `Este número já recebeu ${recipientCap} mensagens hoje.`,
      };
    }

    if (await this.overCap(`${this.PREFIX}all:${day}`, GLOBAL_PER_DAY)) {
      return {
        allowed: false,
        cold,
        code: 'GLOBAL_DAILY_CAP',
        reason: `Teto diário de ${GLOBAL_PER_DAY} mensagens atingido.`,
      };
    }

    if (cold) {
      if (!COLD_WINDOW.days.includes(weekday) || hour < COLD_WINDOW.startHour || hour >= COLD_WINDOW.endHour) {
        return {
          allowed: false,
          cold,
          code: 'COLD_OUTSIDE_WINDOW',
          reason:
            `Primeiro contato por WhatsApp só entre ${COLD_WINDOW.startHour}h e ` +
            `${COLD_WINDOW.endHour}h, de segunda a sábado. Mensagem fria fora de hora é o ` +
            'que gera denúncia — e denúncia é o que bane o número.',
        };
      }
      if (await this.overCap(`${this.PREFIX}cold:h:${day}${String(hour).padStart(2, '0')}`, COLD_PER_HOUR)) {
        return {
          allowed: false,
          cold,
          code: 'COLD_HOURLY_CAP',
          reason: `Teto de ${COLD_PER_HOUR} primeiros contatos por hora atingido. Tente na próxima hora.`,
        };
      }
      if (await this.overCap(`${this.PREFIX}cold:d:${day}`, COLD_PER_DAY)) {
        return {
          allowed: false,
          cold,
          code: 'COLD_DAILY_CAP',
          reason: `Teto de ${COLD_PER_DAY} primeiros contatos por dia atingido.`,
        };
      }
    }

    return { allowed: true, cold };
  }

  private async overCap(key: string, cap: number): Promise<boolean> {
    try {
      return (await this.peek(key)) >= cap;
    } catch {
      // Cache fora do ar não pode barrar o OTP de um cliente. Falha ABERTA aqui
      // é aceitável porque o disjuntor e a fila continuam valendo — o que se
      // perde é a contagem, não o ritmo.
      return false;
    }
  }

  /**
   * Contabiliza um envio que o SERVIDOR aceitou.
   *
   * Marca também a conversa como ABERTA: a partir daqui as mensagens seguintes
   * para este número não abrem conversa nova e não consomem o teto de primeiro
   * contato. Ver `hasOpenConversation`.
   */
  async recordSent(phone: string, message: string, cold: boolean): Promise<void> {
    const { day, hour } = spParts(new Date());
    const hourBucket = `${day}${String(hour).padStart(2, '0')}`;
    try {
      await Promise.all([
        this.cache.set(this.openedKey(phone), new Date().toISOString(), WARM_TTL_SECONDS),
        this.counter(`${this.PREFIX}all:${day}`, 26 * 60 * 60),
        this.counter(`${this.PREFIX}to:${phone}:${day}`, 26 * 60 * 60),
        this.cache.set(this.bodyKey(phone, message), '1', IDENTICAL_BODY_TTL_SECONDS),
        ...(cold
          ? [
              this.counter(`${this.PREFIX}cold:d:${day}`, 26 * 60 * 60),
              this.counter(`${this.PREFIX}cold:h:${hourBucket}`, 2 * 60 * 60),
            ]
          : []),
      ]);
    } catch (error) {
      this.logger.error(`Falha ao contabilizar envio: ${error.message}`);
    }
  }

  /** Números do dia, para a tela de administração. */
  async usage(): Promise<{
    day: string;
    coldToday: number;
    coldThisHour: number;
    totalToday: number;
    caps: {
      coldPerHour: number;
      coldPerDay: number;
      globalPerDay: number;
      perRecipientPerDay: number;
      perRecipientPerDayCritical: number;
    };
    breaker: OutboundBreakerState | null;
  }> {
    const { day, hour } = spParts(new Date());
    const hourBucket = `${day}${String(hour).padStart(2, '0')}`;
    return {
      day,
      coldToday: await this.peek(`${this.PREFIX}cold:d:${day}`),
      coldThisHour: await this.peek(`${this.PREFIX}cold:h:${hourBucket}`),
      totalToday: await this.peek(`${this.PREFIX}all:${day}`),
      caps: {
        coldPerHour: COLD_PER_HOUR,
        coldPerDay: COLD_PER_DAY,
        globalPerDay: GLOBAL_PER_DAY,
        perRecipientPerDay: PER_RECIPIENT_PER_DAY,
        perRecipientPerDayCritical: PER_RECIPIENT_PER_DAY_CRITICAL,
      },
      breaker: await this.breakerState(),
    };
  }

  // ==========================================================================
  // CACHE DE JID
  // ==========================================================================

  /**
   * `onWhatsApp()` é uma consulta de EXISTÊNCIA de número. Repeti-la a cada envio
   * — inclusive para os mesmos contatos, todo dia — é o padrão de quem está
   * varrendo lista de telefones, que é justamente o que a plataforma procura.
   * O JID de um número não muda; guardar por 30 dias elimina a consulta sem
   * perder nada.
   */
  async cachedJid(phone: string): Promise<string | null> {
    try {
      return await this.cache.get<string>(`${this.PREFIX}jid:${phone}`);
    } catch {
      return null;
    }
  }

  async rememberJid(phone: string, jid: string): Promise<void> {
    try {
      await this.cache.set(`${this.PREFIX}jid:${phone}`, jid, JID_TTL_SECONDS);
    } catch (error) {
      this.logger.error(`Falha ao guardar JID: ${error.message}`);
    }
  }
}
