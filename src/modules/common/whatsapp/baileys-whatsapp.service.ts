import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from '@nestjs/common';
import makeWASocket, {
  DisconnectReason,
  WASocket,
  Browsers,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  generateMessageID,
  NACK_REASONS,
  WAMessageStatus,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// `require` e não `import`: o pacote publica um CJS sem `default` utilizável sob
// as flags de interop deste tsconfig, e `import * as sharp` vira um namespace
// que o TypeScript recusa chamar. Mesmo caminho que `thumbnail.service.ts` usa.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp');
import * as QRCode from 'qrcode';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheService } from '../cache/cache.service';
import { BaileysAuthStateStore } from './baileys-auth-state.store';
import { NotificationGatewayService } from '../notification/notification-gateway.service';
import { WhatsAppOutboundGuard, type OutboundPriority } from './whatsapp-outbound-guard';

/**
 * WhatsApp connection status tracking
 */
export enum WhatsAppConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  QR_READY = 'QR_READY',
  AUTHENTICATED = 'AUTHENTICATED',
  READY = 'READY',
  AUTH_FAILURE = 'AUTH_FAILURE',
}

/**
 * Veredito do SERVIDOR do WhatsApp sobre uma mensagem.
 *
 * POR QUE ISTO PRECISA EXISTIR
 *   `sock.sendMessage()` resolve assim que o nó é escrito no socket, e o message
 *   ID é gerado no CLIENTE. Ou seja: a promessa cumprida não prova nada sobre a
 *   aceitação da mensagem. O servidor responde depois, de forma assíncrona, com
 *   um ack que pode trazer `error`.
 *
 *   Em 2026-08-17 isso produziu dois `INVITATION_SENT` na trilha de auditoria da
 *   assinatura do orçamento 883 para mensagens que o WhatsApp havia REJEITADO com
 *   erro 463. Numa trilha com valor probatório, "não sei" registrado como
 *   "enviado" é o pior resultado possível — daí `TIMEOUT` ser tratado como falha
 *   e não como sucesso.
 */
export type WhatsAppSendVerdict =
  | { outcome: 'ACCEPTED'; messageId: string }
  | { outcome: 'REJECTED'; messageId: string; errorCode: string; reason: string }
  | { outcome: 'TIMEOUT'; messageId: string };

/**
 * Posição da conta perante o WhatsApp — o que o SERVIDOR diz sobre nós.
 *
 * POR QUE PERGUNTAR EM VEZ DE DEDUZIR
 *   Até aqui a única forma de descobrir que a conta estava sob reach-out
 *   time-lock era mandar uma mensagem e tomar o nack 463 — ou seja, o
 *   diagnóstico custava exatamente a ação que agrava a restrição. O Baileys
 *   expõe duas consultas que respondem antes do dano:
 *
 *   - `fetchAccountReachoutTimelock()` devolve se a trava está ATIVA, até quando
 *     e por qual motivo (`enforcementType`; `DEFAULT` significa "sem restrição").
 *   - `fetchNewChatMessageCap()` devolve a COTA de conversas NOVAS do ciclo
 *     corrente (`total_quota`/`used_quota`) e o estágio de aviso
 *     (`NONE` → `FIRST_WARNING` → `SECOND_WARNING` → `CAPPED`).
 *
 *   A segunda é o limite que o próprio WhatsApp publica para primeiro contato.
 *   Respeitá-la é a mitigação de banimento mais legítima que existe: não é
 *   heurística nossa sobre o que "parece spam", é o número que a plataforma
 *   informa.
 *
 * `creds.reachoutTimeLock` NÃO serve para isto: ele só é escrito quando o
 * servidor manda uma notificação de mudança (ou depois de um 463), então ficar
 * ausente não prova ausência de restrição — prova apenas que nunca perguntamos.
 */
export interface WhatsAppAccountStanding {
  fetchedAt: Date;
  /** `null` quando a consulta falhou; veja `error`. */
  reachout: {
    isActive: boolean;
    /** Fim da trava, quando o servidor informa. */
    timeEnforcementEnds: Date | null;
    /** `DEFAULT` = sem restrição. */
    enforcementType: string;
  } | null;
  newChatCap: {
    totalQuota: number | null;
    usedQuota: number | null;
    /** `total - used`, quando os dois vieram. */
    remaining: number | null;
    cycleStart: Date | null;
    cycleEnd: Date | null;
    /** NONE | FIRST_WARNING | SECOND_WARNING | CAPPED */
    cappingStatus: string | null;
  } | null;
  /**
   * Perfil comercial da conta.
   *
   * ESTÁ AQUI POR CAUSA DO AVISO DE LINK. O WhatsApp mostra "cuidado com links
   * de quem não é seu contato" na primeira conversa, e um dos sinais que ele
   * pondera é se o DOMÍNIO do link consta do perfil comercial de quem mandou.
   * Um perfil sem site — ou com um site diferente do domínio do link — faz o
   * link parecer não ter relação com o remetente, que é a definição do problema.
   *
   * Não dá para desligar o aviso pelo remetente; dá para remover o sinal que o
   * agrava, e isso é cadastro, não código. Expor aqui é o que torna a falta
   * visível em vez de teórica.
   */
  businessProfile: {
    description: string | null;
    email: string | null;
    address: string | null;
    category: string | null;
    websites: string[];
  } | null;
  error?: string;
}

/**
 * Cartão de prévia do link, montado por NÓS.
 *
 * POR QUE MONTAR EM VEZ DE DEIXAR O BAILEYS BUSCAR
 *   O Baileys sabe gerar a prévia sozinho: ele baixa a URL, lê as meta tags
 *   Open Graph e monta o cartão. Três razões para não usar isso aqui:
 *
 *   1. O web é uma SPA. O nginx devolve o MESMO `index.html` para toda rota, e
 *      as meta tags dele descrevem o sistema interno — o cartão sairia com
 *      "Ankaa - Sistema de Gestão Industrial Brasileiro" embaixo de um convite
 *      para assinar um orçamento. Verdadeiro, mas responde à pergunta errada.
 *   2. É uma requisição HTTP com timeout DENTRO da fila de envio. A guarda de
 *      saída já serializa os envios; somar uma busca de rede que pode pendurar
 *      3 s por mensagem atrasa a fila inteira por um enfeite.
 *   3. Falha em silêncio. Se o fetch falhar, a mensagem sai sem prévia e
 *      ninguém fica sabendo — que é exatamente o estado em que estávamos.
 *
 * POR QUE A PRÉVIA IMPORTA, E NÃO É ENFEITE
 *   Uma mensagem de primeiro contato cujo conteúdo é uma URL crua, sem cartão, é
 *   a forma canônica de um link de phishing. O WhatsApp pontua isso, o
 *   destinatário lê isso, e a diferença entre "link nu de número desconhecido" e
 *   "cartão com o nome da empresa e o número do orçamento" é a diferença entre
 *   ser denunciado e ser aberto. Denúncia é o que bane um número.
 *
 * O CARTÃO NÃO PODE MENTIR. `matchedText` é a URL exata que está no texto — se
 * divergir, o WhatsApp não associa o cartão ao link e o resultado é pior do que
 * não ter cartão. E nada de valor financeiro aqui: a prévia é o pedaço da
 * mensagem que mais circula em captura de tela.
 */
