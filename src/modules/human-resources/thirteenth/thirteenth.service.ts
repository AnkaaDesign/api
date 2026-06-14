// thirteenth.service.ts
// 13º salário (gratificação natalina — Part D). Orquestra CRUD + geração em
// lote + documentos pagáveis das parcelas. Regras de cálculo puras vivem em
// ThirteenthCalculationService; a base de tributação (exclusiva do 13º) vem de
// computeThirteenthTaxes (payroll/utils/tax-tables — read-only).
//
// baseRemuneration = salário-base do cargo CURRENT (MonetaryValue current) +
//   média de variáveis do ano (HE/adicional noturno/DSR das folhas + bonificação
//   + gratificações habituais ativas). Lê o histórico de folha/bonificação via
//   prisma SEM editar esses módulos.

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { roundCurrency } from '../../../utils/currency-precision.util';
import { EMPLOYEE_TYPE, CONTRACT_STATUS, THIRTEENTH_STATUS } from '../../../constants/enums';
import {
  ThirteenthCalculationService,
  ThirteenthInstallmentsResult,
} from './thirteenth-calculation.service';
import { ThirteenthRepository } from './repositories/thirteenth.repository';
import type {
  Thirteenth,
  ThirteenthCreateFormData,
  ThirteenthDeleteResponse,
  ThirteenthDocumentResponse,
  ThirteenthGenerateFormData,
  ThirteenthGenerateResponse,
  ThirteenthGenerateResult,
  ThirteenthGetManyFormData,
  ThirteenthGetManyResponse,
  ThirteenthGetUniqueResponse,
  ThirteenthInclude,
  ThirteenthInstallmentDocument,
  ThirteenthMutationResponse,
  ThirteenthPayInstallmentFormData,
  ThirteenthUpdateFormData,
} from './dto/thirteenth.dto';

// statusOrder espelha a progressão OPEN→FIRST_PAID→SECOND_PAID→PAID (CANCELLED fora da escala).
const STATUS_ORDER: Record<THIRTEENTH_STATUS, number> = {
  [THIRTEENTH_STATUS.OPEN]: 1,
  [THIRTEENTH_STATUS.FIRST_PAID]: 2,
  [THIRTEENTH_STATUS.SECOND_PAID]: 3,
  [THIRTEENTH_STATUS.PAID]: 4,
  [THIRTEENTH_STATUS.CANCELLED]: 0,
};

interface ResolvedBase {
  baseRemuneration: number;
  baseSalary: number;
  averageVariables: number;
}

@Injectable()
export class ThirteenthService {
  private readonly logger = new Logger(ThirteenthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calc: ThirteenthCalculationService,
    private readonly repository: ThirteenthRepository,
  ) {}

  // ==========================================================================
  // Helpers de base / variáveis
  // ==========================================================================

  /** Salário-base do cargo CURRENT do usuário (MonetaryValue.current). */
  private resolveBaseSalary(user: any): number {
    const remunerations = user?.position?.remunerations ?? [];
    const current = remunerations.find((r: any) => r.current) ?? remunerations[0];
    return current ? Number(current.value) : 0;
  }

  /**
   * Média de variáveis do ano: (HE 50/100 + adicional noturno + DSR) das folhas
   * do ano + bonificação líquida (Bonus.netBonus), dividida pelo número de meses
   * com folha (mínimo 1 para evitar divisão por zero). Integra a base do 13º
   * (Súmula 45/253 TST — reflexos de habituais na gratificação natalina).
   */
  private async resolveAverageVariables(
    userId: string,
    year: number,
    tx?: PrismaTransaction,
  ): Promise<number> {
    const client = tx ?? this.prisma;

    const payrolls = await client.payroll.findMany({
      where: { userId, year },
      select: {
        overtime50Amount: true,
        overtime100Amount: true,
        nightDifferentialAmount: true,
        dsrAmount: true,
      },
    });

    const bonuses = await client.bonus.findMany({
      where: { userId, year },
      select: { netBonus: true },
    });

    let variableTotal = 0;
    for (const p of payrolls) {
      variableTotal += Number(p.overtime50Amount ?? 0);
      variableTotal += Number(p.overtime100Amount ?? 0);
      variableTotal += Number(p.nightDifferentialAmount ?? 0);
      variableTotal += Number(p.dsrAmount ?? 0);
    }
    for (const b of bonuses) {
      variableTotal += Number(b.netBonus ?? 0);
    }

    const monthsWithData = Math.max(1, payrolls.length);
    const averagePayrollVariables = variableTotal / monthsWithData;

    return roundCurrency(averagePayrollVariables);
  }

