import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { CustomerRepository, PrismaTransaction } from './repositories/customer.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { FileService } from '@modules/common/file/file.service';
import { unlinkSync, existsSync } from 'fs';
import type {
  CustomerBatchCreateResponse,
  CustomerBatchDeleteResponse,
  CustomerBatchUpdateResponse,
  CustomerCreateResponse,
  CustomerDeleteResponse,
  CustomerGetManyResponse,
  CustomerGetUniqueResponse,
  CustomerUpdateResponse,
  CustomerMergeResponse,
} from '../../../types';
import { Customer } from '../../../types';
import type {
  CustomerCreateFormData,
  CustomerQuickCreateFormData,
  CustomerUpdateFormData,
  CustomerGetManyFormData,
  CustomerBatchCreateFormData,
  CustomerBatchUpdateFormData,
  CustomerBatchDeleteFormData,
  CustomerInclude,
  CustomerMergeFormData,
} from '../../../schemas/customer';
import { isValidCNPJ, isValidCPF, isValidPhone } from '../../../utils';

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  // Fields to track for changelog
  private readonly TRACKED_FIELDS = [
    'fantasyName',
    'corporateName',
    'cnpj',
    'cpf',
    'email',
    'phones',
    'address',
    'addressNumber',
    'addressComplement',
    'neighborhood',
    'city',
    'state',
    'zipCode',
    'site',
    'tags',
    'logoId',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly customerRepository: CustomerRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
  ) {}

  /**
   * Validar cliente completo
   */
  private async validateCustomer(
    data: Partial<CustomerCreateFormData | CustomerUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;
    // Validar fantasyName (obrigatório e único)
    if (data.fantasyName) {
      const existingFantasyName = await transaction.customer.findFirst({
        where: {
          fantasyName: data.fantasyName,
          ...(existingId && { NOT: { id: existingId } }),
        },
      });
      if (existingFantasyName) {
        throw new BadRequestException('Nome fantasia já está em uso.');
      }
    }

    // Validar CPF (opcional e único)
    if (data.cpf) {
      // Validar formato do CPF primeiro
      if (!isValidCPF(data.cpf)) {
        throw new BadRequestException('CPF inválido.');
      }

      // Verificar unicidade usando o repository method
      const existingCpf = await this.customerRepository.findByCpf(data.cpf, tx);
      if (existingCpf && existingCpf.id !== existingId) {
        throw new BadRequestException('CPF já está cadastrado.');
      }
    }

    // Validar CNPJ (opcional e único)
    if (data.cnpj) {
      // Validar formato do CNPJ primeiro
      if (!isValidCNPJ(data.cnpj)) {
        throw new BadRequestException('CNPJ inválido.');
      }

      // Verificar unicidade usando o repository method
      const existingCnpj = await this.customerRepository.findByCnpj(data.cnpj, tx);
      if (existingCnpj && existingCnpj.id !== existingId) {
        throw new BadRequestException('CNPJ já está cadastrado.');
      }
    }

    // CPF and CNPJ are now optional - customers can be created without them

    // Validar email (formato e unicidade)
    if (data.email) {
      // Validar formato do email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        throw new BadRequestException('Email inválido.');
      }

      // Verificar unicidade do email
      const existingEmail = await this.customerRepository.findByEmail(data.email, tx);
      if (existingEmail && existingEmail.id !== existingId) {
        throw new BadRequestException('Email já está cadastrado.');
      }
    }

    // Validar array de telefones
    if (data.phones && Array.isArray(data.phones)) {
      for (let i = 0; i < data.phones.length; i++) {
        const phone = data.phones[i];
        if (phone && !isValidPhone(phone)) {
          throw new BadRequestException(`Telefone inválido na posição ${i + 1}.`);
        }
      }
    }

    // Validar URL do site
    if (data.site) {
      try {
        new URL(data.site);
      } catch {
        throw new BadRequestException('URL do site inválida.');
      }
    }

    // Validar estado
    if (data.state && data.state.length !== 2) {
      throw new BadRequestException('Estado deve ter 2 caracteres.');
    }

    // CEP validation is now handled by the schema/frontend
    // Accept CEP with or without hyphen
  }

  /**
   * Process logo file upload
   */
  private async processLogoFile(
    logoFile: Express.Multer.File,
    customerId: string,
    customerName: string,
    tx: PrismaTransaction,
    userId?: string,
  ): Promise<string> {
    try {
      const fileRecord = await this.fileService.createFromUploadWithTransaction(
        tx,
        logoFile,
        'customerLogo',
        userId,
        {
          entityId: customerId,
          entityType: 'CUSTOMER',
          customerName,
        },
      );
      this.logger.log(`Logo file created and moved to WebDAV: ${fileRecord.path}`);
      return fileRecord.id;
    } catch (error: any) {
      this.logger.error(`Failed to process logo file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Buscar muitos clientes com filtros
   */
  async findMany(query: CustomerGetManyFormData): Promise<CustomerGetManyResponse> {
    try {
      const result = await this.customerRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Clientes carregados com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao buscar clientes:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar clientes. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Buscar um cliente por ID
   */
  async findById(id: string, include?: CustomerInclude): Promise<CustomerGetUniqueResponse> {
    try {
      const customer = await this.customerRepository.findById(id, { include });

      if (!customer) {
        throw new NotFoundException('Cliente não encontrado.');
      }

      return { success: true, data: customer, message: 'Cliente carregado com sucesso.' };
    } catch (error: unknown) {
      this.logger.error('Erro ao buscar cliente por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao buscar cliente. Por favor, tente novamente.');
    }
  }

  /**
   * Criar novo cliente
   */
  async create(
    data: CustomerCreateFormData,
    include?: CustomerInclude,
    userId?: string,
    logoFile?: Express.Multer.File,
  ): Promise<CustomerCreateResponse> {
    try {
      const customer = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar cliente completo
        await this.validateCustomer(data, undefined, tx);

        // Process logo file if provided
        let logoId: string | null = data.logoId || null;
        if (logoFile) {
          try {
            logoId = await this.processLogoFile(logoFile, '', data.fantasyName, tx, userId);
          } catch (fileError: any) {
            this.logger.error(`Logo file processing failed: ${fileError.message}`);
            if (existsSync(logoFile.path)) {
              unlinkSync(logoFile.path);
            }
            throw new BadRequestException('Erro ao processar arquivo de logo.');
          }
        }

        // Criar o cliente
        const newCustomer = await this.customerRepository.createWithTransaction(
          tx,
          { ...data, logoId },
          {
            include,
          },
        );

        // Registrar no changelog usando o helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.CUSTOMER,
          entityId: newCustomer.id,
          action: CHANGE_ACTION.CREATE,
          entity: newCustomer,
          reason: 'Novo cliente cadastrado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newCustomer;
      });

      return {
        success: true,
        message: 'Cliente criado com sucesso.',
        data: customer,
      };
    } catch (error: unknown) {
      // Clean up uploaded file on error
      if (logoFile && existsSync(logoFile.path)) {
        try {
          unlinkSync(logoFile.path);
        } catch (cleanupError) {
          this.logger.warn(`Failed to cleanup uploaded file: ${logoFile.path}`);
        }
      }

      this.logger.error('Erro ao criar cliente:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar cliente. Por favor, tente novamente.');
    }
  }

  /**
   * Quick create customer with minimal data
   */
  async quickCreate(
    data: CustomerQuickCreateFormData,
    include?: CustomerInclude,
    userId?: string,
  ): Promise<CustomerCreateResponse> {
    try {
      const customer = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Check if fantasy name already exists
        const existingFantasyName = await tx.customer.findFirst({
          where: {
            fantasyName: data.fantasyName,
          },
        });

        if (existingFantasyName) {
          throw new BadRequestException('Nome fantasia já está em uso.');
        }

        // Create the customer with minimal data
        const newCustomer = await this.customerRepository.createWithTransaction(
          tx,
          {
            fantasyName: data.fantasyName,
            cpf: null, // CPF is optional for quick create
            cnpj: null,
            corporateName: null,
            email: null,
            address: null,
            addressNumber: null,
            addressComplement: null,
            neighborhood: null,
            city: null,
            state: null,
            zipCode: null,
            site: null,
            phones: [],
            tags: [],
            logoId: null,
          },
          { include },
        );

        // Log the creation
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.CUSTOMER,
          entityId: newCustomer.id,
          action: CHANGE_ACTION.CREATE,
          entity: newCustomer,
          reason: 'Novo cliente cadastrado (criação rápida)',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newCustomer;
      });

      return {
        success: true,
        message: 'Cliente criado com sucesso.',
        data: customer,
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao criar cliente rápido:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar cliente. Por favor, tente novamente.');
    }
  }

  /**
   * Atualizar cliente
   */
  async update(
    id: string,
    data: CustomerUpdateFormData,
    include?: CustomerInclude,
    userId?: string,
    logoFile?: Express.Multer.File,
  ): Promise<CustomerUpdateResponse> {
    try {
      const updatedCustomer = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar cliente existente
        const existingCustomer = await this.customerRepository.findByIdWithTransaction(tx, id);

        if (!existingCustomer) {
          throw new NotFoundException('Cliente não encontrado.');
        }

        // Validar cliente completo
        await this.validateCustomer(data, id, tx);

        // Process logo file if provided
        let logoId: string | null | undefined = data.logoId;
        if (logoFile) {
          try {
            // Delete old logo file before uploading new one
            if (existingCustomer.logoId) {
              try {
                await this.fileService.delete(existingCustomer.logoId, userId);
                this.logger.log(`Deleted old logo file: ${existingCustomer.logoId}`);
              } catch (deleteError: any) {
                this.logger.warn(`Failed to delete old logo: ${deleteError.message}`);
              }
            }

            // Process new logo file
            logoId = await this.processLogoFile(logoFile, id, existingCustomer.fantasyName, tx, userId);
          } catch (fileError: any) {
            this.logger.error(`Logo file processing failed: ${fileError.message}`);
            if (existsSync(logoFile.path)) {
              unlinkSync(logoFile.path);
            }
            throw new BadRequestException('Erro ao processar arquivo de logo.');
          }
        }

        // Update customer with logo ID if new file was uploaded
        const updateData = logoFile ? { ...data, logoId } : data;
        const updatedCustomer = await this.customerRepository.updateWithTransaction(tx, id, updateData, {
          include,
        });

        // Registrar mudanças no changelog com rastreamento por campo
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.CUSTOMER,
          entityId: id,
          oldEntity: existingCustomer,
          newEntity: updatedCustomer,
          fieldsToTrack: this.TRACKED_FIELDS,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedCustomer;
      });

      return {
        success: true,
        message: 'Cliente atualizado com sucesso.',
        data: updatedCustomer,
      };
    } catch (error: unknown) {
      // Clean up uploaded file on error
      if (logoFile && existsSync(logoFile.path)) {
        try {
          unlinkSync(logoFile.path);
        } catch (cleanupError) {
          this.logger.warn(`Failed to cleanup uploaded file: ${logoFile.path}`);
        }
      }

      this.logger.error('Erro ao atualizar cliente:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar cliente. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir cliente
   */
  async delete(id: string, userId?: string): Promise<CustomerDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const customer = await this.customerRepository.findByIdWithTransaction(tx, id);

        if (!customer) {
          throw new NotFoundException('Cliente não encontrado.');
        }

        // Registrar exclusão usando o helper
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.CUSTOMER,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: customer,
          reason: 'Cliente excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await this.customerRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Cliente excluído com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao excluir cliente:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir cliente. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Criar múltiplos clientes
   */
  async batchCreate(
    data: CustomerBatchCreateFormData,
    include?: CustomerInclude,
    userId?: string,
  ): Promise<CustomerBatchCreateResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulCreations: Customer[] = [];
        const failedCreations: Array<{
          index: number;
          error: string;
          errorCode: string;
          data: CustomerCreateFormData;
        }> = [];

        // Processar cada cliente individualmente para validação detalhada
        for (let index = 0; index < data.customers.length; index++) {
          const customerData = data.customers[index];
          try {
            // Validar cliente completo
            await this.validateCustomer(customerData, undefined, tx);

            // Criar o cliente
            const newCustomer = await this.customerRepository.createWithTransaction(
              tx,
              customerData,
              { include },
            );
            successfulCreations.push(newCustomer);

            // Registrar no changelog usando o helper
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.CUSTOMER,
              entityId: newCustomer.id,
              action: CHANGE_ACTION.CREATE,
              entity: newCustomer,
              reason: 'Cliente criado em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              userId: userId || null,
              transaction: tx,
            });
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Erro ao criar cliente.';
            const errorName = error instanceof Error ? error.name : 'UNKNOWN_ERROR';
            failedCreations.push({
              index,
              error: errorMessage,
              errorCode: errorName,
              data: customerData,
            });
          }
        }

        return {
          success: successfulCreations,
          failed: failedCreations,
          totalCreated: successfulCreations.length,
          totalFailed: failedCreations.length,
        };
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 cliente criado com sucesso'
          : `${result.totalCreated} clientes criados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchCreateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((failedItem, index) => ({
          index: failedItem.index || index,
          id: undefined, // No ID for failed creations
          error: failedItem.error,
          errorCode: failedItem.errorCode,
          data: failedItem.data,
        })),
        totalProcessed: result.totalCreated + result.totalFailed,
        totalSuccess: result.totalCreated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: unknown) {
      this.logger.error('Erro na criação em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar clientes em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplos clientes
   */
  async batchUpdate(
    data: CustomerBatchUpdateFormData,
    include?: CustomerInclude,
    userId?: string,
  ): Promise<CustomerBatchUpdateResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulUpdates: Customer[] = [];
        const failedUpdates: Array<{
          index: number;
          id: string;
          error: string;
          errorCode: string;
          data: CustomerUpdateFormData & { id: string };
        }> = [];

        // Processar cada atualização individualmente para validação detalhada
        for (let index = 0; index < data.customers.length; index++) {
          const { id, data: updateData } = data.customers[index];
          try {
            // Buscar cliente existente
            const existingCustomer = await this.customerRepository.findByIdWithTransaction(tx, id);
            if (!existingCustomer) {
              throw new NotFoundException('Cliente não encontrado.');
            }

            // Validar cliente completo
            await this.validateCustomer(updateData, id, tx);

            // Atualizar o cliente
            const updatedCustomer = await this.customerRepository.updateWithTransaction(
              tx,
              id,
              updateData,
              { include },
            );
            successfulUpdates.push(updatedCustomer);

            // Registrar no changelog com rastreamento por campo
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.CUSTOMER,
              entityId: id,
              oldEntity: existingCustomer,
              newEntity: updatedCustomer,
              fieldsToTrack: this.TRACKED_FIELDS,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : 'Erro ao atualizar cliente.';
            const errorName = error instanceof Error ? error.name : 'UNKNOWN_ERROR';
            failedUpdates.push({
              index,
              id,
              error: errorMessage,
              errorCode: errorName,
              data: { id, ...updateData },
            });
          }
        }

        return {
          success: successfulUpdates,
          failed: failedUpdates,
          totalUpdated: successfulUpdates.length,
          totalFailed: failedUpdates.length,
        };
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 cliente atualizado com sucesso'
          : `${result.totalUpdated} clientes atualizados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((failedItem, index) => ({
          index: failedItem.index || index,
          id: failedItem.id,
          error: failedItem.error,
          errorCode: failedItem.errorCode,
          data: failedItem.data,
        })),
        totalProcessed: result.totalUpdated + result.totalFailed,
        totalSuccess: result.totalUpdated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: unknown) {
      this.logger.error('Erro na atualização em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar clientes em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Batch delete customers
   */
  async batchDelete(
    data: CustomerBatchDeleteFormData,
    userId?: string,
  ): Promise<CustomerBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar clientes antes de excluir para o changelog
        const customers = await this.customerRepository.findByIdsWithTransaction(
          tx,
          data.customerIds,
        );

        // Registrar exclusões usando o helper
        for (const customer of customers) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.CUSTOMER,
            entityId: customer.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: customer,
            reason: 'Cliente excluído em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            userId: userId || null,
            transaction: tx,
          });
        }

        return this.customerRepository.deleteManyWithTransaction(tx, data.customerIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 cliente excluído com sucesso'
          : `${result.totalDeleted} clientes excluídos com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchDeleteResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((failedItem, index) => ({
          index: failedItem.index || index,
          id: failedItem.id,
          error: failedItem.error,
          errorCode: failedItem.errorCode,
          data: failedItem.data,
        })),
        totalProcessed: result.totalDeleted + result.totalFailed,
        totalSuccess: result.totalDeleted,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na exclusão em lote. Tente novamente.',
      );
    }
  }

  /**
   * Merge multiple customers into one
   */
  async merge(
    data: CustomerMergeFormData,
    include?: CustomerInclude,
    userId?: string,
  ): Promise<CustomerMergeResponse> {
    try {
      const mergedCustomer = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // 1. Fetch target customer and source customers
        const targetCustomer = await tx.customer.findUnique({
          where: { id: data.targetCustomerId },
          include: {
            tasks: true,
            logo: true,
          },
        });

        if (!targetCustomer) {
          throw new NotFoundException(`Cliente alvo com ID ${data.targetCustomerId} não encontrado`);
        }

        const sourceCustomers = await tx.customer.findMany({
          where: { id: { in: data.sourceCustomerIds } },
          include: {
            tasks: true,
            logo: true,
          },
        });

        if (sourceCustomers.length !== data.sourceCustomerIds.length) {
          const foundIds = sourceCustomers.map(c => c.id);
          const missingIds = data.sourceCustomerIds.filter(id => !foundIds.includes(id));
          throw new NotFoundException(`Clientes de origem não encontrados: ${missingIds.join(', ')}`);
        }

        // 2. Merge tasks - move all tasks from source customers to target
        for (const sourceCustomer of sourceCustomers) {
          if (sourceCustomer.tasks.length > 0) {
            await tx.task.updateMany({
              where: { customerId: sourceCustomer.id },
              data: { customerId: data.targetCustomerId },
            });
          }
        }

        // 3. Delete source customers BEFORE updating target to avoid unique constraint conflicts
        for (const sourceCustomer of sourceCustomers) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.CUSTOMER,
            entityId: sourceCustomer.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: sourceCustomer,
            reason: `Cliente removido após mesclagem com ${targetCustomer.fantasyName}`,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            userId: userId || null,
            transaction: tx,
          });

          await tx.customer.delete({
            where: { id: sourceCustomer.id },
          });
        }

        // 4. Apply conflict resolutions to target customer (after source deletion to avoid unique constraints)
        const updateData: any = {};
        if (data.conflictResolutions) {
          Object.keys(data.conflictResolutions).forEach(field => {
            updateData[field] = data.conflictResolutions![field];
          });
        }

        // Update target customer with resolved conflicts
        if (Object.keys(updateData).length > 0) {
          await tx.customer.update({
            where: { id: data.targetCustomerId },
            data: updateData,
          });
        }

        // 5. Log the merge operation
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.CUSTOMER,
          entityId: data.targetCustomerId,
          action: CHANGE_ACTION.UPDATE,
          entity: targetCustomer,
          reason: `Cliente mesclado com ${sourceCustomers.length} outro(s) cliente(s): ${sourceCustomers.map(c => c.fantasyName).join(', ')}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        // 6. Return the merged customer
        const mergedCustomer = await this.customerRepository.findByIdWithTransaction(
          tx,
          data.targetCustomerId,
          { include },
        );

        return mergedCustomer;
      });

      return {
        success: true,
        message: `${data.sourceCustomerIds.length + 1} clientes mesclados com sucesso.`,
        data: mergedCustomer,
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao mesclar clientes:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao mesclar clientes. Por favor, tente novamente.',
      );
    }
  }
}