export interface WhatsAppLinkPreview {
  /** A URL EXATA como aparece no corpo da mensagem. */
  url: string;
  title: string;
  description?: string;
}

/**
 * A guarda de saída recusou o envio — decisão NOSSA, não do WhatsApp.
 *
 * Existe como tipo próprio porque as duas famílias de falha pedem condutas
 * opostas: falha de transporte (sessão caída, número inexistente) admite nova
 * tentativa; recusa da guarda significa exatamente que tentar de novo é a
 * conduta errada. Quem trata os dois iguais reintroduz o padrão de disparo que a
 * guarda existe para remover.
 */
export class WhatsAppOutboundRefusedError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'WhatsAppOutboundRefusedError';
  }
}

/** Rótulos dos nacks que sabemos explicar ao operador em português. */
const NACK_LABELS: Record<string, string> = {
  [String(NACK_REASONS.SenderReachoutTimelocked)]:
    'conta restrita pelo WhatsApp (reach-out time-lock) ou sem TC token para este contato',
  [String(NACK_REASONS.UnsupportedLIDGroup)]: 'grupo LID não suportado',
  [String(NACK_REASONS.MissingMessageSecret)]: 'segredo da mensagem ausente',
  [String(NACK_REASONS.DBOperationFailed)]: 'falha de operação no servidor do WhatsApp',
  [String(NACK_REASONS.UnhandledError)]: 'erro não tratado no servidor do WhatsApp',
};

/**
 * Baileys-based WhatsApp service
 * Replaces whatsapp-web.js with more reliable WebSocket-based connection
 *
 * Key Improvements:
 * - No Puppeteer/Chrome dependency (saves 250MB+ memory)
 * - Native multi-device protocol support
 * - Better reconnection handling
 * - Eliminates LID errors
 * - Faster startup (2-7s vs 40-70s)
 * - Lower resource usage (50-100MB vs 200-400MB)
 */