  private async resolveBase(
    user: any,
    year: number,
    tx?: PrismaTransaction,
  ): Promise<ResolvedBase> {
    const baseSalary = this.resolveBaseSalary(user);
    const averageVariables = await this.resolveAverageVariables(user.id, year, tx);
    return {
      baseSalary,
      averageVariables,
      baseRemuneration: roundCurrency(baseSalary + averageVariables),
    };
  }

  private currentContractOf(user: any): any | null {
    return user?.currentContract ?? null;
  }

  private admissionDateOf(user: any): Date | null {
    const contract = this.currentContractOf(user);
    if (contract?.admissionDate) return new Date(contract.admissionDate);
    return null;
  }

  /**
   * Computa avos + parcelas para um usuário/ano. Usado tanto pela criação quanto
   * pela geração em lote e pelos documentos.
   */
  private async computeForUser(
    user: any,
    year: number,
    referenceDate: Date | null,
    overrides?: { avos?: number; baseRemuneration?: number | null },
  ): Promise<{
    avos: number;
    base: ResolvedBase;
    installments: ThirteenthInstallmentsResult;
  }> {
    const admissionDate = this.admissionDateOf(user);

    const avos =
      overrides?.avos ?? this.calc.computeAvos({ admissionDate, year, referenceDate });

    const base = await this.resolveBase(user, year);
    const baseRemuneration =
      overrides?.baseRemuneration != null ? overrides.baseRemuneration : base.baseRemuneration;

    const installments = this.calc.computeInstallments({
      baseRemuneration,
      avos,
      dependentsCount: user?.dependentsCount ?? 0,
      allowSimplifiedDeduction: user?.hasSimplifiedDeduction ?? true,
      year,
    });

    return {
      avos,
      base: { ...base, baseRemuneration },
      installments,
    };
  }

  private toEntity(record: any): Thirteenth {
    return {
      ...record,
      baseRemuneration: record.baseRemuneration != null ? Number(record.baseRemuneration) : null,
      firstInstallment: record.firstInstallment != null ? Number(record.firstInstallment) : null,
      secondInstallment:
        record.secondInstallment != null ? Number(record.secondInstallment) : null,
      inss: record.inss != null ? Number(record.inss) : null,
      irrf: record.irrf != null ? Number(record.irrf) : null,
    } as Thirteenth;
  }

  // ==========================================================================
  // CRUD + list
  // ==========================================================================

  async findMany(query: ThirteenthGetManyFormData): Promise<ThirteenthGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit ?? 20;
      const skip = (page - 1) * take;

      const where = (query.where as any) ?? {};
      if (query.year != null && where.year === undefined) where.year = query.year;
      if (query.userId && where.userId === undefined) where.userId = query.userId;
      if (query.status && where.status === undefined) where.status = query.status;

      const orderBy = (query.orderBy as any) ?? [{ year: 'desc' }, { statusOrder: 'asc' }];
      const include = (query.include as any) ?? undefined;

      const [totalRecords, data] = await Promise.all([
        this.repository.count(where),
        this.repository.findMany({ where, orderBy, include, skip, take }),
      ]);

      const totalPages = Math.ceil(totalRecords / take) || 1;

