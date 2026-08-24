// bonus-termination.listener.ts
//
// Fecha a bonificação de quem acaba de ser desligado, no ato — sem esperar o
// cron de finalização do dia 5.
//
// POR QUE ISSO EXISTE
// -------------------
// A rescisão é paga poucos dias depois do desligamento, muito antes de o
// período 26→25 fechar e antes ainda de o cron rodar. Até aqui o bônus do
// período trabalhado só passava a existir quando o cron chegasse; enquanto
// isso, o RH não tinha número nenhum para colocar no acerto — e, no desenho
// antigo, a pessoa desaparecia da tela de bonificação no instante da demissão.
//
// O QUE É FECHADO
// ---------------
// Todo período em que a pessoa teve peso de elegibilidade > 0 e ainda não tem
// linha `Bonus`, do período do desligamento para trás, até `MAX_LOOKBACK`
// períodos. Isso cobre o caso clássico: desligamento no dia 2, com o período
// anterior já fechado (dia 25) mas ainda sem cron (dia 5) — dois períodos a
// gravar, não um.
//
// O período CORRENTE (ainda aberto) também é gravado. O valor ainda vai mudar
// até o dia 25, porque numerador e divisor continuam se movendo; a gravação é
// um upsert por (userId, ano, mês), então o próprio cron de fechamento reescreve
// a linha com o número final. O que se ganha é ter um valor auditável e pagável
// no momento do acerto, em vez de um vazio.
//
// NUNCA LANÇA: uma falha aqui não pode desfazer a demissão, que já foi commitada.

import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BonusService } from './bonus.service';
import { BonusEligibilityService } from './bonus-eligibility.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import {
  USER_CONTRACT_TERMINATED_EVENT,
  BONUS_ELIGIBILITY_CHANGED_EVENT,
  type UserContractTerminatedPayload,
  type BonusEligibilityChangedPayload,
} from '../../../constants/events';
import { businessPeriodStart, businessPeriodEnd } from '../../../utils/business-period';
import { getCurrentPeriod } from '../../../utils/bonus';

/**
 * Quantos períodos varrer para trás a partir do desligamento.
 *
 * 3 cobre desligamento no início do mês com o cron atrasado (período do
 * desligamento + o anterior) e ainda sobra uma folga. Mais que isso passaria a
 * recalcular história paga, que é justamente o que não se quer mexer.
 */
const MAX_LOOKBACK = 3;

/**
 * Uma falha de fechamento, classificada pelo que se deve FAZER com ela.
 *
 * `retryable` = o trabalho não foi feito por um motivo passageiro (a trava de
 * gravação do período estava com outro processo e não saiu em 120 s). Não é
 * problema de folha: é fila. Notificar o RH aqui é falso alarme — o certo é
 * tentar de novo e só avisar se a segunda tentativa também não passar.
 *
 * Qualquer outra coisa (Secullum fora do ar, período fechado divergindo, linha
 * que falhou na gravação) é terminal para este evento e vai direto para a
 * notificação, porque depende de decisão ou de conserto humano.
 */
type SettleFailure = { message: string; retryable: boolean; period: string };

/** A contenção de trava chega como `ServiceUnavailableException` do `BonusService`. */
function isRetryable(err: unknown): boolean {
  return err instanceof ServiceUnavailableException;
}

/**
 * Falhas que a reconciliação adiada realmente conserta, separadas das que não.
 *
 * A rede de segurança só refaz o período CORRENTE. Uma falha de trava num
 * período ANTIGO (varredura de lookback, correção de data retroativa) não seria
 * refeita por ninguém — então silenciá-la como "passageira" trocaria um falso
 * alarme por um problema mudo, que é pior. Essas voltam a ser terminais.
 */
function partitionFailures(
  failures: SettleFailure[],
  currentPeriodKey: string,
): { deferred: SettleFailure[]; terminal: SettleFailure[] } {
  const canDefer = (f: SettleFailure) => f.retryable && f.period === currentPeriodKey;
  return {
    deferred: failures.filter(canDefer),
    terminal: failures.filter(f => !canDefer(f)),
  };
}

@Injectable()
export class BonusTerminationListener implements OnModuleInit {
  private readonly logger = new Logger(BonusTerminationListener.name);