@Injectable()
export class BaileysWhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BaileysWhatsAppService.name);

  private sock: WASocket | null = null;
  private clientReady = false;
  private isConnecting = false;

  // QR code management
  private currentQRCode: string | null = null;
  private qrCodeGeneratedAt: Date | null = null;
  private readonly QR_CODE_EXPIRY_MS = 60000; // 60 seconds
  private readonly CACHE_KEY_QR = 'whatsapp:qr';
  private readonly CACHE_KEY_STATUS = 'whatsapp:status';

  // Reconnection management
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 8;
  private readonly RECONNECT_DELAY = 3000; // 3 seconds base
  private reconnectTimeout: NodeJS.Timeout | null = null;

  // Correlação de ack: message ID -> quem está esperando o veredito do servidor.
  // O ack observado em produção chega em ~300 ms; 20 s é folga, não expectativa.
  private readonly pendingAcks = new Map<string, (verdict: WhatsAppSendVerdict) => void>();
  private readonly ACK_TIMEOUT_MS = 20000;

  // Extrato mais recente da posição da conta (ver `WhatsAppAccountStanding`).
  // Vive em memória E no Redis: em memória para o caminho de envio consultar sem
  // I/O, no Redis para sobreviver a restart — uma trava de 24 h não pode ser
  // esquecida só porque a API reiniciou.
  private lastStanding: WhatsAppAccountStanding | null = null;
  private readonly CACHE_KEY_STANDING = 'whatsapp:account-standing';
  private readonly STANDING_TTL_SECONDS = 60 * 60 * 6;
  private readonly STANDING_REFRESH_MS = 60 * 60 * 6 * 1000;
  private standingTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly cacheService: CacheService,
    private readonly authStateStore: BaileysAuthStateStore,
    private readonly guard: WhatsAppOutboundGuard,
    @Inject(forwardRef(() => NotificationGatewayService))
    private readonly gatewayService: NotificationGatewayService,
  ) {}

  async onModuleInit() {
    // Check if WhatsApp is disabled
    if (process.env.DISABLE_WHATSAPP === 'true') {
      this.logger.warn('WhatsApp service is DISABLED via environment variable');
      return;
    }

    this.logger.log('Initializing Baileys WhatsApp service...');
    await this.initializeSocket();

    // Reconsulta periódica: a trava de primeiro contato pode ser imposta a
    // qualquer momento, e descobri-la só pelo nack 463 significa descobri-la
    // gastando a ação que a agrava. Quatro consultas por dia é ruído nenhum.
    this.standingTimer = setInterval(() => {
      void this.fetchAccountStanding().catch(() => undefined);
    }, this.STANDING_REFRESH_MS);
    this.standingTimer.unref?.();
  }

  async onModuleDestroy() {
    this.logger.log('Destroying WhatsApp service...');
    if (this.standingTimer) {
      clearInterval(this.standingTimer);
      this.standingTimer = null;
    }
    await this.destroySocket();
  }

  /**
   * Initialize Baileys socket connection
   */
  private async initializeSocket(): Promise<void> {
    if (this.sock) {
      this.logger.warn('Socket already exists, destroying first...');
      await this.destroySocket();
    }

    try {
      this.isConnecting = true;
      await this.updateConnectionStatus(WhatsAppConnectionStatus.CONNECTING);

      // Initialize auth state from Redis
      const { state, saveCreds } = await this.authStateStore.initAuthState();

      // Fetch latest Baileys version
      const { version, isLatest } = await fetchLatestBaileysVersion();
      this.logger.log(`Using WA version v${version.join('.')}, isLatest: ${isLatest}`);

      // Create Pino logger with trace support for Baileys
      const pinoLogger = {
        trace: (...args) => {}, // Silent trace logs
        debug: (...args) => {}, // Silent debug logs
        info: msg => this.logger.log(msg),
        warn: msg => this.logger.warn(msg),
        error: msg => this.logger.error(msg),
        fatal: msg => this.logger.error(msg),
        child: () => pinoLogger,
        level: 'silent',
      };

      // Create socket
      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pinoLogger as any),
        },
        logger: pinoLogger as any,
        browser: Browsers.ubuntu('Chrome'),
        defaultQueryTimeoutMs: 60000,
        // FALSE de propósito. Duas razões, e as duas importam:
        //   1. Uma conta 24 h "online" sem nunca dormir não é o que um humano
        //      parece — e o número é usado por gente de verdade, do celular.
        //   2. Com `true`, o WhatsApp para de mandar notificação para o aparelho
        //      do dono enquanto a API estiver conectada, porque considera que já
        //      há um cliente ativo lendo. Mensagem de cliente passava batida.
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false, // Disable to prevent link-preview errors
      });

      // Register event handlers
      this.registerEventHandlers(saveCreds);

      this.logger.log('Baileys socket initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize socket: ${error.message}`, error.stack);
      this.isConnecting = false;
      await this.updateConnectionStatus(WhatsAppConnectionStatus.AUTH_FAILURE);

      // Retry connection
      this.handleReconnection();
    }
  }

  /**
   * Register all Baileys event handlers
   */
  private registerEventHandlers(saveCreds: () => Promise<void>): void {
    if (!this.sock) return;

    // Connection updates (handles qr, connected, disconnected, etc.)
    this.sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect, qr } = update;

      // O Baileys emite `reachoutTimeLock` por dois caminhos: a notificação
      // `NotificationUserReachoutTimelockUpdate` (inclusive a que AVISA que a
      // restrição caiu) e o retorno de `fetchAccountReachoutTimelock()`, que ele
      // mesmo dispara ao receber um nack 463. Capturar aqui é o que faz o
      // sistema descobrir sozinho que a trava acabou, sem ninguém perguntar.
      if (update.reachoutTimeLock) {
        await this.recordReachoutTimeLock(update.reachoutTimeLock);
      }

      // QR code event
      if (qr) {
        await this.handleQRCode(qr);
      }

      // Connection opened (ready)
      if (connection === 'open') {
        this.logger.log('✅ WhatsApp connection opened successfully');
        this.clientReady = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.currentQRCode = null;
        this.qrCodeGeneratedAt = null;

        await this.cacheService.del(this.CACHE_KEY_QR);
        await this.updateConnectionStatus(WhatsAppConnectionStatus.READY);

        this.eventEmitter.emit('whatsapp.ready', { timestamp: new Date() });

        // Consulta a posição da conta assim que a conexão estabiliza. O atraso
        // existe porque as consultas wmex só respondem depois que o socket sai
        // de `AwaitingInitialSync`; disparar no mesmo tick devolve timeout.
        // `void` de propósito: nada no boot pode ficar preso nisto.
        setTimeout(() => {
          void this.fetchAccountStanding().catch(() => undefined);
        }, 15000);

        // Broadcast to all admins via WebSocket
        try {
          await this.gatewayService.broadcastToAdmin({
            event: 'whatsapp:connected',
            data: {
              status: 'READY',
              message: 'WhatsApp connected successfully',
              timestamp: new Date(),
            },
          });
        } catch (error) {
          this.logger.error(`Failed to broadcast connection status: ${error.message}`);
        }
      }

      // Connection closed
      if (connection === 'close') {
        this.clientReady = false;
        this.isConnecting = false;

        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;

        // 515 (restartRequired) NÃO é falha: é a etapa obrigatória logo após o
        // pareamento por QR — o WhatsApp encerra o stream e exige que o socket
        // seja recriado com as MESMAS credenciais. Tratar como erro (limpar auth,
        // ou gastar tentativa de reconexão com recuo exponencial) transforma um
        // pareamento bem-sucedido em laço infinito de QR.
        if (reason === DisconnectReason.restartRequired) {
          this.logger.log('Restart required (515) — recriando o socket com as mesmas credenciais');
          this.reconnectAttempts = 0;
          await this.updateConnectionStatus(WhatsAppConnectionStatus.CONNECTING);

          if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = setTimeout(() => {
            this.initializeSocket().catch(error =>
              this.logger.error(`Failed to restart socket after 515: ${error.message}`),
            );
          }, 500);
          return;
        }

        this.logger.warn(
          `Connection closed. Reason: ${reason}, shouldReconnect: ${shouldReconnect}`,
        );

        await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);
        this.eventEmitter.emit('whatsapp.disconnected', { reason, timestamp: new Date() });

        if (shouldReconnect) {
          this.handleReconnection();
        } else {
          this.logger.error('Logged out from WhatsApp. Clearing auth state to allow re-pairing.');
          // Sem isto o `creds` inutilizado permanece no Redis e todo "Conectar"
          // seguinte volta pelo caminho de login (Baileys ramifica só por
          // `creds.me`), falhando sem nunca emitir QR.
          try {
            await this.authStateStore.clearAuthState();
          } catch (error) {
            this.logger.error(`Failed to clear auth state after logout: ${error.message}`);
          }
          await this.updateConnectionStatus(WhatsAppConnectionStatus.AUTH_FAILURE);
          this.eventEmitter.emit('whatsapp.auth_failure', {
            error: 'Logged out',
            timestamp: new Date(),
          });
        }
      }

      // Connecting state
      if (connection === 'connecting') {
        this.logger.log('Connecting to WhatsApp...');
        this.isConnecting = true;
        await this.updateConnectionStatus(WhatsAppConnectionStatus.CONNECTING);
      }
    });

    // Credentials update (save to Redis)
    this.sock.ev.on('creds.update', saveCreds);

    // Messages received/sent
    this.sock.ev.on('messages.upsert', async m => {
      const messages = m.messages;
      const type = m.type;

      for (const message of messages) {
        // Check if message is from us
        const fromMe = message.key.fromMe;

        // Extract message content
        const messageText =
          message.message?.conversation || message.message?.extendedTextMessage?.text || '';

        // Emit event for tracking
        this.eventEmitter.emit('whatsapp.message_create', {
          messageId: message.key.id,
          from: message.key.remoteJid,
          fromMe,
          message: messageText,
          timestamp: new Date((message.messageTimestamp as number) * 1000),
          type,
        });

        if (fromMe) {
          this.logger.debug(`Message sent: ${messageText.substring(0, 50)}...`);
        } else {
          // Alguém FALOU com a gente: esse número deixa de ser primeiro contato.
          // É o sinal que separa "conversa em andamento" de "link frio", e é
          // sobre essa distinção que todo o teto de saída é construído.
          // `remoteJid` pode chegar como `@lid` numa conta Business; nesse caso
          // o telefone real vem em `remoteJidAlt`. Ler os dois é o que impede
          // que uma resposta do cliente deixe de "esquentar" o contato — e um
          // contato que nunca esquenta consome teto de primeiro contato para
          // sempre.
          const key = message.key as { remoteJid?: string; remoteJidAlt?: string };
          const phoneJid = [key.remoteJid, key.remoteJidAlt].find(j =>
            j?.endsWith('@s.whatsapp.net'),
          );
          if (phoneJid) {
            void this.guard.markInbound(phoneJid.split('@')[0].split(':')[0]);
          }
        }
      }
    });

    // Veredito do servidor. É AQUI que a rejeição aparece: o Baileys converte o
    // ack de erro num `messages.update` com `status: ERROR` e põe o código do
    // nack em `messageStubParameters[0]` (ver `messages-recv.js`, tratamento de
    // NACK_REASONS). Sem este listener, a rejeição só existia como uma linha de
    // log solta, sem vínculo com o envio que a causou.
    this.sock.ev.on('messages.update', updates => {
      for (const { key, update } of updates) {
        const id = key?.id;
        if (!id) continue;

        const resolve = this.pendingAcks.get(id);
        if (!resolve) continue;

        const status = update?.status;
        if (status === undefined || status === null) continue;

        if (status === WAMessageStatus.ERROR) {
          const errorCode = String(update.messageStubParameters?.[0] ?? 'desconhecido');
          const reason = NACK_LABELS[errorCode] ?? `rejeitado pelo servidor (nack ${errorCode})`;
          resolve({ outcome: 'REJECTED', messageId: id, errorCode, reason });
          continue;
        }

        // SERVER_ACK (2) em diante significa que o servidor aceitou e assumiu a
        // entrega. PENDING (1) é estado local e não decide nada.
        if (status >= WAMessageStatus.SERVER_ACK) {
          resolve({ outcome: 'ACCEPTED', messageId: id });
        }
      }
    });
  }

  /**
   * Guarda o estado da trava vindo de um evento (não de uma consulta nossa).
   *
   * Preserva a cota de conversas novas já conhecida: os dois fatos chegam por
   * caminhos independentes e sobrescrever um com `null` faria a informação mais
   * cara do extrato desaparecer a cada notificação de trava.
   */
  private async recordReachoutTimeLock(lock: {
    isActive?: boolean;
    timeEnforcementEnds?: Date;
    enforcementType?: string;
  }): Promise<void> {
    const reachout = {
      isActive: !!lock.isActive,
      timeEnforcementEnds: lock.timeEnforcementEnds ?? null,
      enforcementType: lock.enforcementType ?? 'DEFAULT',
    };

    const line =
      reachout.isActive
        ? `⛔ Conta sob reach-out time-lock (${reachout.enforcementType})` +
            (reachout.timeEnforcementEnds
              ? ` até ${reachout.timeEnforcementEnds.toISOString()}`
              : ' sem data de término informada')
        : '✅ Conta SEM reach-out time-lock (restrição de primeiro contato liberada)';
    if (reachout.isActive) this.logger.error(line);
    else this.logger.log(line);

    await this.persistStanding({
      fetchedAt: new Date(),
      reachout,
      newChatCap: this.lastStanding?.newChatCap ?? null,
      businessProfile: this.lastStanding?.businessProfile ?? null,
    });

    // A trava caiu: o disjuntor de contato frio foi aberto POR ela, então mantê-lo
    // seria manter um bloqueio nosso depois de o motivo ter deixado de existir.
    if (!reachout.isActive) {
      const breaker = await this.guard.breakerState();
      if (breaker?.scope === 'COLD') {
        await this.guard.clearBreaker();
      }
    }
  }

  private async persistStanding(standing: WhatsAppAccountStanding): Promise<void> {
    this.lastStanding = standing;
    try {
      await this.cacheService.setObject(
        this.CACHE_KEY_STANDING,
        standing,
        this.STANDING_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.error(`Falha ao gravar o extrato da conta: ${error.message}`);
    }
    this.eventEmitter.emit('whatsapp.account_standing', standing);
  }

  /**
   * Pergunta ao WhatsApp qual é a nossa situação. Ver `WhatsAppAccountStanding`.
   *
   * As duas consultas são independentes de propósito: a cota de conversas novas
   * continua sendo útil quando a consulta da trava falha, e vice-versa. Uma
   * falha vira campo `null` + `error`, nunca exceção — quem chama é um endpoint
   * de diagnóstico e um guarda de envio, e nenhum dos dois deve quebrar porque o
   * servidor do WhatsApp não respondeu.
   */
  async fetchAccountStanding(): Promise<WhatsAppAccountStanding> {
    if (!this.clientReady || !this.sock) {
      const standing: WhatsAppAccountStanding = {
        fetchedAt: new Date(),
        reachout: null,
        newChatCap: null,
        businessProfile: null,
        error: 'Sessão do WhatsApp não está conectada.',
      };
      this.lastStanding = standing;
      return standing;
    }

    const errors: string[] = [];

    let reachout: WhatsAppAccountStanding['reachout'] = null;
    try {
      const lock = await this.sock.fetchAccountReachoutTimelock();
      reachout = {
        isActive: !!lock?.isActive,
        timeEnforcementEnds: lock?.timeEnforcementEnds ?? null,
        enforcementType: (lock?.enforcementType as string) ?? 'DEFAULT',
      };
    } catch (error) {
      errors.push(`reach-out time-lock: ${error.message}`);
    }

    let newChatCap: WhatsAppAccountStanding['newChatCap'] = null;
    try {
      const cap = await this.sock.fetchNewChatMessageCap();
      const total = typeof cap?.total_quota === 'number' ? cap.total_quota : null;
      const used = typeof cap?.used_quota === 'number' ? cap.used_quota : null;
      newChatCap = {
        totalQuota: total,
        usedQuota: used,
        remaining: total !== null && used !== null ? Math.max(0, total - used) : null,
        cycleStart: cap?.cycle_start_timestamp
          ? new Date(parseInt(String(cap.cycle_start_timestamp), 10) * 1000)
          : null,
        cycleEnd: cap?.cycle_end_timestamp
          ? new Date(parseInt(String(cap.cycle_end_timestamp), 10) * 1000)
          : null,
        cappingStatus: (cap?.capping_status as string) ?? null,
      };
    } catch (error) {
      errors.push(`cota de conversas novas: ${error.message}`);
    }

    let businessProfile: WhatsAppAccountStanding['businessProfile'] = null;
    try {
      const me = this.sock.user?.id;
      const profile = me ? await this.sock.getBusinessProfile(me) : null;
      if (profile && typeof profile === 'object') {
        businessProfile = {
          description: profile.description || null,
          email: profile.email || null,
          address: profile.address || null,
          category: profile.category || null,
          websites: Array.isArray(profile.website) ? profile.website : [],
        };
      }
    } catch (error) {
      errors.push(`perfil comercial: ${error.message}`);
    }

    const standing: WhatsAppAccountStanding = {
      fetchedAt: new Date(),
      reachout,
      newChatCap,
      businessProfile,
      ...(errors.length ? { error: errors.join(' | ') } : {}),
    };

    this.logger.log(
      `📋 Posição da conta no WhatsApp — trava de primeiro contato: ${
        reachout === null
          ? 'não foi possível consultar'
          : reachout.isActive
            ? `ATIVA (${reachout.enforcementType}${
                reachout.timeEnforcementEnds
                  ? `, até ${reachout.timeEnforcementEnds.toISOString()}`
                  : ', sem data de término'
              })`
            : `liberada (${reachout.enforcementType})`
      } | cota de conversas novas: ${
        newChatCap === null
          ? 'não foi possível consultar'
          : `${newChatCap.usedQuota ?? '?'}/${newChatCap.totalQuota ?? '?'} usadas` +
            ` (status ${newChatCap.cappingStatus ?? 'desconhecido'}` +
            (newChatCap.cycleEnd ? `, ciclo até ${newChatCap.cycleEnd.toISOString()}` : '') +
            ')'
      } | perfil comercial: ${
        businessProfile === null
          ? 'não foi possível consultar'
          : businessProfile.websites.length
            ? `site(s) ${businessProfile.websites.join(', ')}`
            : 'SEM SITE CADASTRADO — o aviso de "cuidado com links" fica mais forte'
      }${errors.length ? ` | falhas: ${errors.join(' | ')}` : ''}`,
    );

    await this.persistStanding(standing);
    return standing;
  }

  /**
   * Grava o perfil comercial da conta.
   *
   * POR QUE ISTO É CÓDIGO, E NÃO "faça no celular"
   *   Porque o campo que importa aqui não é decorativo: o WhatsApp cruza o
   *   DOMÍNIO de um link enviado com o site declarado no perfil de quem enviou.
   *   Perfil sem site ⇒ o link não tem relação declarada com o remetente ⇒ o
   *   aviso de "cuidado com links de quem não é seu contato" pesa mais. Medido
   *   em 24/08/2026: o perfil estava inteiramente vazio (só a categoria).
   *
   *   Não some com o aviso — ele é do CLIENTE do destinatário e o remetente não
   *   o controla. Some com o SINAL que o agrava, que é a parte que nos cabe.
   *
   * ALTERA UM DADO PÚBLICO. Fica atrás de ADMIN e nunca roda sozinha no boot:
   * reescrever o perfil comercial de uma empresa a cada restart, por conta
   * própria, seria a definição de efeito colateral inaceitável.
   */
  async updateBusinessProfile(args: {
    description?: string;
    email?: string;
    address?: string;
    websites?: string[];
  }): Promise<WhatsAppAccountStanding> {
    if (!this.clientReady || !this.sock) {
      throw new Error('Sessão do WhatsApp não está conectada.');
    }

    // A IQ é montada AQUI, e não por `sock.updateBussinesProfile`, por causa de
    // um defeito do codificador binário do Baileys.
    //
    // O DEFEITO: `encodeBinaryNode` chama `writeString` para todo conteúdo do
    // tipo string, e `writeString` tenta interpretar qualquer coisa com "@" como
    // um JID (`jidDecode`). O `jidDecode` corta o usuário no primeiro "_"
    // (`userAgent.split('_')`, tratando o resto como "agent"), e o campo é então
    // gravado como JID em vez de texto.
    //
    // Custou caro em 24/08/2026: `sergio_ankaa@hotmail.com` foi publicado no
    // perfil PÚBLICO da empresa como `sergio@hotmail.com` — um endereço de outra
    // pessoa. Todo e-mail com "_" antes do "@" cai nisso.
    //
    // A saída: `content` do tipo Buffer é escrito como bytes crus, com prefixo de
    // tamanho, sem passar pelo `writeString`. Vale para todos os campos, não só
    // o e-mail — endereço e descrição também podem conter "@" um dia.
    const fields: Array<{ tag: string; attrs: Record<string, string>; content: Buffer }> = [];
    const push = (tag: string, value: string | undefined) => {
      if (value === undefined || value === null || value === '') return;
      fields.push({ tag, attrs: {}, content: Buffer.from(value, 'utf-8') });
    };

    push('address', args.address);
    push('email', args.email);
    push('description', args.description);
    for (const site of args.websites ?? []) push('website', site);

    if (!fields.length) throw new Error('Nada a atualizar no perfil comercial.');

    await this.sock.query({
      tag: 'iq',
      attrs: { to: 's.whatsapp.net', type: 'set', xmlns: 'w:biz' },
      content: [
        {
          tag: 'business_profile',
          // `delta`: só os campos enviados são tocados. `v: '3'` é a versão do
          // esquema que o servidor espera — os dois vêm do próprio Baileys.
          attrs: { v: '3', mutation_type: 'delta' },
          content: fields,
        },
      ],
    });

    this.logger.log(
      `Perfil comercial atualizado: ${fields.map(f => f.tag).join(', ')}.`,
    );

    // Relê do servidor em vez de assumir o que foi mandado: o WhatsApp normaliza
    // (e às vezes recusa) campos, e um extrato que espelha a intenção em vez do
    // estado é pior que nenhum.
    return this.fetchAccountStanding();
  }

  /** Último extrato conhecido, sem ir ao servidor. Redis é a fonte após restart. */
  async getAccountStanding(): Promise<WhatsAppAccountStanding | null> {
    if (this.lastStanding) return this.lastStanding;
    try {
      const cached = await this.cacheService.get<any>(this.CACHE_KEY_STANDING);
      if (cached && typeof cached === 'object') {
        this.lastStanding = {
          ...cached,
          fetchedAt: new Date(cached.fetchedAt),
          reachout: cached.reachout
            ? {
                ...cached.reachout,
                timeEnforcementEnds: cached.reachout.timeEnforcementEnds
                  ? new Date(cached.reachout.timeEnforcementEnds)
                  : null,
              }
            : null,
          newChatCap: cached.newChatCap
            ? {
                ...cached.newChatCap,
                cycleStart: cached.newChatCap.cycleStart
                  ? new Date(cached.newChatCap.cycleStart)
                  : null,
                cycleEnd: cached.newChatCap.cycleEnd
                  ? new Date(cached.newChatCap.cycleEnd)
                  : null,
              }
            : null,
        };
        return this.lastStanding;
      }
    } catch (error) {
      this.logger.error(`Falha ao ler o extrato da conta: ${error.message}`);
    }
    return null;
  }

  /**
   * Espera o servidor se pronunciar sobre uma mensagem já escrita no socket.
   *
   * O registro do ouvinte acontece ANTES do `sendMessage` (ver o chamador): o ack
   * de erro chegou em ~300 ms em produção, e registrar depois abre uma janela em
   * que o veredito passa despercebido e todo envio vira TIMEOUT.
   */
  private waitForServerVerdict(messageId: string): Promise<WhatsAppSendVerdict> {
    return new Promise<WhatsAppSendVerdict>(resolve => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(messageId);
        resolve({ outcome: 'TIMEOUT', messageId });
      }, this.ACK_TIMEOUT_MS);

      this.pendingAcks.set(messageId, verdict => {
        clearTimeout(timer);
        this.pendingAcks.delete(messageId);
        resolve(verdict);
      });
    });
  }

  /**
   * Handle QR code generation
   */
  private async handleQRCode(qr: string): Promise<void> {
    try {
      this.logger.log('QR Code received, scan with WhatsApp app');

      // Convert QR string to data URL
      const qrImageDataURL = await QRCode.toDataURL(qr, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });

      this.currentQRCode = qrImageDataURL;
      this.qrCodeGeneratedAt = new Date();

      // Cache QR code with expiry
      await this.cacheService.setObject(
        this.CACHE_KEY_QR,
        {
          qr: qrImageDataURL,
          generatedAt: this.qrCodeGeneratedAt,
          expiresAt: new Date(Date.now() + this.QR_CODE_EXPIRY_MS),
        },
        Math.ceil(this.QR_CODE_EXPIRY_MS / 1000),
      );

      await this.updateConnectionStatus(WhatsAppConnectionStatus.QR_READY);

      this.eventEmitter.emit('whatsapp.qr', { qr: qrImageDataURL, timestamp: new Date() });

      // Broadcast QR code to all admins via WebSocket
      try {
        await this.gatewayService.broadcastToAdmin({
          event: 'whatsapp:qr',
          data: {
            qr: qrImageDataURL,
            generatedAt: this.qrCodeGeneratedAt,
            expiresAt: new Date(Date.now() + this.QR_CODE_EXPIRY_MS),
            message: 'New QR code generated. Scan with WhatsApp mobile app.',
          },
        });
      } catch (error) {
        this.logger.error(`Failed to broadcast QR code: ${error.message}`);
      }
    } catch (error) {
      this.logger.error(`Failed to process QR code: ${error.message}`);
    }
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private handleReconnection(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(
        `Maximum reconnection attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached. Manual intervention required.`,
      );
      return;
    }

    this.reconnectAttempts++;
    const delay = this.RECONNECT_DELAY * Math.pow(1.8, this.reconnectAttempts - 1);
    const cappedDelay = Math.min(delay, 90000); // Cap at 90 seconds

    this.logger.log(
      `Scheduling reconnection attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} in ${cappedDelay / 1000} seconds...`,
    );

    this.reconnectTimeout = setTimeout(async () => {
      this.logger.log(`Attempting to reconnect (attempt ${this.reconnectAttempts})...`);
      try {
        await this.initializeSocket();
      } catch (error) {
        this.logger.error(
          `Reconnection attempt ${this.reconnectAttempts} failed: ${error.message}`,
        );
      }
    }, cappedDelay);
  }

  /**
   * Envia uma mensagem de texto.
   *
   * `priority` decide duas coisas: a posição na fila e se o envio consome o teto
   * de PRIMEIRO CONTATO. `CRITICAL` é o código de uso único da assinatura — o
   * cliente pediu, está com a tela aberta, e a mensagem é resposta a um ato dele.
   * Tudo o mais é `NORMAL`.
   *
   * LANÇA quando a guarda de saída recusa, com o motivo em português já pronto
   * para o operador (`WhatsAppOutboundRefusedError`). Devolver `false` mudo aqui
   * transformaria "seu número bateu no teto de primeiro contato desta hora" em
   * "falhou", que é o tipo de mensagem que faz o operador tentar de novo — a
   * única coisa que não se deve fazer nesse momento.
   */
  async sendMessage(
    phone: string,
    message: string,
    priority: OutboundPriority = 'NORMAL',
    preview?: WhatsAppLinkPreview | null,
  ): Promise<boolean> {
    return this.sendMessageWithOptions(phone, { text: message }, priority, preview);
  }

  /**
   * Send WhatsApp message with buttons
   * Falls back to text-only if buttons are not supported
   */
  async sendMessageWithButtons(
    phone: string,
    text: string,
    buttons: Array<{ buttonId: string; buttonText: { displayText: string }; type: number }>,
    footer?: string,
    fallbackText?: string,
  ): Promise<boolean> {
    try {
      // Try sending with buttons first
      await this.sendMessageWithOptions(phone, {
        text,
        footer: footer || 'Sistema Ankaa',
        buttons: buttons.map(btn => ({
          buttonId: btn.buttonId,
          buttonText: { displayText: btn.buttonText.displayText },
          type: btn.type,
        })),
        headerType: 1,
      });
      this.logger.log(`Message with buttons sent successfully to ${this.maskPhone(phone)}`);
      return true;
    } catch (error: any) {
      // Recusa da guarda NÃO é "o botão não passou": tentar de novo em texto puro
      // furaria o teto que acabou de barrar o envio.
      if (error instanceof WhatsAppOutboundRefusedError) throw error;

      this.logger.warn(`Failed to send button message, falling back to text: ${error.message}`);

      // Fallback to text-only message
      try {
        const messageToSend = fallbackText || text;
        await this.sendMessageWithOptions(phone, { text: messageToSend });
        this.logger.log(`Fallback text message sent successfully to ${this.maskPhone(phone)}`);
        return true;
      } catch (fallbackError: any) {
        this.logger.error(`Fallback message also failed: ${fallbackError.message}`);
        throw fallbackError;
      }
    }
  }

  /**
   * Miniatura do cartão de prévia: a logo da Ankaa em JPEG quadrado.
   *
   * Montada UMA vez e guardada em memória. JPEG e não PNG porque é o que o campo
   * `jpegThumbnail` do protobuf carrega; achatada sobre branco porque a logo tem
   * canal alfa e transparência vira preto no JPEG.
   *
   * `null` em cache negativo: sem a logo o cartão sai só com texto, que ainda é
   * muito melhor que uma URL nua — nunca vale derrubar o envio por causa dela.
   */
  private linkThumbnail: Buffer | null | undefined = undefined;

  private async getLinkThumbnail(): Promise<Buffer | undefined> {
    if (this.linkThumbnail !== undefined) return this.linkThumbnail ?? undefined;
    try {
      const path = resolve(process.cwd(), 'assets', 'logo.png');
      if (!existsSync(path)) {
        this.linkThumbnail = null;
        return undefined;
      }
      this.linkThumbnail = await sharp(readFileSync(path))
        .resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 80 })
        .toBuffer();
      return this.linkThumbnail;
    } catch (error) {
      this.logger.warn(`Miniatura do cartão de link indisponível: ${error.message}`);
      this.linkThumbnail = null;
      return undefined;
    }
  }

  /**
   * Resolve o JID de um número, preferindo o cache.
   *
   * `onWhatsApp()` é uma consulta de EXISTÊNCIA de telefone. Repeti-la a cada
   * envio, sempre para os mesmos contatos, é o padrão de quem varre lista de
   * números — e o JID de um número não muda. Ver `WhatsAppOutboundGuard.cachedJid`.
   */
  private async resolveJid(cleanPhone: string): Promise<string> {
    const cached = await this.guard.cachedJid(cleanPhone);
    if (cached) return cached;

    this.logger.log(`Resolving JID for phone ${this.maskPhone(cleanPhone)}`);
    const [result] = await this.sock!.onWhatsApp(cleanPhone);

    if (!result || !result.exists) {
      throw new Error(`Phone number ${this.maskPhone(cleanPhone)} is not registered on WhatsApp`);
    }

    await this.guard.rememberJid(cleanPhone, result.jid);
    return result.jid;
  }

  /**
   * Internal method to send message with various options
   */
  private async sendMessageWithOptions(
    phone: string,
    content: any,
    priority: OutboundPriority = 'NORMAL',
    preview?: WhatsAppLinkPreview | null,
  ): Promise<boolean> {
    if (!this.clientReady || !this.sock) {
      throw new Error('WhatsApp client is not ready. Please check connection status.');
    }

    if (!phone) {
      throw new Error('Phone number is required');
    }

    // A PRÉVIA DO LINK É EXPLÍCITA — nunca buscada, nunca automática.
    //
    // `generateWAMessageContent` só gera a prévia sozinho quando `linkPreview` é
    // `undefined`. Preencher o campo — com o cartão ou com `null` — é o que tira
    // a busca de rede do caminho do envio. Ver `WhatsAppLinkPreview` para por que
    // o cartão vem de nós e não das meta tags da SPA.
    //
    // `null` (sem prévia) continua sendo o certo para mensagem SEM link: o
    // código de uso único não tem URL nenhuma, e um cartão ali seria invenção.
    if (content && typeof content.text === 'string' && content.linkPreview === undefined) {
      if (preview && content.text.includes(preview.url)) {
        content = {
          ...content,
          linkPreview: {
            // `matched-text` TEM de ser a URL exata presente no texto: é por ela
            // que o cliente do WhatsApp casa o cartão com o link. Divergir aqui
            // produz um cartão órfão, pior que nenhum.
            'matched-text': preview.url,
            'canonical-url': preview.url,
            title: preview.title,
            description: preview.description,
            jpegThumbnail: await this.getLinkThumbnail(),
          },
        };
      } else {
        if (preview) {
          // Defensivo e barulhento: um cartão cuja URL não está no corpo é bug
          // de quem chamou, e falharia silenciosamente lá na conversa.
          this.logger.warn(
            'Prévia de link ignorada: a URL do cartão não aparece no corpo da mensagem.',
          );
        }
        content = { ...content, linkPreview: null };
      }
    }

    // Format phone number for Baileys (remove non-digits)
    const cleanPhone = phone.replace(/\D/g, '');
    const bodyText = typeof content?.text === 'string' ? content.text : '';

    const standing = await this.getAccountStanding();

    // O RITMO é escolhido aqui, com uma leitura barata de cache; a DECISÃO de
    // deixar passar acontece lá dentro, já na vez desta mensagem.
    //
    // POR QUE OS TETOS SÃO CONFERIDOS DENTRO DA FILA, E NÃO AQUI
    //   Os contadores só sobem depois do ack do servidor. Conferir o teto na
    //   ENFILEIRAÇÃO faria um lote de 30 convites avaliar os 30 contra o mesmo
    //   contador zerado e aprovar todos — o teto existiria só no papel, e o lote
    //   sairia inteiro, que é exatamente o padrão que derrubou o número anterior.
    const known = await this.guard.hasOpenConversation(cleanPhone);
    const paceKind = priority === 'CRITICAL' ? 'CRITICAL' : known ? 'WARM' : 'COLD';

    return this.guard.paced(paceKind, async () => {
      const verdict = await this.guard.evaluate({
        phone: cleanPhone,
        message: bodyText,
        priority,
        reachoutActive: standing?.reachout?.isActive ?? false,
      });

      if (!verdict.allowed) {
        this.logger.warn(
          `Envio para ${this.maskPhone(cleanPhone)} recusado pela guarda de saída ` +
            `(${verdict.code}): ${verdict.reason}`,
        );
        this.eventEmitter.emit('whatsapp.message_withheld', {
          to: cleanPhone,
          code: verdict.code,
          reason: verdict.reason,
          cold: verdict.cold,
          timestamp: new Date(),
        });
        throw new WhatsAppOutboundRefusedError(
          verdict.reason ?? 'Envio bloqueado pela política de saída do WhatsApp.',
          verdict.code ?? 'REFUSED',
        );
      }

      // Só resolve o JID depois de aprovado: `onWhatsApp` é consulta de
      // existência de telefone, e disparar 30 delas para um lote que o teto vai
      // barrar é exatamente a varredura de lista que se quer evitar.
      const jid = await this.resolveJid(cleanPhone);

      this.logger.log(
        `Enviando para ${this.maskPhone(cleanPhone)} — JID ${jid}, ` +
          `${verdict.cold ? 'primeiro contato' : 'conversa existente'}, prioridade ${priority}.`,
      );

      // Presença antes do envio: "assinando" a conversa e sinalizando digitação
      // pelo tempo que o texto levaria para ser escrito. É o que o cliente
      // oficial faz e o que um script normalmente não faz — e é best-effort,
      // porque falhar aqui não é motivo para não entregar a mensagem.
      try {
        await this.sock!.presenceSubscribe(jid);
        await this.sock!.sendPresenceUpdate('composing', jid);
        await new Promise(resolve => setTimeout(resolve, this.guard.typingMs(bodyText)));
        await this.sock!.sendPresenceUpdate('paused', jid);
      } catch (error) {
        this.logger.debug(`Presença não pôde ser sinalizada: ${error.message}`);
      }

      // O ID é gerado AQUI, e não lido da resposta, para que o ouvinte do ack já
      // esteja armado quando o servidor responder. `messageId` é a opção que o
      // Baileys expõe justamente para sobrescrever o ID gerado internamente.
      const messageId = generateMessageID();
      const verdictPromise = this.waitForServerVerdict(messageId);

      try {
        await this.sock!.sendMessage(jid, content, {
          messageId,
          // Disable ephemeral messages
          ephemeralExpiration: undefined,
        });
      } catch (error) {
        this.logger.error(`Failed to send message: ${error.message}`, error.stack);
        throw error;
      }

      // Escrever no socket NÃO é entregar. A partir daqui quem decide é o servidor.
      const serverVerdict = await verdictPromise;

      if (serverVerdict.outcome === 'REJECTED') {
        this.logger.error(
          `WhatsApp RECUSOU a mensagem para ${this.maskPhone(cleanPhone)} ` +
            `(nack ${serverVerdict.errorCode}: ${serverVerdict.reason}). ID: ${messageId}`,
        );
        // Abre o disjuntor. Insistir depois de um 463 é literalmente repetir a
        // ação que produziu a restrição.
        await this.guard.noteRejection(
          serverVerdict.errorCode,
          standing?.reachout?.timeEnforcementEnds ?? null,
        );
        this.eventEmitter.emit('whatsapp.message_rejected', {
          to: cleanPhone,
          jid,
          messageId,
          errorCode: serverVerdict.errorCode,
          reason: serverVerdict.reason,
          timestamp: new Date(),
        });
        return false;
      }

      if (serverVerdict.outcome === 'TIMEOUT') {
        // Deliberadamente `false`. Ver o comentário de `WhatsAppSendVerdict`:
        // sem confirmação do servidor não há como afirmar que foi entregue, e
        // quem chama grava trilha de auditoria a partir deste booleano.
        this.logger.error(
          `Sem confirmação do servidor do WhatsApp em ${this.ACK_TIMEOUT_MS} ms para ` +
            `${this.maskPhone(cleanPhone)} (ID: ${messageId}) — tratando como NÃO enviada.`,
        );
        return false;
      }

      this.logger.log(
        `Message sent successfully to ${this.maskPhone(cleanPhone)}, message ID: ${messageId} (ack do servidor confirmado)`,
      );

      this.guard.noteAccepted();
      await this.guard.recordSent(cleanPhone, bodyText, verdict.cold);

      this.eventEmitter.emit('whatsapp.message_sent', {
        to: cleanPhone,
        jid: jid,
        content,
        messageId,
        timestamp: new Date(),
      });

      return true;
    });
  }


  /**
   * Get current QR code
   */
  async getQRCode(): Promise<{ qr: string; generatedAt: Date; expiresAt: Date } | null> {
    try {
      const cached = await this.cacheService.get<any>(this.CACHE_KEY_QR);

      if (cached && typeof cached === 'object') {
        return {
          qr: cached.qr,
          generatedAt: new Date(cached.generatedAt),
          expiresAt: new Date(cached.expiresAt),
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to get QR code: ${error.message}`);
      return null;
    }
  }

  /**
   * Get connection status
   */
  async getConnectionStatus(): Promise<{
    status: WhatsAppConnectionStatus;
    ready: boolean;
    hasQRCode: boolean;
    qrCodeExpiry: Date | null;
    reconnectAttempts: number;
  }> {
    const statusStr = await this.cacheService.get<string>(this.CACHE_KEY_STATUS);
    const status = (statusStr as WhatsAppConnectionStatus) || WhatsAppConnectionStatus.DISCONNECTED;

    const qrData = await this.getQRCode();

    return {
      status,
      ready: this.clientReady,
      hasQRCode: !!qrData,
      qrCodeExpiry: qrData?.expiresAt || null,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Check if WhatsApp client is ready to send messages
   * @returns boolean indicating if client is ready
   */
  isReady(): boolean {
    return this.clientReady && this.sock !== null;
  }

  /**
   * Check if authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    return await this.authStateStore.hasAuthState();
  }

  /**
   * Disconnect from WhatsApp
   */
  async disconnect(): Promise<void> {
    this.logger.log('Manually disconnecting WhatsApp client...');
    await this.destroySocket();
    await this.authStateStore.clearAuthState();
    this.eventEmitter.emit('whatsapp.manual_disconnect', { timestamp: new Date() });
  }

  /**
   * Reconnect to WhatsApp
   */
  async reconnect(): Promise<void> {
    this.logger.log('Manually reconnecting WhatsApp client...');
    await this.destroySocket();
    this.reconnectAttempts = 0;
    await this.initializeSocket();
    this.eventEmitter.emit('whatsapp.manual_reconnect', { timestamp: new Date() });
  }

  /**
   * Destroy socket connection
   */
  private async destroySocket(): Promise<void> {
    if (this.sock) {
      try {
        this.sock.end(undefined);
        this.logger.log('Socket destroyed successfully');
      } catch (error) {
        this.logger.error(`Error destroying socket: ${error.message}`);
      } finally {
        this.sock = null;
        this.clientReady = false;
        this.isConnecting = false;
        this.currentQRCode = null;
        this.qrCodeGeneratedAt = null;

        await this.cacheService.del(this.CACHE_KEY_QR);
      }
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * Update connection status in Redis
   */
  private async updateConnectionStatus(status: WhatsAppConnectionStatus): Promise<void> {
    try {
      await this.cacheService.set(this.CACHE_KEY_STATUS, status, 86400); // 24 hours
      this.eventEmitter.emit('whatsapp.status_changed', { status, timestamp: new Date() });
    } catch (error) {
      this.logger.error(`Failed to update connection status: ${error.message}`);
    }
  }

  /**
   * Mask phone number for privacy
   */
  private maskPhone(phone: string): string {
    if (process.env.NODE_ENV === 'development') {
      return phone;
    }

    if (phone.length <= 4) return phone;
    const start = phone.slice(0, 2);
    const end = phone.slice(-2);
    const middle = '*'.repeat(phone.length - 4);
    return `${start}${middle}${end}`;
  }
}
