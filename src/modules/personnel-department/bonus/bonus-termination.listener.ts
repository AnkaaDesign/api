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

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BonusService } from './bonus.service';
import { BonusEligibilityService } from './bonus-eligibility.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import {
  USER_CONTRACT_TERMINATED_EVENT,
  type UserContractTerminatedPayload,
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

@Injectable()
export class BonusTerminationListener implements OnModuleInit {
  private readonly logger = new Logger(BonusTerminationListener.name);

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
    this.logger.log(`[demissão] inscrito em ${USER_CONTRACT_TERMINATED_EVENT}`);
  }

  async onContractTerminated(payload: UserContractTerminatedPayload): Promise<void> {
    const { userId } = payload;

    try {
      const terminationDate = payload.terminationDate ?? (await this.resolveTerminationDate(userId));
      if (!terminationDate) {
        this.logger.warn(
          `[demissão] usuário ${userId} sem data de desligamento — nada a fechar.`,
        );
        return;
      }

      const periods = this.periodsToSettle(terminationDate);
      const settled: string[] = [];
      const failures: string[] = [];
      // Períodos que este laço realmente regravou — evita refazer o trabalho na
      // reconciliação do período corrente logo abaixo.
      const rewritten = new Set<string>();

      for (const { year, month } of periods) {
        const label = `${String(month).padStart(2, '0')}/${year}`;

        // Só grava período em que ESTA pessoa realmente teve peso. Sem isso, um
        // desligamento no dia 1º recalcularia o período anterior inteiro mesmo
        // quando a pessoa nem participava dele.
        const eligibility = await this.bonusEligibilityService.resolvePeriodEligibility(
          year,
          month,
        );
        const entry = eligibility.byUserId.get(userId);
        if (!entry || entry.weight <= 0) continue;

        // Uma linha já gravada só é INTOCÁVEL quando virou dinheiro pago
        // (`payrollId` preenchido) ou quando o período já fechou. Enquanto o
        // período está ABERTO, a linha é uma projeção — e uma projeção que
        // ignora a demissão que acabou de acontecer é pior que nenhuma:
        // `periodDivisor` encolhe com o desligamento, então o valor gravado
        // fica defasado para TODO MUNDO do período, não só para quem saiu.
        //
        // Era exatamente esse o furo: o cabeçalho deste arquivo promete um
        // "upsert por (userId, ano, mês)" que o cron reescreve, mas o guard
        // pulava a gravação sempre que existisse linha — e a tela do período
        // corrente prefere a linha salva ao cálculo live (ver
        // `getBonusesWithLiveCalculation`). Resultado: o número só se corrigia
        // no fechamento, dias depois de a rescisão ter sido paga.
        const paidRows = await this.prisma.bonus.count({
          where: { year, month, payrollId: { not: null } },
        });
        if (paidRows > 0) {
          this.logger.log(
            `[demissão] ${label}: período já vinculado a folha (${paidRows} linha(s) paga(s)) — preservado.`,
          );
          continue;
        }

        const periodIsOpen = businessPeriodEnd(year, month) >= new Date();
        if (!periodIsOpen) {
          const alreadySaved = await this.prisma.bonus.count({ where: { userId, year, month } });
          if (alreadySaved > 0) {
            this.logger.log(
              `[demissão] ${label}: período fechado e linha já existe para ${userId} — mantida.`,
            );
            continue;
          }
        }

        try {
          // Fecha o PERÍODO INTEIRO, não só esta pessoa: `weightedTasks`,
          // `averageTaskPerUser` e `periodDivisor` são valores do período,
          // gravados em cada linha. Salvar uma linha isolada deixaria o resto
          // da folha divergindo do mesmo período.
          const result = await this.bonusService.calculateAndSaveBonuses(
            String(year),
            String(month),
          );
          settled.push(`${label} (${result.totalSuccess} ok, ${result.totalFailed} falhas)`);
          rewritten.add(`${year}-${month}`);
          if (result.totalFailed > 0) failures.push(`${label}: ${result.totalFailed} linha(s)`);
        } catch (err) {
          // Secullum fora do ar é o caso esperado aqui — `calculateAndSaveBonuses`
          // se recusa a gravar sem apuração de ponto, e está certo em se recusar.
          // O cron tenta de novo do dia 5 ao 10.
          failures.push(`${label}: ${(err as Error)?.message ?? err}`);
        }
      }

      await this.reconcileCurrentPeriod(rewritten, failures);

      if (settled.length > 0) {
        this.logger.log(
          `[demissão] bonificação fechada para ${userId}: ${settled.join('; ')}`,
        );
      }
      if (failures.length > 0) {
        this.logger.error(
          `[demissão] bonificação NÃO fechada para ${userId}: ${failures.join('; ')}`,
        );
        await this.notifyFailure(userId, failures);
      }
    } catch (err) {
      this.logger.error(
        `[demissão] falha inesperada ao fechar a bonificação de ${userId}`,
        err as Error,
      );
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
    failures: string[],
  ): Promise<void> {
    const { year, month } = getCurrentPeriod();
    const label = `${String(month).padStart(2, '0')}/${year}`;
    if (rewritten.has(`${year}-${month}`)) return;

    try {
      const paidRows = await this.prisma.bonus.count({
        where: { year, month, payrollId: { not: null } },
      });
      if (paidRows > 0) {
        this.logger.log(
          `[demissão] ${label} (corrente): vinculado a folha — preservado, sem recálculo.`,
        );
        return;
      }

      const savedRows = await this.prisma.bonus.count({ where: { year, month } });
      if (savedRows === 0) {
        await this.bonusService.invalidateLiveBonusesCache(year, month);
        this.logger.log(
          `[demissão] ${label} (corrente): sem linhas salvas — cache live invalidado.`,
        );
        return;
      }

      const result = await this.bonusService.calculateAndSaveBonuses(String(year), String(month));
      this.logger.log(
        `[demissão] ${label} (corrente): ${savedRows} linha(s) regravadas com o divisor novo ` +
          `(${result.totalSuccess} ok, ${result.totalFailed} falhas).`,
      );
      if (result.totalFailed > 0) failures.push(`${label}: ${result.totalFailed} linha(s)`);
    } catch (err) {
      // Mesmo contrato do laço: nunca derruba a demissão, que já foi commitada.
      failures.push(`${label} (corrente): ${(err as Error)?.message ?? err}`);
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