      return {
        success: true,
        message: 'Décimos terceiros carregados com sucesso.',
        data: (data as any[]).map(d => this.toEntity(d)),
        meta: {
          totalRecords,
          page,
          take,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao buscar décimos terceiros:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar décimos terceiros. Por favor, tente novamente.',
      );
    }
  }

  async findById(id: string, include?: ThirteenthInclude): Promise<ThirteenthGetUniqueResponse> {
    try {
      const record = await this.repository.findById(id, include as any);
      if (!record) {
        throw new NotFoundException('13º salário não encontrado.');
      }
      return {
        success: true,
        message: '13º salário carregado com sucesso.',
        data: this.toEntity(record),
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao buscar 13º salário por ID:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar 13º salário. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Cria um 13º para um usuário/ano. Se avos/baseRemuneration não forem
   * informados, são calculados a partir do contrato CURRENT + histórico.
   */
  async create(
    data: ThirteenthCreateFormData,
    include?: ThirteenthInclude,
  ): Promise<ThirteenthMutationResponse> {
    try {
      const user = await this.loadUser(data.userId);
      if (!user) throw new NotFoundException('Colaborador não encontrado.');

      const contract = this.currentContractOf(user);
      const contractId = data.contractId ?? contract?.id ?? null;

      const existing = await this.repository.findByUserYearContract(
        data.userId,
        data.year,
        contractId,
      );
      if (existing) {
        throw new BadRequestException(
          `Já existe um 13º de ${data.year} para este colaborador/vínculo.`,
        );
      }

      const { avos, base, installments } = await this.computeForUser(user, data.year, null, {
        avos: data.avos,
        baseRemuneration: data.baseRemuneration ?? undefined,
      });

      const created = await this.repository.create(
        {
          userId: data.userId,
          contractId,
          year: data.year,
          avos,
          baseRemuneration: base.baseRemuneration,
          firstInstallment: installments.firstInstallment,
          secondInstallment: installments.secondInstallment,
          inss: installments.inss,
          irrf: installments.irrf,
          status: THIRTEENTH_STATUS.OPEN,
          statusOrder: STATUS_ORDER[THIRTEENTH_STATUS.OPEN],
          notes: data.notes ?? null,
        },
        include as any,
      );

      return {
        success: true,
        message: '13º salário criado com sucesso.',
        data: this.toEntity(created),
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      this.logger.error('Erro ao criar 13º salário:', error);
      throw new InternalServerErrorException(
        'Erro ao criar 13º salário. Por favor, tente novamente.',
      );
    }
  }

  async update(
    id: string,
    data: ThirteenthUpdateFormData,
    include?: ThirteenthInclude,
  ): Promise<ThirteenthMutationResponse> {
    try {
      const existing = await this.repository.findById(id);
      if (!existing) throw new NotFoundException('13º salário não encontrado.');

      if (data.status) {
        this.assertStatusTransition(existing.status as THIRTEENTH_STATUS, data.status);
      }

      const updateData: any = {};

      // Recalcula parcelas quando avos/base mudam.
      const recompute =
        data.avos !== undefined ||
        (data.baseRemuneration !== undefined && data.baseRemuneration !== null);

      if (recompute) {
        const user = await this.loadUser(existing.userId);
        if (!user) throw new NotFoundException('Colaborador não encontrado.');

        const { avos, base, installments } = await this.computeForUser(
          user,
          existing.year,
          null,
          {
            avos: data.avos ?? existing.avos,
            baseRemuneration:
              data.baseRemuneration !== undefined
                ? data.baseRemuneration
                : existing.baseRemuneration != null
                  ? Number(existing.baseRemuneration)
                  : undefined,
          },
        );
        updateData.avos = avos;
        updateData.baseRemuneration = base.baseRemuneration;
        updateData.firstInstallment = installments.firstInstallment;
        updateData.secondInstallment = installments.secondInstallment;
        updateData.inss = installments.inss;
        updateData.irrf = installments.irrf;
      }

      if (data.notes !== undefined) updateData.notes = data.notes ?? null;
      if (data.status) {
        updateData.status = data.status;
        updateData.statusOrder = STATUS_ORDER[data.status];
      }

      const updated = await this.repository.update(id, updateData, include as any);

      return {
        success: true,
        message: '13º salário atualizado com sucesso.',
        data: this.toEntity(updated),
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      this.logger.error('Erro ao atualizar 13º salário:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar 13º salário. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string): Promise<ThirteenthDeleteResponse> {
    try {
      const existing = await this.repository.findById(id);
      if (!existing) throw new NotFoundException('13º salário não encontrado.');
      await this.repository.delete(id);
      return { success: true, message: '13º salário excluído com sucesso.' };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao excluir 13º salário:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir 13º salário. Por favor, tente novamente.',
      );
    }
  }

  // ==========================================================================
  // Pagamento de parcelas (transições de status)
  // ==========================================================================

  async payFirstInstallment(
    id: string,
    data: ThirteenthPayInstallmentFormData,
  ): Promise<ThirteenthMutationResponse> {
    return this.payInstallment(id, 1, data);
  }

  async paySecondInstallment(
    id: string,
    data: ThirteenthPayInstallmentFormData,
  ): Promise<ThirteenthMutationResponse> {
    return this.payInstallment(id, 2, data);
  }

  private async payInstallment(
    id: string,
    installment: 1 | 2,
    data: ThirteenthPayInstallmentFormData,
  ): Promise<ThirteenthMutationResponse> {
    try {
      const existing = await this.repository.findById(id);
      if (!existing) throw new NotFoundException('13º salário não encontrado.');

      const current = existing.status as THIRTEENTH_STATUS;
      const paidAt = data.paidAt ?? new Date();

      let nextStatus: THIRTEENTH_STATUS;
      const updateData: any = {};

      if (installment === 1) {
        if (current !== THIRTEENTH_STATUS.OPEN) {
          throw new BadRequestException('A 1ª parcela só pode ser paga quando o 13º está em aberto.');
        }
        nextStatus = THIRTEENTH_STATUS.FIRST_PAID;
        updateData.firstInstallmentDate = paidAt;
      } else {
        if (current !== THIRTEENTH_STATUS.FIRST_PAID && current !== THIRTEENTH_STATUS.SECOND_PAID) {
          throw new BadRequestException(
            'A 2ª parcela só pode ser paga após a 1ª parcela ter sido quitada.',
          );
        }
        // Quitar a 2ª encerra o 13º (PAID).
        nextStatus = THIRTEENTH_STATUS.PAID;
        updateData.secondInstallmentDate = paidAt;
      }

      this.assertStatusTransition(current, nextStatus);
      updateData.status = nextStatus;
      updateData.statusOrder = STATUS_ORDER[nextStatus];

      const updated = await this.repository.update(id, updateData);

      return {
        success: true,
        message: `${installment}ª parcela do 13º registrada como paga.`,
        data: this.toEntity(updated),
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      this.logger.error('Erro ao registrar pagamento de parcela do 13º:', error);
      throw new InternalServerErrorException(
        'Erro ao registrar pagamento de parcela. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Máquina de status: OPEN → FIRST_PAID → SECOND_PAID → PAID. CANCELLED a
   * partir de qualquer estado não-encerrado. Sem regressões.
   */
  private assertStatusTransition(from: THIRTEENTH_STATUS, to: THIRTEENTH_STATUS): void {
    if (from === to) return;
    const allowed: Record<THIRTEENTH_STATUS, THIRTEENTH_STATUS[]> = {
      [THIRTEENTH_STATUS.OPEN]: [
        THIRTEENTH_STATUS.FIRST_PAID,
        THIRTEENTH_STATUS.CANCELLED,
      ],
      [THIRTEENTH_STATUS.FIRST_PAID]: [
        THIRTEENTH_STATUS.SECOND_PAID,
        THIRTEENTH_STATUS.PAID,
        THIRTEENTH_STATUS.CANCELLED,
      ],
      [THIRTEENTH_STATUS.SECOND_PAID]: [THIRTEENTH_STATUS.PAID, THIRTEENTH_STATUS.CANCELLED],
      [THIRTEENTH_STATUS.PAID]: [],
      [THIRTEENTH_STATUS.CANCELLED]: [],
    };
    if (!allowed[from]?.includes(to)) {
      throw new BadRequestException(`Transição de status inválida: ${from} → ${to}.`);
    }
  }

  // ==========================================================================
  // Documentos pagáveis (recibos das parcelas)
  // ==========================================================================

  async getInstallmentDocument(
    id: string,
    installment: 1 | 2,
  ): Promise<ThirteenthDocumentResponse> {
    try {
      const record = await this.repository.findById(id);
      if (!record) throw new NotFoundException('13º salário não encontrado.');

      const avos = record.avos;
      const baseRemuneration =
        record.baseRemuneration != null ? Number(record.baseRemuneration) : 0;
      const fullEntitlement = roundCurrency((baseRemuneration / 12) * avos);

      let doc: ThirteenthInstallmentDocument;
      if (installment === 1) {
        const gross = record.firstInstallment != null ? Number(record.firstInstallment) : 0;
        doc = {
          installment: 1,
          year: record.year,
          userId: record.userId,
          userName: (record as any).user?.name,
          avos,
          baseRemuneration,
          fullEntitlement,
          grossInstallment: gross,
          inss: 0, // 1ª parcela NÃO tem descontos
          irrf: 0,
          netInstallment: gross,
          dueDate: new Date(record.year, 10, 30), // 30/Nov
          notes: record.notes ?? null,
        };
      } else {
        const gross = record.secondInstallment != null ? Number(record.secondInstallment) : 0;
        const inss = record.inss != null ? Number(record.inss) : 0;
        const irrf = record.irrf != null ? Number(record.irrf) : 0;
        doc = {
          installment: 2,
          year: record.year,
          userId: record.userId,
          userName: (record as any).user?.name,
          avos,
          baseRemuneration,
          fullEntitlement,
          // secondInstallment armazenado já é líquido; bruto = líquido + descontos.
          grossInstallment: roundCurrency(gross + inss + irrf),
          inss,
          irrf,
          netInstallment: gross,
          dueDate: new Date(record.year, 11, 20), // 20/Dez
          notes: record.notes ?? null,
        };
      }

      return {
        success: true,
        message: `Recibo da ${installment}ª parcela gerado com sucesso.`,
        data: doc,
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao gerar recibo de parcela do 13º:', error);
      throw new InternalServerErrorException(
        'Erro ao gerar recibo de parcela. Por favor, tente novamente.',
      );
    }
  }

  // ==========================================================================
  // Geração em lote (todos os CLT ativos elegíveis)
  // ==========================================================================

  /**
   * Gera (ou recalcula) os registros de 13º do ano para todos os colaboradores
   * CLT com vínculo CURRENT em status elegível (EXPERIENCE/ACTIVE/NOTICE_PERIOD/
   * ON_LEAVE — i.e. não TERMINATED).
   */
  async generateForYear(data: ThirteenthGenerateFormData): Promise<ThirteenthGenerateResponse> {
    try {
      const { year } = data;
      const referenceDate = data.referenceDate ?? new Date(year, 11, 31);

      const users = await this.prisma.user.findMany({
        where: {
          currentEmployeeType: EMPLOYEE_TYPE.CLT,
          currentContractStatus: { not: CONTRACT_STATUS.TERMINATED },
          currentContractId: { not: null },
        },
        include: {
          position: { include: { remunerations: { where: { current: true } } } },
          currentContract: true,
        },
      });

      const result: ThirteenthGenerateResult = {
        year,
        created: 0,
        updated: 0,
        skipped: [],
        records: [],
      };

      for (const user of users) {
        try {
          const contract = this.currentContractOf(user);
          const contractId = contract?.id ?? null;
          const admissionDate = this.admissionDateOf(user);

          if (!admissionDate) {
            result.skipped.push({
              userId: user.id,
              userName: (user as any).name,
              reason: 'Vínculo sem data de admissão.',
            });
            continue;
          }

          const { avos, base, installments } = await this.computeForUser(
            user,
            year,
            referenceDate,
          );

          if (avos <= 0) {
            result.skipped.push({
              userId: user.id,
              userName: (user as any).name,
              reason: 'Sem avos no ano (admissão posterior ao período).',
            });
            continue;
          }

          const existing = await this.repository.findByUserYearContract(user.id, year, contractId);

          if (existing) {
            if (!data.recompute) {
              result.skipped.push({
                userId: user.id,
                userName: (user as any).name,
                reason: 'Registro já existe (use recompute para recalcular).',
              });
              continue;
            }
            // Recalcula valores; mantém status/datas de pagamento.
            const updated = await this.repository.update(existing.id, {
              avos,
              baseRemuneration: base.baseRemuneration,
              firstInstallment: installments.firstInstallment,
              secondInstallment: installments.secondInstallment,
              inss: installments.inss,
              irrf: installments.irrf,
            });
            result.updated++;
            result.records.push(this.toEntity(updated));
          } else {
            const created = await this.repository.create({
              userId: user.id,
              contractId,
              year,
              avos,
              baseRemuneration: base.baseRemuneration,
              firstInstallment: installments.firstInstallment,
              secondInstallment: installments.secondInstallment,
              inss: installments.inss,
              irrf: installments.irrf,
              status: THIRTEENTH_STATUS.OPEN,
              statusOrder: STATUS_ORDER[THIRTEENTH_STATUS.OPEN],
              notes: null,
            });
            result.created++;
            result.records.push(this.toEntity(created));
          }
        } catch (innerError) {
          this.logger.error(`Erro ao gerar 13º para usuário ${user.id}:`, innerError);
          result.skipped.push({
            userId: user.id,
            userName: (user as any).name,
            reason: 'Erro ao calcular o 13º deste colaborador.',
          });
        }
      }

      const total = result.created + result.updated;
      return {
        success: true,
        message: `Geração de 13º/${year} concluída: ${result.created} criados, ${result.updated} recalculados, ${result.skipped.length} ignorados.`,
        data: result,
      };
    } catch (error: unknown) {
      this.logger.error('Erro na geração em lote de 13º:', error);
      throw new InternalServerErrorException(
        'Erro ao gerar 13º em lote. Por favor, tente novamente.',
      );
    }
  }

  // ==========================================================================
  // Projeção read-only para a Previsão de Saídas (financeiro)
  // ==========================================================================

  /**
   * Projeção AGREGADA (sem linhas por colaborador) do 13º de um ano para a
   * "Previsão de Saídas". READ-ONLY: não altera nenhum registro nem o contrato
   * deste módulo.
   *
   * Convenção de valor BRUTO (espelha a folha mensal, que reporta grossSalary):
   *  - 1ª parcela: `firstInstallment` (já é bruta — não tem descontos);
   *  - 2ª parcela: bruto = `secondInstallment` (armazenado líquido) + inss + irrf
   *    (idêntico ao recibo em getInstallmentDocument).
   *
   * Dedup por status (não conta parcela já paga):
   *  - 1ª parcela sai apenas enquanto status = OPEN (depois de FIRST_PAID já foi paga);
   *  - 2ª parcela sai enquanto status ∈ {OPEN, FIRST_PAID, SECOND_PAID} (PAID = quitada).
   *  - CANCELLED nunca entra.
   *
   * Vencimentos: 1ª ≤ 30/Nov, 2ª ≤ 20/Dez (ou a respectiva data de parcela, se
   * já registrada).
   */
  async getForecastProjection(year: number): Promise<{
    year: number;
    november: number;
    december: number;
    firstInstallmentTotal: number;
    secondInstallmentTotal: number;
    recordCount: number;
  }> {
    const records = await this.prisma.thirteenth.findMany({
      where: {
        year,
        status: { not: THIRTEENTH_STATUS.CANCELLED },
      },
      select: {
        status: true,
        firstInstallment: true,
        secondInstallment: true,
        inss: true,
        irrf: true,
        firstInstallmentDate: true,
        secondInstallmentDate: true,
      },
    });

    let firstInstallmentTotal = 0;
    let secondInstallmentTotal = 0;
    let recordCount = 0;

    for (const r of records) {
      const status = r.status as THIRTEENTH_STATUS;
      let counted = false;

      // 1ª parcela ainda em aberto somente em OPEN.
      if (status === THIRTEENTH_STATUS.OPEN) {
        firstInstallmentTotal += r.firstInstallment != null ? Number(r.firstInstallment) : 0;
        counted = true;
      }
      // 2ª parcela em aberto até a quitação total (PAID).
      if (status !== THIRTEENTH_STATUS.PAID) {
        const net = r.secondInstallment != null ? Number(r.secondInstallment) : 0;
        const inss = r.inss != null ? Number(r.inss) : 0;
        const irrf = r.irrf != null ? Number(r.irrf) : 0;
        secondInstallmentTotal += roundCurrency(net + inss + irrf);
        counted = true;
      }
      if (counted) recordCount += 1;
    }

    return {
      year,
      // 1ª → Novembro (≤30/Nov), 2ª → Dezembro (≤20/Dez).
      november: roundCurrency(firstInstallmentTotal),
      december: roundCurrency(secondInstallmentTotal),
      firstInstallmentTotal: roundCurrency(firstInstallmentTotal),
      secondInstallmentTotal: roundCurrency(secondInstallmentTotal),
      recordCount,
    };
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private async loadUser(userId: string): Promise<any | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        position: { include: { remunerations: { where: { current: true } } } },
        currentContract: true,
      },
    });
  }
}
