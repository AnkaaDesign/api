// api/src/modules/production/task-pricing/task-pricing.service.ts

import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TaskPricingRepository } from './repositories/task-pricing.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { InvoiceGenerationService } from '@modules/financial/invoice/invoice-generation.service';
import { NfseEmissionScheduler } from '@modules/integrations/nfse/nfse-emission.scheduler';
import type {
  TaskPricingCreateFormData,
  TaskPricingUpdateFormData,
  TaskPricingGetManyFormData,
} from '@schemas/task-pricing';
import type {
  TaskPricingGetManyResponse,
  TaskPricingGetUniqueResponse,
  TaskPricingCreateResponse,
  TaskPricingUpdateResponse,
  TaskPricingDeleteResponse,
  TaskPricingBatchCreateResponse,
  TaskPricingBatchUpdateResponse,
  TaskPricingBatchDeleteResponse,
  TaskPricing,
} from '@types';
import {
  TASK_PRICING_STATUS,
  CHANGE_LOG_ENTITY_TYPE,
  CHANGE_LOG_ACTION,
  ENTITY_TYPE,
  CHANGE_ACTION,
  INSTALLMENT_STATUS,
} from '@constants';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import { CHANGE_TRIGGERED_BY } from '@constants';
import { logPricingServiceChanges } from '@modules/common/changelog/utils/pricing-service-changelog';
import { serializeChangelogValue } from '@modules/common/changelog/utils/serialize-changelog-value';

/**
 * Service for managing TaskPricing entities
 * Handles CRUD operations, status management, and business logic
 */
@Injectable()
export class TaskPricingService {
  private readonly logger = new Logger(TaskPricingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taskPricingRepository: TaskPricingRepository,
    private readonly changeLogService: ChangeLogService,
    @Inject(forwardRef(() => InvoiceGenerationService))
    private readonly invoiceGenerationService: InvoiceGenerationService,
    private readonly nfseEmissionScheduler: NfseEmissionScheduler,
  ) {}

  /**
   * Find many pricings with filtering, pagination, and sorting
   */
  async findMany(query: TaskPricingGetManyFormData): Promise<TaskPricingGetManyResponse> {
    try {
      const result = await this.taskPricingRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Orçamentos carregados com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error('Error finding task pricings:', error);
      throw new InternalServerErrorException('Erro ao carregar orçamentos.');
    }
  }