  /**
   * Janela de coalescência da regravação do período corrente. Alta o bastante
   * para um lote do cron de efetivação caber inteiro nela, baixa o bastante
   * para uma ação humana isolada materializar antes de alguém abrir a tela.
   */
  private static readonly RECONCILE_DEBOUNCE_MS = 10_000;
  private readonly pendingReconcile = new Map<string, NodeJS.Timeout>();

  /**
   * Quem ainda merece notificação SE a reconciliação adiada também falhar,
   * por período. Sobrevive aos reagendamentos do debounce de propósito: numa
   * rajada de demissões, todo mundo que caiu na trava tem de ser avisado (ou
   * poupado) pelo resultado da MESMA execução final.
   */
  private readonly pendingNotify = new Map<string, Set<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusService: BonusService,
    private readonly bonusEligibilityService: BonusEligibilityService,
    private readonly dispatchService: NotificationDispatchService,
    // O barramento que o `UserService` publica é o `EventEmitter` do Node
    // registrado sob este token — NÃO o `EventEmitter2` do Nest. `@OnEvent` liga
    // no segundo e nunca receberia nada. Mesmo padrão de `UserSecullumSyncService`.
    @Inject('EventEmitter') private readonly events: EventEmitter,
  ) {}

  onModuleInit(): void {
    this.events.on(USER_CONTRACT_TERMINATED_EVENT, (p: UserContractTerminatedPayload) => {
      void this.onContractTerminated(p);
    });
    this.events.on(BONUS_ELIGIBILITY_CHANGED_EVENT, (p: BonusEligibilityChangedPayload) => {
      void this.onEligibilityChanged(p);
    });
    this.logger.log(
      `[demissão] inscrito em ${USER_CONTRACT_TERMINATED_EVENT} + ${BONUS_ELIGIBILITY_CHANGED_EVENT}`,
    );
  }

  /**
   * Qualquer mudança de cadastro que mexa em QUEM entra no divisor B1 do
   * período corrente, ou COM QUE PESO — menos a transição para TERMINATED, que
   * tem o caminho próprio acima (mais completo: varre até 3 períodos).
   *
   * O trabalho é o mesmo em todos os casos: fazer as linhas salvas e o cache
   * refletirem a elegibilidade de AGORA. A diferença está em QUANTOS períodos
   * precisam ser tocados:
   *
   *   • correção de data de demissão → o período da data ANTIGA e o da NOVA.
   *     Mover a demissão de agosto para junho muda o peso da pessoa nos dois, e
   *     varrer só a data nova deixaria o período antigo com o divisor errado;
   *   • todo o resto (efetivação, admissão, cargo, nível) → só o corrente. Uma
   *     efetivação não reescreve o passado, e cargo/nível históricos já são
   *     rebobinados do ChangeLog pela própria elegibilidade.
   *
   * NUNCA LANÇA — mesmo contrato do fechamento da demissão.
   */
  async onEligibilityChanged(payload: BonusEligibilityChangedPayload): Promise<void> {
    const { userId, reason } = payload;
    try {
      const failures: SettleFailure[] = [];
      const rewritten = new Set<string>();

      if (reason === 'TERMINATION_DATE_CHANGED') {
        const periods = new Map<string, { year: number; month: number }>();
        for (const d of [payload.previousTerminationDate, payload.terminationDate]) {
          if (!d) continue;
          for (const p of this.periodsToSettle(new Date(d))) {
            periods.set(`${p.year}-${p.month}`, p);
          }
        }
        for (const { year, month } of periods.values()) {
          // Cache primeiro e sempre: mesmo que a gravação seja pulada, servir
          // o divisor antigo por até 30 min afirmando estar fresco é o pior
          // dos dois erros.
          await this.bonusService.invalidateLiveBonusesCache(year, month);
          await this.settlePeriod(userId, year, month, rewritten, failures, {
            // Um período FECHADO precisa ser reescrito aqui, ao contrário do
            // fluxo de demissão: lá a linha existente é a verdade histórica;
            // aqui a premissa dela (a data de desligamento) acabou de mudar,
            // então "já existe linha" não significa mais "está certa".
            rewriteClosedPeriods: true,
          });
        }
      }

      const current = getCurrentPeriod();
      await this.bonusService.invalidateLiveBonusesCache(current.year, current.month);

      if (failures.length > 0) {
        this.logger.error(
          `[elegibilidade:${reason}] não reconciliada para ${userId}: ` +
            failures.map(f => f.message).join('; '),
        );
      }
      const { deferred, terminal } = partitionFailures(
        failures,
        `${current.year}-${current.month}`,
      );

      // A reconciliação do corrente já ia acontecer de qualquer jeito; o que a
      // falha por trava acrescenta é o direito deste usuário a ser notificado
      // caso ela também não passe.
      this.scheduleCurrentPeriodReconcile(rewritten, deferred.length > 0 ? [userId] : []);

      if (terminal.length > 0) {
        await this.notifyFailure(
          userId,
          terminal.map(f => f.message),
        );
      }
    } catch (err) {
      this.logger.error(
        `[elegibilidade:${reason}] falha inesperada ao reconciliar ${userId}`,
        err as Error,
      );
    }
  }

  /**
   * Regravação do período corrente com COALESCÊNCIA.
   *
   * O cron de experiência efetiva várias pessoas de uma vez (em 24/06/2026
   * foram 13 num só laço). Um evento por pessoa significaria N regravações
   * completas do período — cada uma uma transação por colaborador mais o
   * Secullum, todas serializadas pela trava Redis de `calculateAndSaveBonuses`,
   * com espera de 120 s. O lote estouraria a trava e as últimas falhariam.
   *
   * Uma regravação só, alguns segundos depois do último evento, produz
   * exatamente o mesmo resultado: `calculateAndSaveBonuses` recalcula o período
   * inteiro do zero, não incrementalmente.
   *
   * O CACHE não é adiado — quem chama já o invalidou antes de agendar. A tela
   * fica correta na hora; o que espera é só a materialização das linhas.
   */
  private scheduleCurrentPeriodReconcile(
    rewritten: Set<string>,
    notifyUserIds: string[] = [],
  ): void {
    const { year, month } = getCurrentPeriod();
    const key = `${year}-${month}`;

    // Acumula ANTES do curto-circuito: se o período já foi regravado agora, o
    // trabalho de quem esperava a trava está feito e ninguém precisa ser
    // avisado — mas o registro tem de sair da fila junto.
    const waiting = this.pendingNotify.get(key) ?? new Set<string>();
    for (const id of notifyUserIds) waiting.add(id);

    if (rewritten.has(key)) {
      this.pendingNotify.delete(key);
      return;
    }
    if (waiting.size > 0) this.pendingNotify.set(key, waiting);

    const existing = this.pendingReconcile.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingReconcile.delete(key);
      const toNotify = [...(this.pendingNotify.get(key) ?? [])];
      this.pendingNotify.delete(key);

      void (async () => {
        const failures: SettleFailure[] = [];
        try {
          await this.reconcileCurrentPeriod(new Set<string>(), failures);
        } catch (err) {
          // Esta é a SEGUNDA tentativa: mesmo uma nova contenção de trava aqui
          // é terminal, senão o adiamento vira laço infinito e o RH nunca fica
          // sabendo que a bonificação da rescisão continua em aberto.
          failures.push({
            message: (err as Error)?.message ?? String(err),
            retryable: false,
            period: key,
          });
        }

        if (failures.length === 0) {
          // Deu certo na segunda: a rajada de demissões foi só fila na trava.
          // Nenhuma notificação — era exatamente o falso alarme de 20/08/2026.
          if (toNotify.length > 0) {
            this.logger.log(
              `[bonificação] ${key}: reconciliação adiada fechou o período — ` +
                `${toNotify.length} desligamento(s) que tinham esbarrado na trava não precisam de aviso.`,
            );
          }
          return;
        }

        const messages = failures.map(f => f.message);
        this.logger.error(
          `[elegibilidade] reconciliação adiada de ${key} falhou: ${messages.join('; ')}`,
        );
        // Agora sim: a segunda tentativa também não passou, o RH precisa saber.
        for (const userId of toNotify) {
          await this.notifyFailure(userId, messages);
        }
      })();
    }, BonusTerminationListener.RECONCILE_DEBOUNCE_MS);
    // Não segura o processo no encerramento.
    timer.unref?.();
    this.pendingReconcile.set(key, timer);
  }

  async onContractTerminated(payload: UserContractTerminatedPayload): Promise<void> {
    const { userId } = payload;

    try {
      const terminationDate =
        payload.terminationDate ?? (await this.resolveTerminationDate(userId));
      if (!terminationDate) {
        this.logger.warn(`[demissão] usuário ${userId} sem data de desligamento — nada a fechar.`);
        return;
      }

      const periods = this.periodsToSettle(terminationDate);
      const settled: string[] = [];
      const failures: SettleFailure[] = [];
      // Períodos que este laço realmente regravou — evita refazer o trabalho na
      // reconciliação do período corrente logo abaixo.
      const rewritten = new Set<string>();

      for (const { year, month } of periods) {
        const label = await this.settlePeriod(userId, year, month, rewritten, failures);
        if (label) settled.push(label);
      }

      await this.reconcileCurrentPeriod(rewritten, failures);

      if (settled.length > 0) {
        this.logger.log(`[demissão] bonificação fechada para ${userId}: ${settled.join('; ')}`);
      }
      if (failures.length > 0) {
        this.logger.error(
          `[demissão] bonificação NÃO fechada para ${userId}: ` +
            failures.map(f => f.message).join('; '),
        );

        const current = getCurrentPeriod();
        const { deferred, terminal } = partitionFailures(
          failures,
          `${current.year}-${current.month}`,
        );

        if (terminal.length > 0) {
          await this.notifyFailure(
            userId,
            terminal.map(f => f.message),
          );
        }
        // Só esbarrou na trava do período corrente? Não é falha de folha, é
        // fila: outra demissão da mesma rajada está gravando o período INTEIRO
        // neste instante, e o período inteiro é justamente o que faltava fazer
        // aqui. Reagenda e notifica só se a segunda tentativa também não passar.
        if (deferred.length > 0) {
          this.scheduleCurrentPeriodReconcile(new Set<string>(), [userId]);
        }
      }
    } catch (err) {
      this.logger.error(
        `[demissão] falha inesperada ao fechar a bonificação de ${userId}`,
        err as Error,
      );
    }
  }

  /**
   * Fecha UM período para uma pessoa, se ela realmente participou dele.
   *
   * Devolve o rótulo do que foi gravado (para o log de sucesso) ou `null`
   * quando o período foi pulado. Empurra falhas em `failures` e marca em
   * `rewritten` o que já foi regravado, para a reconciliação do corrente não
   * refazer o mesmo trabalho.
   *
   * `rewriteClosedPeriods` NÃO regrava período fechado — o nome é herdado de
   * uma versão anterior e mantido porque descreve a INTENÇÃO de quem chama
   * (correção de data, onde a premissa da linha mudou). O que ele liga é a
   * DETECÇÃO: num período fechado, compara o peso salvo com o recalculado e,
   * divergindo, reporta em `failures` (que vira notificação) com o comando de
   * recálculo manual. Regravar mês fechado por rotina reescreve o bônus de
   * todos com as regras de hoje — ver o bloco do `periodIsOpen` abaixo.
   */
  private async settlePeriod(
    userId: string,
    year: number,
    month: number,
    rewritten: Set<string>,
    failures: SettleFailure[],
    opts?: { rewriteClosedPeriods?: boolean },
  ): Promise<string | null> {
    const label = `${String(month).padStart(2, '0')}/${year}`;
    if (rewritten.has(`${year}-${month}`)) return null;

    // Só grava período em que ESTA pessoa realmente teve peso. Sem isso, um
    // desligamento no dia 1º recalcularia o período anterior inteiro mesmo
    // quando a pessoa nem participava dele.
    //
    // Exceção: numa correção de data, a pessoa pode ter acabado de ser
    // REMOVIDA do período ABERTO (a data nova a joga para fora) — aí o peso é 0
    // e é exatamente por isso que o período precisa ser regravado, para a poda
    // apagar a linha órfã. Em período FECHADO isto não leva a gravação nenhuma:
    // o guard do `periodIsOpen` abaixo intercepta e só reporta.
    const eligibility = await this.bonusEligibilityService.resolvePeriodEligibility(year, month);
    const entry = eligibility.byUserId.get(userId);
    const hasStrayRow =
      opts?.rewriteClosedPeriods === true &&
      (await this.prisma.bonus.count({ where: { userId, year, month } })) > 0;
    if ((!entry || entry.weight <= 0) && !hasStrayRow) return null;

    // Uma linha já gravada só é INTOCÁVEL quando virou dinheiro pago. Enquanto
    // o período está ABERTO, a linha é uma projeção — e uma projeção que ignora
    // a demissão que acabou de acontecer é pior que nenhuma: `periodDivisor`
    // encolhe com o desligamento, então o valor gravado fica defasado para TODO
    // MUNDO do período, não só para quem saiu.
    //
    // Era exatamente esse o furo de 10/08/2026: o cabeçalho deste arquivo
    // promete um "upsert por (userId, ano, mês)" que o cron reescreve, mas o
    // guard pulava a gravação sempre que existisse linha. Resultado: o número
    // só se corrigia no fechamento, dias depois de a rescisão ter sido paga.
    //
    // `Bonus.payrollId` NÃO basta como prova de pagamento: `generateForMonth`
    // monta a folha lendo `netBonus` mas nunca grava o vínculo de volta, então
    // a coluna é sempre null. A prova real é existir `Payroll` do mesmo
    // período — a mesma consulta que a poda de `calculateAndSaveBonuses` faz.
    const [paidRows, payrollRows] = await Promise.all([
      this.prisma.bonus.count({ where: { year, month, payrollId: { not: null } } }),
      this.prisma.payroll.count({ where: { year, month } }),
    ]);
    if (paidRows > 0 || payrollRows > 0) {
      this.logger.log(
        `[bonificação] ${label}: período já vinculado a folha ` +
          `(${paidRows} linha(s) paga(s), ${payrollRows} folha(s)) — preservado.`,
      );
      return null;
    }

    const periodIsOpen = businessPeriodEnd(year, month) >= new Date();
    if (!periodIsOpen) {
      const alreadySaved = await this.prisma.bonus.count({ where: { userId, year, month } });
      if (alreadySaved > 0) {
        // PERÍODO FECHADO COM LINHA GRAVADA NÃO É REGRAVADO POR ROTINA — nem
        // quando a premissa dela (a data de desligamento) acabou de mudar.
        //
        // `calculateAndSaveBonuses` recalcula o PERÍODO INTEIRO com as regras
        // e os dados de HOJE. Num período já fechado isso reescreve o bônus de
        // todo mundo, não só de quem teve a data corrigida, aplicando
        // retroativamente qualquer regra criada depois. Medido em 11/08/2026
        // ao mexer numa data de 07/2026: a varredura chegou a 05/2026 e a regra
        // de afastamento (nova) teria levado uma pessoa de peso 1,0 para 0,1,
        // mudando o divisor de um mês já pago.
        //
        // E `payrollRows` não protege: `Payroll` ainda não é usado, então a
        // contagem é sempre 0 e o guard acima não dispara.
        //
        // Corrigir mês pago é decisão humana — mesma postura da poda em
        // `calculateAndSaveBonuses`, que preserva linha já consumida por folha
        // e só reporta. Aqui a divergência é DETECTADA e ANUNCIADA, com o
        // comando exato para quem decidir agir.
        const expected = entry?.weight ?? 0;
        const saved = await this.prisma.bonus.findFirst({
          where: { userId, year, month },
          select: { eligibilityWeight: true },
        });
        const savedWeight = saved ? Number(saved.eligibilityWeight) : null;
        const diverges = savedWeight == null || Math.abs(savedWeight - expected) > 1e-4;

        if (diverges && opts?.rewriteClosedPeriods === true) {
          const msg =
            `${label}: período FECHADO — o peso salvo (${savedWeight ?? '?'}) não bate mais com ` +
            `o recalculado (${expected.toFixed(4)}) depois da correção da data. NÃO foi regravado ` +
            `automaticamente para não reescrever um mês possivelmente já pago. ` +
            `Se for para corrigir: pnpm bonus:recalc-period ${year} ${month}`;
          this.logger.error(`[bonificação] ${msg}`);
          failures.push({ message: msg, retryable: false, period: `${year}-${month}` });
        } else {
          this.logger.log(
            `[bonificação] ${label}: período fechado e linha já existe para ${userId} — mantida.`,
          );
        }
        return null;
      }
    }

    try {
      // Fecha o PERÍODO INTEIRO, não só esta pessoa: `weightedTasks`,
      // `averageTaskPerUser` e `periodDivisor` são valores do período, gravados
      // em cada linha. Salvar uma linha isolada deixaria o resto da folha
      // divergindo do mesmo período.
      const result = await this.bonusService.calculateAndSaveBonuses(String(year), String(month));
      rewritten.add(`${year}-${month}`);
      if (result.totalFailed > 0) {
        failures.push({
          message: `${label}: ${result.totalFailed} linha(s)`,
          retryable: false,
          period: `${year}-${month}`,
        });
      }
      return `${label} (${result.totalSuccess} ok, ${result.totalFailed} falhas)`;
    } catch (err) {
      // Secullum fora do ar é o caso esperado aqui — `calculateAndSaveBonuses`
      // se recusa a gravar sem apuração de ponto (e sem medição de afastamento),
      // e está certo em se recusar. O cron tenta de novo do dia 5 ao 10.
      //
      // Contenção de trava é o OUTRO caso e não se parece com este: o período
      // está sendo gravado agora mesmo por outra demissão da rajada.
      failures.push({
        message: `${label}: ${(err as Error)?.message ?? err}`,
        retryable: isRetryable(err),
        period: `${year}-${month}`,
      });
      return null;
    }
  }

  /**
   * Garante que o PERÍODO CORRENTE reflita a demissão, mesmo quando o laço
   * principal não o tocou.
   *
   * O laço é centrado no usuário: pula período em que ESTA pessoa teve peso 0.
   * Mas um desligamento com data antiga tira a pessoa do denominador do período
   * corrente (peso 1 → 0), e `periodDivisor` é um valor DO PERÍODO — o bônus de
   * todos os outros muda junto. Sem esta reconciliação, esse caso só se
   * corrigiria no fechamento.
   *
   * Três situações, nesta ordem:
   *   • alguma linha do período já virou folha  → não toca (dinheiro pago);
   *   • existem linhas salvas e não pagas       → regrava o período inteiro
   *                                               (`calculateAndSaveBonuses` já
   *                                               invalida o cache live);
   *   • não existe linha salva                  → basta derrubar o cache SWR,
   *                                               porque sem linha a tela do
   *                                               período corrente já serve o
   *                                               cálculo live, que lê o estado
   *                                               atual.
   */
  private async reconcileCurrentPeriod(
    rewritten: Set<string>,
    failures: SettleFailure[],
  ): Promise<void> {
    const { year, month } = getCurrentPeriod();
    const label = `${String(month).padStart(2, '0')}/${year}`;
    if (rewritten.has(`${year}-${month}`)) return;

    try {
      // SEMPRE invalida o cache, antes de qualquer decisão.
      //
      // O cache SWR do cálculo live tem 30 min de frescor e responde
      // `isStale: false` dentro deles: sem derrubá-lo, a tela continuaria
      // afirmando estar atualizada enquanto serve o divisor de antes da
      // mudança. Isso vale inclusive nos caminhos em que decidimos NÃO
      // regravar — não regravar a linha não torna o cache correto.
      await this.bonusService.invalidateLiveBonusesCache(year, month);

      const paidRows = await this.prisma.bonus.count({
        where: { year, month, payrollId: { not: null } },
      });
      if (paidRows > 0) {
        this.logger.log(
          `[bonificação] ${label} (corrente): vinculado a folha — preservado, sem recálculo.`,
        );
        return;
      }

      const savedRows = await this.prisma.bonus.findMany({
        where: { year, month },
        select: { periodDivisor: true },
      });
      if (savedRows.length === 0) {
        this.logger.log(
          `[bonificação] ${label} (corrente): sem linhas salvas — cache live invalidado, ` +
            'a tela já serve o cálculo vivo.',
        );
        return;
      }

      // Regravar o período inteiro é caro (uma transação por pessoa + Secullum).
      // Só vale a pena quando o DIVISOR realmente mudou — que é o que torna as
      // linhas salvas erradas para TODO MUNDO. Uma mudança que não move o
      // divisor (trocar de cargo bonificável para outro cargo bonificável, por
      // exemplo) já está coberta pela invalidação do cache acima.
      const eligibility = await this.bonusEligibilityService.resolvePeriodEligibility(year, month);
      const savedDivisor = savedRows[0]?.periodDivisor;
      const divisorUnchanged =
        savedDivisor != null &&
        Math.abs(Number(savedDivisor) - eligibility.divisor) < 1e-4 &&
        savedRows.every(r => r.periodDivisor != null);
      if (divisorUnchanged) {
        this.logger.log(
          `[bonificação] ${label} (corrente): divisor inalterado (${eligibility.divisor}) — ` +
            'cache invalidado, sem regravar.',
        );
        return;
      }

      const result = await this.bonusService.calculateAndSaveBonuses(String(year), String(month));
      this.logger.log(
        `[bonificação] ${label} (corrente): ${savedRows.length} linha(s) regravadas — divisor ` +
          `${savedDivisor ?? '?'} → ${eligibility.divisor} (${result.totalSuccess} ok, ` +
          `${result.totalFailed} falhas).`,
      );
      if (result.totalFailed > 0) {
        failures.push({
          message: `${label}: ${result.totalFailed} linha(s)`,
          retryable: false,
          period: `${year}-${month}`,
        });
      }
    } catch (err) {
      // Mesmo contrato do laço: nunca derruba a demissão, que já foi commitada.
      failures.push({
        message: `${label} (corrente): ${(err as Error)?.message ?? err}`,
        retryable: isRetryable(err),
        period: `${year}-${month}`,
      });
    }
  }

  /** Data do desligamento no vínculo corrente, quando o evento não a trouxe. */
  private async resolveTerminationDate(userId: string): Promise<Date | null> {
    const contract = await this.prisma.employmentContract.findFirst({
      where: { userId, isCurrent: true },
      select: { terminationDate: true },
    });
    return contract?.terminationDate ?? null;
  }

  /**
   * Períodos 26→25 a considerar: o do desligamento e os `MAX_LOOKBACK - 1`
   * anteriores. Um período FUTURO nunca entra — desligamento com data adiante
   * não antecipa cálculo de período que ainda não começou.
   */
  private periodsToSettle(terminationDate: Date): Array<{ year: number; month: number }> {
    const periods: Array<{ year: number; month: number }> = [];
    const now = new Date();

    // O período de bonificação de mês M vai de 26/(M-1) a 25/M. Uma rescisão no
    // dia 26 ou depois já pertence ao período do mês SEGUINTE.
    let month = terminationDate.getMonth() + 1;
    let year = terminationDate.getFullYear();
    if (terminationDate.getDate() >= 26) {
      month += 1;
      if (month === 13) {
        month = 1;
        year += 1;
      }
    }

    for (let i = 0; i < MAX_LOOKBACK; i++) {
      let m = month - i;
      let y = year;
      while (m <= 0) {
        m += 12;
        y -= 1;
      }
      // Período que sequer começou fica de fora: uma rescisão agendada para o
      // futuro não antecipa o cálculo de um período que ainda não abriu. O
      // período CORRENTE (aberto, já iniciado) entra — ver cabeçalho.
      if (businessPeriodStart(y, m) > now) continue;
      periods.push({ year: y, month: m });
    }

    return periods;
  }

  private async notifyFailure(userId: string, failures: string[]): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      await this.dispatchService.dispatchByConfiguration('payroll.finalization.failed', 'system', {
        entityType: 'User',
        entityId: userId,
        action: 'termination_bonus_settlement_failed',
        data: { user: user?.name ?? userId, failures },
        overrides: {
          webUrl: '/departamento-pessoal/bonificacoes',
          mobileUrl: '/(tabs)/departamento-pessoal/bonificacoes',
          relatedEntityType: 'BONUS',
          title: 'Bonificação da rescisão não foi fechada',
          body:
            `Não foi possível fechar a bonificação de ${user?.name ?? userId} no desligamento: ` +
            `${failures.join('; ')}. O cron tentará de novo entre os dias 5 e 10.`,
        },
      });
    } catch (err) {
      this.logger.error('Falha ao notificar o fechamento pendente da rescisão', err as Error);
    }
  }
}