  /**
   * Find unique pricing by ID
   */
  async findUnique(id: string, include?: any): Promise<TaskPricingGetUniqueResponse> {
    try {
      const pricing = await this.taskPricingRepository.findById(id, include);

      if (!pricing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      return {
        success: true,
        data: pricing,
        message: 'Orçamento carregado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error finding task pricing ${id}:`, error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Erro ao carregar orçamento.');
    }
  }

  /**
   * Find pricing by task ID
   */
  async findByTaskId(taskId: string): Promise<TaskPricingGetUniqueResponse> {
    try {
      const pricing = await this.taskPricingRepository.findByTaskId(taskId);

      // Return null data when no pricing exists (not an error - task may not have pricing yet)
      if (!pricing) {
        return {
          success: true,
          data: null,
          message: 'Nenhum orçamento encontrado para esta tarefa.',
        };
      }

      return {
        success: true,
        data: pricing,
        message: 'Orçamento carregado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error finding pricing for task ${taskId}:`, error);
      throw new InternalServerErrorException('Erro ao carregar orçamento.');
    }
  }

  /**
   * Create new pricing
   */
  async create(
    data: TaskPricingCreateFormData,
    userId: string,
  ): Promise<TaskPricingCreateResponse> {
    try {
      // Validate task exists
      const task = await this.prisma.task.findUnique({
        where: { id: data.taskId },
      });

      if (!task) {
        throw new BadRequestException('Tarefa não encontrada.');
      }

      // Validate customerConfigs customer IDs
      const customerIds = data.customerConfigs.map(c => c.customerId);
      const customers = await this.prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true },
      });

      if (customers.length !== customerIds.length) {
        throw new BadRequestException(
          'Um ou mais clientes selecionados para faturamento não foram encontrados.',
        );
      }

      // NOTE: Each task has its own independent pricing record.
      // When copying pricing (e.g. via copyFromTask), a new TaskPricing is created as a deep copy.

      // Validate services exist
      if (!data.services || data.services.length === 0) {
        throw new BadRequestException('Pelo menos um serviço é obrigatório.');
      }

      // If single customer config with subtotal=0, compute from services
      if (data.customerConfigs.length === 1 && !data.customerConfigs[0].subtotal) {
        const servicesTotal = data.services.reduce((sum, s) => sum + (s.amount || 0), 0);
        data.customerConfigs[0].subtotal = servicesTotal;
        if (!data.customerConfigs[0].total) {
          data.customerConfigs[0].total = servicesTotal;
        }
      }

      // Compute aggregate subtotal/total from customerConfigs
      const aggregateSubtotal = data.customerConfigs.reduce((sum, c) => sum + (c.subtotal || 0), 0);
      const aggregateTotal = data.customerConfigs.reduce((sum, c) => sum + (c.total || 0), 0);

      // Create pricing with items in transaction
      const pricing = await this.prisma.$transaction(async tx => {
        // Get next budget number (auto-increment)
        const maxBudgetNumber = await tx.taskPricing.aggregate({
          _max: { budgetNumber: true },
        });
        const nextBudgetNumber = (maxBudgetNumber._max.budgetNumber || 0) + 1;

        const newPricing = await tx.taskPricing.create({
          data: {
            budgetNumber: nextBudgetNumber,
            subtotal: aggregateSubtotal,
            total: aggregateTotal,
            expiresAt: data.expiresAt,
            status: data.status || TASK_PRICING_STATUS.PENDING,
            statusOrder: 1,
            // Guarantee Terms
            guaranteeYears: data.guaranteeYears || null,
            customGuaranteeText: data.customGuaranteeText || null,
            // Layout File
            ...(data.layoutFileId && {
              layoutFile: { connect: { id: data.layoutFileId } },
            }),
            simultaneousTasks: data.simultaneousTasks || null,
            // Customer Configs (per-customer billing) — always at least 1
            customerConfigs: {
              create: data.customerConfigs.map(config => ({
                customer: { connect: { id: config.customerId } },
                subtotal: config.subtotal || 0,
                discountType: config.discountType || 'NONE',
                discountValue: config.discountValue || null,
                total: config.total || 0,
                customPaymentText: config.customPaymentText || null,
                responsibleId: config.responsibleId || null,
                discountReference: config.discountReference || null,
                paymentCondition: config.paymentCondition || null,
                downPaymentDate: config.downPaymentDate ? new Date(config.downPaymentDate as any) : null,
              })),
            },
            services: {
              create: data.services.map((service, index) => ({
                amount: service.amount || 0,
                description: service.description || '',
                observation: service.observation || null,
                shouldSync: service.shouldSync !== undefined ? service.shouldSync : true,
                position: index,
                ...(service.invoiceToCustomerId && {
                  invoiceToCustomer: { connect: { id: service.invoiceToCustomerId } },
                }),
              })),
            },
          },
          include: {
            services: {
              orderBy: { position: 'asc' },
              include: {
                invoiceToCustomer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
            task: true,
            layoutFile: true,
            customerConfigs: {
              include: {
                customer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
          },
        });

        // Generate installments for each customer config from paymentCondition
        for (const config of data.customerConfigs) {
          const customerConfig = newPricing.customerConfigs.find(
            (cc: any) => cc.customerId === config.customerId,
          );
          if (customerConfig) {
            const installments = (config.installments && config.installments.length > 0)
              ? config.installments
              : this.generateInstallmentsFromCondition(
                config.paymentCondition || null,
                config.downPaymentDate || null,
                config.total || 0,
              );
            if (installments.length > 0) {
              await tx.installment.createMany({
                data: installments.map(inst => ({
                  customerConfigId: customerConfig.id,
                  number: inst.number,
                  dueDate: inst.dueDate,
                  amount: inst.amount,
                  paidAmount: 0,
                  status: 'PENDING' as const,
                })),
              });
            }
          }
        }

        // Connect the task to this pricing (one-to-one via Task.pricingId FK)
        await tx.task.update({
          where: { id: data.taskId },
          data: { pricingId: newPricing.id },
        });

        // Log change
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK_PRICING,
          entityId: newPricing.id,
          action: CHANGE_ACTION.CREATE,
          userId,
          reason: 'Criação de orçamento',
          newValue: serializeChangelogValue({
            id: newPricing.id,
            budgetNumber: nextBudgetNumber,
            subtotal: data.subtotal,
            total: data.total,
            status: data.status || TASK_PRICING_STATUS.PENDING,
            services: data.services.map(service => ({
              description: service.description,
              amount: service.amount,
              observation: service.observation || null,
            })),
          }),
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          triggeredById: userId,
          transaction: tx,
        });

        return tx.taskPricing.findUnique({
          where: { id: newPricing.id },
          include: {
            services: {
              orderBy: { position: 'asc' },
              include: {
                invoiceToCustomer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
            task: true,
            layoutFile: true,
            customerConfigs: {
              include: {
                customer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
                installments: { orderBy: { number: 'asc' } },
                responsible: { select: { id: true, name: true, role: true } },
                customerSignature: true,
              },
            },
          },
        });
      });

      return {
        success: true,
        data: pricing as any,
        message: 'Orçamento criado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error('Error creating task pricing:', error);
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Erro ao criar orçamento.');
    }
  }

  /**
   * Update existing pricing
   */
  async update(
    id: string,
    data: TaskPricingUpdateFormData,
    userId: string,
  ): Promise<TaskPricingUpdateResponse> {
    try {
      const existing = await this.taskPricingRepository.findById(id, {
        include: {
          services: { orderBy: { position: 'asc' } },
          customerConfigs: true,
        },
      });

      if (!existing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      // Validate customerConfigs customer IDs if provided
      if (data.customerConfigs && data.customerConfigs.length > 0) {
        const customerIds = data.customerConfigs.map(c => c.customerId);
        const customers = await this.prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true },
        });

        if (customers.length !== customerIds.length) {
          throw new BadRequestException(
            'Um ou mais clientes selecionados para faturamento não foram encontrados.',
          );
        }
      }

      // If single customer config with subtotal=0, compute from services
      if (data.customerConfigs?.length === 1 && !data.customerConfigs[0].subtotal && data.services?.length) {
        const servicesTotal = data.services.reduce((sum, s) => sum + (s.amount || 0), 0);
        data.customerConfigs[0].subtotal = servicesTotal;
        if (!data.customerConfigs[0].total) {
          data.customerConfigs[0].total = servicesTotal;
        }
      }

      // Compute aggregate subtotal/total from customerConfigs if provided
      const computeAggregates = data.customerConfigs && data.customerConfigs.length > 0;
      const aggregateSubtotal = computeAggregates
        ? data.customerConfigs!.reduce((sum, c) => sum + (c.subtotal || 0), 0)
        : undefined;
      const aggregateTotal = computeAggregates
        ? data.customerConfigs!.reduce((sum, c) => sum + (c.total || 0), 0)
        : undefined;

      // Update pricing with items in transaction
      const updated = await this.prisma.$transaction(async tx => {
        const updatedPricing = await tx.taskPricing.update({
          where: { id },
          data: {
            ...(aggregateSubtotal !== undefined && { subtotal: aggregateSubtotal }),
            ...(aggregateTotal !== undefined && { total: aggregateTotal }),
            ...(data.expiresAt !== undefined && { expiresAt: data.expiresAt }),
            ...(data.status !== undefined && {
              status: data.status,
              statusOrder: this.getStatusOrder(data.status as TASK_PRICING_STATUS),
            }),
            // Guarantee Terms
            ...(data.guaranteeYears !== undefined && { guaranteeYears: data.guaranteeYears }),
            ...(data.customGuaranteeText !== undefined && {
              customGuaranteeText: data.customGuaranteeText,
            }),
            // Layout File
            ...(data.layoutFileId !== undefined && {
              layoutFile: data.layoutFileId
                ? { connect: { id: data.layoutFileId } }
                : { disconnect: true },
            }),
            ...(data.simultaneousTasks !== undefined && {
              simultaneousTasks: data.simultaneousTasks,
            }),
            ...(data.services && {
              services: {
                deleteMany: {},
                create: data.services.map((service, index) => ({
                  amount: service.amount || 0,
                  description: service.description || '',
                  observation: service.observation || null,
                  shouldSync: service.shouldSync !== undefined ? service.shouldSync : true,
                  position: index,
                  ...(service.invoiceToCustomerId && {
                    invoiceToCustomer: { connect: { id: service.invoiceToCustomerId } },
                  }),
                })),
              },
            }),
          },
          include: {
            services: {
              orderBy: { position: 'asc' },
              include: {
                invoiceToCustomer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
            task: true,
            layoutFile: true,
            customerConfigs: {
              include: {
                customer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
          },
        });

        // Track individual field changes
        const { trackAndLogFieldChanges } = await import(
          '@modules/common/changelog/utils/changelog-helpers'
        );

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TASK_PRICING,
          entityId: id,
          oldEntity: existing,
          newEntity: updatedPricing,
          fieldsToTrack: [
            'subtotal',
            'total',
            'expiresAt',
            'status',
            'guaranteeYears',
            'customGuaranteeText',
            'layoutFileId',
            'customForecastDays',
            'budgetNumber',
            'simultaneousTasks',
          ],
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION as any,
          transaction: tx,
        });

        // Handle customerConfigs changes
        if (data.customerConfigs !== undefined) {
          // Guard: prevent destructive customerConfig changes when invoices already exist
          const existingConfigIds = ((existing as any).customerConfigs || []).map((c: any) => c.id);
          if (existingConfigIds.length > 0) {
            const invoiceCount = await tx.invoice.count({
              where: { customerConfigId: { in: existingConfigIds } },
            });
            if (invoiceCount > 0) {
              throw new BadRequestException(
                'Não é possível alterar as configurações de clientes após a geração de faturas. Cancele as faturas primeiro.',
              );
            }
          }

          // Delete existing configs (cascades to installments) and recreate
          await tx.taskPricingCustomerConfig.deleteMany({ where: { pricingId: id } });
          if (data.customerConfigs.length > 0) {
            await tx.taskPricingCustomerConfig.createMany({
              data: data.customerConfigs.map(config => ({
                pricingId: id,
                customerId: config.customerId,
                subtotal: config.subtotal || 0,
                discountType: config.discountType || 'NONE',
                discountValue: config.discountValue || null,
                total: config.total || 0,
                customPaymentText: config.customPaymentText || null,
                responsibleId: config.responsibleId || null,
                discountReference: config.discountReference || null,
                paymentCondition: config.paymentCondition || null,
                downPaymentDate: config.downPaymentDate ? new Date(config.downPaymentDate as any) : null,
              })),
            });

            // Re-create installments for each config
            const newConfigs = await tx.taskPricingCustomerConfig.findMany({
              where: { pricingId: id },
            });
            this.logger.log(`[UPDATE] Re-creating installments for ${data.customerConfigs.length} config(s), found ${newConfigs.length} DB config(s)`);
            for (const config of data.customerConfigs) {
              const dbConfig = newConfigs.find((c: any) => c.customerId === config.customerId);
              this.logger.log(`[UPDATE] Config customer=${config.customerId}: dbConfig=${dbConfig?.id || 'NOT FOUND'}, paymentCondition=${config.paymentCondition}, downPaymentDate=${config.downPaymentDate}, total=${config.total}, installments=${JSON.stringify(config.installments)}`);
              if (dbConfig) {
                const installments = (config.installments && config.installments.length > 0)
                  ? config.installments
                  : this.generateInstallmentsFromCondition(
                    config.paymentCondition || null,
                    config.downPaymentDate || null,
                    config.total || 0,
                  );
                this.logger.log(`[UPDATE] Generated ${installments.length} installment(s) for config ${dbConfig.id}: ${JSON.stringify(installments)}`);
                if (installments.length > 0) {
                  await tx.installment.createMany({
                    data: installments.map(inst => ({
                      customerConfigId: dbConfig.id,
                      number: inst.number,
                      dueDate: inst.dueDate instanceof Date ? inst.dueDate : new Date(inst.dueDate),
                      amount: inst.amount,
                      paidAmount: 0,
                      status: 'PENDING' as const,
                    })),
                  });
                  this.logger.log(`[UPDATE] Created ${installments.length} installment(s) for config ${dbConfig.id}`);
                }
              }
            }
          }

          // Clear orphaned service assignments: if a customer was removed from configs,
          // any services assigned to that customer via invoiceToCustomerId should be set to null
          const validCustomerIds = data.customerConfigs.map(c => c.customerId);
          await tx.taskPricingService.updateMany({
            where: {
              pricingId: id,
              invoiceToCustomerId: {
                notIn: validCustomerIds.length > 0 ? validCustomerIds : ['__none__'],
                not: null,
              },
            },
            data: {
              invoiceToCustomerId: null,
            },
          });

          // Log customer configs change
          const oldConfigs = (existing as any).customerConfigs || [];
          const oldConfigNames = oldConfigs
            .map((c: any) => c.customer?.fantasyName || c.customerId)
            .join(', ') || 'Nenhum';
          const newConfigNames = data.customerConfigs
            .map((c: any) => c.customerId)
            .join(', ') || 'Nenhum';

          if (oldConfigNames !== newConfigNames) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK_PRICING,
              entityId: id,
              action: CHANGE_LOG_ACTION.UPDATE as any,
              field: 'customerConfigs',
              oldValue: oldConfigNames,
              newValue: newConfigNames,
              userId: userId || '',
              reason: 'Atualização de configurações de clientes para faturamento',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: userId,
              transaction: tx,
            });
          }
        }

        // Track pricing services changes (per-service granular tracking)
        if (data.services !== undefined) {
          const oldServices = (existing as any).services || [];
          const newServices = (updatedPricing as any).services || [];

          // Log per-service changes (added, removed, field updates)
          await logPricingServiceChanges({
            changeLogService: this.changeLogService,
            pricingId: id,
            oldServices,
            newServices,
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            transaction: tx,
          });

          // Also keep a bulk snapshot for backward compatibility (field: 'services_snapshot')
          const formatService = (service: any) =>
            `${service.description || ''}: R$ ${Number(service.amount || 0).toFixed(2)}`;
          const oldServicesSummary = oldServices.map(formatService).sort();
          const newServicesSummary = newServices.map(formatService).sort();
          const servicesChanged =
            oldServicesSummary.length !== newServicesSummary.length ||
            oldServicesSummary.some((s: string, i: number) => s !== newServicesSummary[i]);

          if (servicesChanged) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK_PRICING,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'services_snapshot',
              oldValue: serializeChangelogValue({
                count: oldServices.length,
                services: oldServices.map((service: any) => ({
                  description: service.description,
                  amount: Number(service.amount),
                  observation: service.observation,
                })),
              }),
              newValue: serializeChangelogValue({
                count: newServices.length,
                services: newServices.map((service: any) => ({
                  description: service.description,
                  amount: Number(service.amount),
                  observation: service.observation,
                })),
              }),
              userId: userId || '',
              reason: 'Atualização dos serviços do orçamento (snapshot)',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: userId,
              transaction: tx,
            });
          }

          // Fix R$ 0,00 snapshot: update pricingId changelog when real amounts are set
          const allOldAmountsZero = oldServices.every((service: any) => Number(service.amount) === 0);
          const anyNewAmountNonZero = newServices.some((service: any) => Number(service.amount) > 0);

          if (allOldAmountsZero && anyNewAmountNonZero) {
            const updatedWithTask = await tx.taskPricing.findUnique({
              where: { id },
              include: { task: { select: { id: true } }, services: { orderBy: { position: 'asc' } } },
            });

            const taskRef = updatedWithTask?.task;
            if (taskRef) {
              const pricingIdLog = await tx.changeLog.findFirst({
                where: { entityType: 'TASK', entityId: taskRef.id, field: 'pricingId' },
                orderBy: { createdAt: 'desc' },
              });
              if (pricingIdLog) {
                const realSnapshot = serializeChangelogValue({
                  id,
                  budgetNumber: (updatedWithTask as any).budgetNumber,
                  subtotal: (updatedWithTask as any).subtotal,
                  total: (updatedWithTask as any).total,
                  status: (updatedWithTask as any).status,
                  services: updatedWithTask!.services.map(service => ({
                    description: service.description,
                    amount: Number(service.amount),
                    observation: service.observation,
                  })),
                });
                await tx.changeLog.update({ where: { id: pricingIdLog.id }, data: { newValue: realSnapshot } });
              }
            }
          }
        }

        return tx.taskPricing.findUnique({
          where: { id },
          include: {
            services: {
              orderBy: { position: 'asc' },
              include: {
                invoiceToCustomer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
            task: true,
            layoutFile: true,
            customerConfigs: {
              include: {
                customer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
                installments: { orderBy: { number: 'asc' } },
                responsible: { select: { id: true, name: true, role: true } },
                customerSignature: true,
              },
            },
          },
        });
      });

      return {
        success: true,
        data: updated as any,
        message: 'Orçamento atualizado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error updating task pricing ${id}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao atualizar orçamento.');
    }
  }

  /**
   * Delete pricing
   */
  async delete(id: string, userId: string): Promise<TaskPricingDeleteResponse> {
    try {
      const existing = await this.prisma.taskPricing.findUnique({
        where: { id },
        include: {
          services: { orderBy: { position: 'asc' } },
          task: { select: { id: true } },
          customerConfigs: { select: { id: true, customerId: true } },
        },
      });

      if (!existing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      // Store the full pricing data for changelog (enables rollback restoration)
      const pricingSnapshot = {
        id: existing.id,
        budgetNumber: existing.budgetNumber,
        subtotal: existing.subtotal,
        total: existing.total,
        expiresAt: existing.expiresAt,
        status: existing.status,
        guaranteeYears: existing.guaranteeYears,
        customGuaranteeText: existing.customGuaranteeText,
        customForecastDays: existing.customForecastDays,
        simultaneousTasks: existing.simultaneousTasks,
        layoutFileId: existing.layoutFileId,
        services: existing.services.map(service => ({
          description: service.description,
          amount: service.amount,
          observation: service.observation,
          shouldSync: service.shouldSync,
          position: service.position,
        })),
        customerConfigIds: existing.customerConfigs.map(c => c.customerId),
      };

      const taskId = existing.task?.id;

      await this.prisma.$transaction(async tx => {
        // Nullify pricingId on the associated task before deleting
        if (taskId) {
          await tx.task.update({
            where: { id: taskId },
            data: { pricingId: null },
          });

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TASK,
            entityId: taskId,
            action: CHANGE_ACTION.UPDATE,
            field: 'pricingId',
            oldValue: pricingSnapshot,
            newValue: null,
            userId,
            reason: 'Orçamento removido (exclusão do orçamento)',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            transaction: tx,
          });
        }

        await tx.taskPricing.delete({ where: { id } });

        // Log the pricing deletion itself
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK_PRICING,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldValue: pricingSnapshot,
          userId,
          reason: 'Exclusão de orçamento',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId,
          transaction: tx,
        });
      });

      return {
        success: true,
        message: 'Orçamento deletado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error deleting task pricing ${id}:`, error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Erro ao deletar orçamento.');
    }
  }

  /**
   * Update pricing status (approve/reject/cancel)
   */
  async updateStatus(
    id: string,
    status: TASK_PRICING_STATUS,
    userId: string,
  ): Promise<TaskPricingUpdateResponse> {
    try {
      const existing = await this.taskPricingRepository.findById(id);

      if (!existing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      // Validate status transition
      this.validateStatusTransition(existing.status as TASK_PRICING_STATUS, status);

      // Validate prerequisites for the target status
      await this.validateStatusPrerequisites(id, existing.status as TASK_PRICING_STATUS, status);

      // Update status
      const updated = await this.update(id, { status }, userId);

      return {
        success: true,
        data: updated.data,
        message: `Orçamento ${this.getStatusLabel(status)} com sucesso.`,
      };
    } catch (error: unknown) {
      this.logger.error(`Error updating pricing status ${id}:`, error);
      throw error;
    }
  }

  /**
   * Customer approves the budget
   */
  async budgetApprove(id: string, userId: string): Promise<TaskPricingUpdateResponse> {
    return this.updateStatus(id, TASK_PRICING_STATUS.BUDGET_APPROVED, userId);
  }

  /**
   * Financial verifies the pricing structure
   */
  async verify(id: string, userId: string): Promise<TaskPricingUpdateResponse> {
    return this.updateStatus(id, TASK_PRICING_STATUS.VERIFIED, userId);
  }

  /**
   * Commercial/admin final approval — triggers invoice + NFS-e generation
   */
  async internalApprove(id: string, userId: string): Promise<TaskPricingUpdateResponse> {
    this.logger.log(`[INTERNAL_APPROVE] Starting internal approval for pricing ${id} by user ${userId}`);

    // 1. Validate the pricing exists and prerequisites are met
    const existing = await this.taskPricingRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
    }
    this.validateStatusTransition(existing.status as TASK_PRICING_STATUS, TASK_PRICING_STATUS.INTERNAL_APPROVED);
    await this.validateStatusPrerequisites(id, existing.status as TASK_PRICING_STATUS, TASK_PRICING_STATUS.INTERNAL_APPROVED);

    // 2. Atomically claim the status transition (prevents concurrent approvals)
    // Only one request can win: the one that finds status=VERIFIED and sets it to INTERNAL_APPROVED
    const claimed = await this.prisma.taskPricing.updateMany({
      where: { id, status: TASK_PRICING_STATUS.VERIFIED },
      data: {
        status: TASK_PRICING_STATUS.INTERNAL_APPROVED,
        statusOrder: this.getStatusOrder(TASK_PRICING_STATUS.INTERNAL_APPROVED),
      },
    });
    if (claimed.count === 0) {
      throw new BadRequestException(
        'O orçamento não está mais no status Verificado. Pode ter sido aprovado por outra requisição simultânea.',
      );
    }

    this.logger.log(`[INTERNAL_APPROVE] Status atomically claimed to INTERNAL_APPROVED for pricing ${id}`);

    // Trigger invoice generation and auto-transition to UPCOMING
    // If anything fails, revert status back to VERIFIED so the user can retry
    try {
      const task = await this.prisma.task.findFirst({
        where: { pricingId: id },
        select: { id: true, name: true, serialNumber: true },
      });

      this.logger.log(`[INTERNAL_APPROVE] Task lookup result: ${task ? `found task ${task.id} (${task.name} #${task.serialNumber})` : 'NO TASK FOUND'}`);

      if (!task) {
        throw new InternalServerErrorException(
          `Nenhuma tarefa encontrada para o orçamento ${id}. Não é possível gerar faturas.`,
        );
      }

      this.logger.log(`[INTERNAL_APPROVE] Triggering invoice generation for task ${task.id}...`);
      const invoiceIds = await this.invoiceGenerationService.generateInvoicesForTask(
        task.id,
        userId,
      );
      this.logger.log(
        `[INTERNAL_APPROVE] Invoice generation complete: ${invoiceIds.length} invoice(s) created [${invoiceIds.join(', ')}]`,
      );

      if (invoiceIds.length === 0) {
        throw new InternalServerErrorException(
          `Nenhuma fatura foi gerada para o orçamento ${id}. Verifique a configuração de faturamento.`,
        );
      }

      // Register bank slips at Sicredi immediately (non-blocking — errors don't prevent status transition)
      this.logger.log(`[INTERNAL_APPROVE] Registering bank slips at Sicredi for ${invoiceIds.length} invoice(s)...`);
      try {
        await this.invoiceGenerationService.registerBankSlipsAtSicredi(invoiceIds);
      } catch (boletoError) {
        this.logger.warn(`[INTERNAL_APPROVE] Some bank slips failed to register at Sicredi (will be retried by scheduler): ${boletoError}`);
      }

      // Trigger NFS-e emission immediately (non-blocking — errors don't prevent status transition)
      this.logger.log(`[INTERNAL_APPROVE] Triggering NFS-e emission for pending documents...`);
      this.nfseEmissionScheduler.emitPendingNfses().catch((err) => {
        this.logger.warn(`[INTERNAL_APPROVE] NFS-e emission failed (will be retried by scheduler): ${err}`);
      });

      // Auto-transition to UPCOMING after successful invoice generation
      this.logger.log(`[INTERNAL_APPROVE] Auto-transitioning pricing ${id} to UPCOMING...`);
      await this.update(id, { status: TASK_PRICING_STATUS.UPCOMING } as any, userId);
      this.logger.log(`[INTERNAL_APPROVE] Pricing ${id} transitioned to UPCOMING successfully`);
    } catch (error) {
      this.logger.error(
        `[INTERNAL_APPROVE] Failed during invoice generation/transition for pricing ${id}: ${error}`,
      );
      if (error instanceof Error) {
        this.logger.error(`[INTERNAL_APPROVE] Stack trace: ${error.stack}`);
      }

      // Revert status back to VERIFIED so the pricing is not stuck at INTERNAL_APPROVED
      // Uses direct prisma update to bypass status transition validation (INTERNAL_APPROVED → VERIFIED is not normally allowed)
      try {
        this.logger.warn(`[INTERNAL_APPROVE] Rolling back pricing ${id} status from INTERNAL_APPROVED to VERIFIED...`);
        await this.prisma.taskPricing.update({
          where: { id },
          data: {
            status: TASK_PRICING_STATUS.VERIFIED,
            statusOrder: this.getStatusOrder(TASK_PRICING_STATUS.VERIFIED),
          },
        });
        this.logger.warn(`[INTERNAL_APPROVE] Rollback successful — pricing ${id} reverted to VERIFIED`);
      } catch (rollbackError) {
        this.logger.error(
          `[INTERNAL_APPROVE] CRITICAL: Failed to rollback pricing ${id} status to VERIFIED: ${rollbackError}`,
        );
      }

      // Propagate the error to the client
      if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Falha ao gerar faturas para o orçamento. O status foi revertido para Verificado. Erro: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      success: true,
      data: existing as any,
      message: 'Orçamento aprovado internamente com sucesso.',
    };
  }

  /**
   * Get approved price for a task
   */
  async getApprovedPriceForTask(taskId: string): Promise<number> {
    const pricing = await this.taskPricingRepository.findApprovedByTaskId(taskId);
    return pricing?.total || 0;
  }

  /**
   * Find expired pricings and optionally mark them
   */
  async findAndMarkExpired(): Promise<TaskPricing[]> {
    try {
      const expired = await this.taskPricingRepository.findExpired();

      this.logger.log(`Found ${expired.length} expired pricings`);

      return expired;
    } catch (error: unknown) {
      this.logger.error('Error finding expired pricings:', error);
      throw new InternalServerErrorException('Erro ao buscar orçamentos expirados.');
    }
  }

  // =====================
  // PUBLIC METHODS (No Authentication Required)
  // =====================

  /**
   * Find pricing for public view (customer budget page)
   * Only returns data if pricing is not expired (unless ignoreExpiration is true)
   * @param id - Pricing ID
   * @param ignoreExpiration - If true, returns pricing even if expired (for authenticated users)
   */
  async findPublic(id: string, ignoreExpiration = false): Promise<TaskPricingGetUniqueResponse> {
    try {
      const pricing = await this.prisma.taskPricing.findUnique({
        where: { id },
        include: {
          services: {
            orderBy: { position: 'asc' },
            include: {
              invoiceToCustomer: {
                select: { id: true, fantasyName: true, cnpj: true },
              },
            },
          },
          layoutFile: true,
          customerConfigs: {
            include: {
              customer: {
                select: { id: true, fantasyName: true, cnpj: true },
              },
              customerSignature: true,
              responsible: true,
            },
          },
          task: {
            include: {
              customer: true,
              truck: true,
              responsibles: true,
            },
          },
        },
      });

      if (!pricing) {
        throw new NotFoundException('Orçamento não encontrado.');
      }

      // Check if pricing is expired (skip check if user is authenticated)
      const now = new Date();
      if (!ignoreExpiration && new Date(pricing.expiresAt) < now) {
        throw new BadRequestException(
          'Este orçamento expirou e não está mais disponível para visualização.',
        );
      }

      return {
        success: true,
        data: pricing as any,
        message: 'Orçamento carregado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error finding public pricing ${id}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao carregar orçamento.');
    }
  }

  /**
   * Upload customer signature for pricing (public endpoint)
   * Only allows upload if pricing is not expired
   */
  async uploadCustomerSignature(
    id: string,
    file: Express.Multer.File,
    customerConfigId?: string,
  ): Promise<TaskPricingUpdateResponse> {
    try {
      const pricing = await this.prisma.taskPricing.findUnique({
        where: { id },
        include: {
          customerConfigs: {
            include: { customerSignature: true },
          },
        },
      });

      if (!pricing) {
        throw new NotFoundException('Orçamento não encontrado.');
      }

      // Check if pricing is expired
      const now = new Date();
      if (new Date(pricing.expiresAt) < now) {
        throw new BadRequestException(
          'Este orçamento expirou. Não é possível enviar a assinatura.',
        );
      }

      // Find the target customer config
      const targetConfig = customerConfigId
        ? pricing.customerConfigs.find(c => c.id === customerConfigId)
        : pricing.customerConfigs[0];

      if (!targetConfig) {
        throw new BadRequestException('Configuração de cliente não encontrada.');
      }

      // Create file record for signature
      const signatureFile = await this.prisma.file.create({
        data: {
          filename: file.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          path: file.path,
          size: file.size,
        },
      });

      // Update customer config with signature
      await this.prisma.taskPricingCustomerConfig.update({
        where: { id: targetConfig.id },
        data: {
          customerSignatureId: signatureFile.id,
        },
      });

      // Delete old signature file if it exists
      if (targetConfig.customerSignature) {
        await this.prisma.file
          .delete({
            where: { id: targetConfig.customerSignature.id },
          })
          .catch(() => {
            // Ignore errors when deleting old file
          });
      }

      // Re-fetch the full pricing
      const updated = await this.prisma.taskPricing.findUnique({
        where: { id },
        include: {
          services: true,
          layoutFile: true,
          customerConfigs: {
            include: {
              customer: { select: { id: true, fantasyName: true, cnpj: true } },
              customerSignature: true,
              responsible: true,
            },
          },
          task: {
            include: {
              customer: true,
            },
          },
        },
      });

      // Log signature changelog
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.TASK_PRICING,
        entityId: id,
        action: CHANGE_ACTION.UPDATE,
        field: 'customerSignatureId',
        oldValue: targetConfig.customerSignatureId || null,
        newValue: signatureFile.id,
        userId: null,
        reason: 'Assinatura do cliente enviada',
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
        triggeredById: null,
      });

      this.logger.log(`Customer signature uploaded for pricing ${id}, config ${targetConfig.id}`);

      return {
        success: true,
        data: updated as any,
        message: 'Assinatura enviada com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error uploading signature for pricing ${id}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao enviar assinatura.');
    }
  }

  /**
   * Validate status transition
   * @private
   */
  private validateStatusTransition(
    currentStatus: TASK_PRICING_STATUS,
    newStatus: TASK_PRICING_STATUS,
  ): void {
    const validTransitions: Record<string, string[]> = {
      [TASK_PRICING_STATUS.PENDING]: [TASK_PRICING_STATUS.BUDGET_APPROVED],
      [TASK_PRICING_STATUS.BUDGET_APPROVED]: [TASK_PRICING_STATUS.VERIFIED],
      [TASK_PRICING_STATUS.VERIFIED]: [TASK_PRICING_STATUS.INTERNAL_APPROVED],
      [TASK_PRICING_STATUS.INTERNAL_APPROVED]: [TASK_PRICING_STATUS.UPCOMING],
      [TASK_PRICING_STATUS.UPCOMING]: [TASK_PRICING_STATUS.PARTIAL],
      [TASK_PRICING_STATUS.PARTIAL]: [TASK_PRICING_STATUS.SETTLED, TASK_PRICING_STATUS.UPCOMING],
      [TASK_PRICING_STATUS.SETTLED]: [TASK_PRICING_STATUS.PARTIAL],
    };

    const allowed = validTransitions[currentStatus] || [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(`Transição de status inválida: ${currentStatus} → ${newStatus}`);
    }
  }

  /**
   * Validate prerequisites for a status transition.
   * Ensures required data exists before allowing certain status changes.
   * @private
   */
  private async validateStatusPrerequisites(
    pricingId: string,
    currentStatus: TASK_PRICING_STATUS,
    newStatus: TASK_PRICING_STATUS,
  ): Promise<void> {
    const transition = `${currentStatus}->${newStatus}`;

    switch (transition) {
      case `${TASK_PRICING_STATUS.PENDING}->${TASK_PRICING_STATUS.BUDGET_APPROVED}`:
      case `${TASK_PRICING_STATUS.BUDGET_APPROVED}->${TASK_PRICING_STATUS.VERIFIED}`: {
        // Must have at least one customerConfig with total > 0
        const configs = await this.prisma.taskPricingCustomerConfig.findMany({
          where: { pricingId },
          select: { total: true },
        });

        if (configs.length === 0) {
          throw new BadRequestException(
            'É necessário ter pelo menos uma configuração de cliente antes de avançar o status.',
          );
        }

        const hasPositiveTotal = configs.some(c => Number(c.total) > 0);
        if (!hasPositiveTotal) {
          throw new BadRequestException(
            'Pelo menos uma configuração de cliente deve ter um valor total maior que zero.',
          );
        }
        break;
      }

      case `${TASK_PRICING_STATUS.VERIFIED}->${TASK_PRICING_STATUS.INTERNAL_APPROVED}`: {
        // Each customerConfig must have valid paymentCondition and downPaymentDate
        const configs = await this.prisma.taskPricingCustomerConfig.findMany({
          where: { pricingId },
          select: {
            id: true,
            paymentCondition: true,
            downPaymentDate: true,
            customer: { select: { fantasyName: true } },
            installments: { select: { id: true } },
          },
        });

        if (configs.length === 0) {
          throw new BadRequestException(
            'É necessário ter pelo menos uma configuração de cliente antes de aprovar internamente.',
          );
        }

        for (const config of configs) {
          const customerName = config.customer?.fantasyName || 'Cliente';

          if (!config.paymentCondition) {
            throw new BadRequestException(
              `A condição de pagamento não foi definida para o cliente "${customerName}".`,
            );
          }

          if (config.paymentCondition === 'CUSTOM' && config.installments.length === 0) {
            throw new BadRequestException(
              `O cliente "${customerName}" possui condição de pagamento personalizada, mas não tem parcelas cadastradas.`,
            );
          }

          if (!config.downPaymentDate) {
            throw new BadRequestException(
              `A data de início de pagamento não foi definida para o cliente "${customerName}".`,
            );
          }
        }
        break;
      }

      case `${TASK_PRICING_STATUS.UPCOMING}->${TASK_PRICING_STATUS.PARTIAL}`: {
        // At least one installment must be PAID
        const paidCount = await this.prisma.installment.count({
          where: {
            customerConfig: { pricingId },
            status: INSTALLMENT_STATUS.PAID,
          },
        });

        if (paidCount === 0) {
          throw new BadRequestException(
            'É necessário que pelo menos uma parcela esteja paga para marcar como parcialmente pago.',
          );
        }
        break;
      }

      case `${TASK_PRICING_STATUS.PARTIAL}->${TASK_PRICING_STATUS.SETTLED}`: {
        // ALL installments must be PAID
        const unpaidCount = await this.prisma.installment.count({
          where: {
            customerConfig: { pricingId },
            status: { not: INSTALLMENT_STATUS.PAID },
          },
        });

        if (unpaidCount > 0) {
          throw new BadRequestException(
            `Ainda existem ${unpaidCount} parcela(s) não paga(s). Todas as parcelas devem estar pagas para liquidar o orçamento.`,
          );
        }
        break;
      }

      case `${TASK_PRICING_STATUS.SETTLED}->${TASK_PRICING_STATUS.PARTIAL}`: {
        // At least one installment must NOT be PAID (reversal scenario)
        const nonPaidCount = await this.prisma.installment.count({
          where: {
            customerConfig: { pricingId },
            status: { not: INSTALLMENT_STATUS.PAID },
          },
        });

        if (nonPaidCount === 0) {
          throw new BadRequestException(
            'Todas as parcelas estão pagas. Para reverter para parcial, é necessário que pelo menos uma parcela não esteja paga.',
          );
        }
        break;
      }

      // INTERNAL_APPROVED -> UPCOMING: automatic (done by internalApprove), no extra checks
      default:
        break;
    }
  }

  /**
   * Get Portuguese label for status
   * @private
   */
  private getStatusLabel(status: TASK_PRICING_STATUS): string {
    const labels: Record<string, string> = {
      [TASK_PRICING_STATUS.PENDING]: 'salvo como pendente',
      [TASK_PRICING_STATUS.BUDGET_APPROVED]: 'orçamento aprovado pelo cliente',
      [TASK_PRICING_STATUS.VERIFIED]: 'verificado pelo financeiro',
      [TASK_PRICING_STATUS.INTERNAL_APPROVED]: 'aprovado internamente',
      [TASK_PRICING_STATUS.UPCOMING]: 'com parcelas a vencer',
      [TASK_PRICING_STATUS.PARTIAL]: 'parcialmente pago',
      [TASK_PRICING_STATUS.SETTLED]: 'liquidado',
    };

    return labels[status] || 'atualizado';
  }

  /**
   * Get sort order for a given status
   */
  private getStatusOrder(status: TASK_PRICING_STATUS): number {
    const order: Record<string, number> = {
      [TASK_PRICING_STATUS.PENDING]: 1,
      [TASK_PRICING_STATUS.BUDGET_APPROVED]: 2,
      [TASK_PRICING_STATUS.VERIFIED]: 3,
      [TASK_PRICING_STATUS.INTERNAL_APPROVED]: 4,
      [TASK_PRICING_STATUS.UPCOMING]: 5,
      [TASK_PRICING_STATUS.PARTIAL]: 6,
      [TASK_PRICING_STATUS.SETTLED]: 7,
    };
    return order[status] || 1;
  }

  /**
   * Convert paymentCondition + downPaymentDate + total into installment records
   */
  private generateInstallmentsFromCondition(
    paymentCondition: string | null,
    downPaymentDate: Date | null | string,
    total: number,
  ): { number: number; dueDate: Date; amount: number }[] {
    this.logger.log(`[INSTALLMENTS] generateInstallmentsFromCondition: condition=${paymentCondition}, downPaymentDate=${downPaymentDate}, total=${total}`);

    // Validate total: must be a finite positive number
    if (!Number.isFinite(total) || total <= 0) {
      this.logger.log(`[INSTALLMENTS] Skipping: total is invalid (${total})`);
      return [];
    }

    if (!paymentCondition || paymentCondition === 'CUSTOM') {
      this.logger.log(`[INSTALLMENTS] Skipping: condition is ${paymentCondition}`);
      return [];
    }

    const conditionMap: Record<string, number> = {
      CASH: 1,
      INSTALLMENTS_2: 2,
      INSTALLMENTS_3: 3,
      INSTALLMENTS_4: 4,
      INSTALLMENTS_5: 5,
      INSTALLMENTS_6: 6,
      INSTALLMENTS_7: 7,
    };

    const totalInstallments = conditionMap[paymentCondition] || 1;

    // Validate downPaymentDate: fall back to current date if invalid
    let baseDate: Date;
    if (downPaymentDate) {
      const parsed = new Date(downPaymentDate);
      if (isNaN(parsed.getTime())) {
        this.logger.warn(`[INSTALLMENTS] Invalid downPaymentDate "${downPaymentDate}", falling back to current date`);
        baseDate = new Date();
      } else {
        baseDate = parsed;
      }
    } else {
      baseDate = new Date();
    }

    // Use integer math (cents) to avoid floating point rounding errors
    const totalCents = Math.round(total * 100);
    const baseCents = Math.floor(totalCents / totalInstallments);
    const installmentAmount = baseCents / 100;

    const installments: { number: number; dueDate: Date; amount: number }[] = [];
    for (let i = 0; i < totalInstallments; i++) {
      const dueDate = new Date(baseDate);
      dueDate.setDate(dueDate.getDate() + i * 20); // 20 days apart

      // Put remainder on the LAST installment so sum equals exactly the total
      const isLast = i === totalInstallments - 1;
      const amount = isLast
        ? (totalCents - baseCents * (totalInstallments - 1)) / 100
        : installmentAmount;

      installments.push({
        number: i + 1,
        dueDate,
        amount,
      });
    }

    return installments;
  }
}
