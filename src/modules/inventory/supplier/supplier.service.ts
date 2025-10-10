// supplier.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SupplierRepository, PrismaTransaction } from './repositories/supplier.repository';
import type {
  SupplierBatchCreateResponse,
  SupplierBatchDeleteResponse,
  SupplierBatchUpdateResponse,
  SupplierCreateResponse,
  SupplierDeleteResponse,
  SupplierGetManyResponse,
  SupplierGetUniqueResponse,
  SupplierUpdateResponse,
} from '../../../types';
import type {
  SupplierCreateFormData,
  SupplierUpdateFormData,
  SupplierGetManyFormData,
  SupplierBatchCreateFormData,
  SupplierBatchUpdateFormData,
  SupplierBatchDeleteFormData,
  SupplierInclude,
} from '../../../schemas/supplier';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
import { isValidCNPJ, isValidPhone } from '../../../utils/validators';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { FileService } from '@modules/common/file/file.service';
import { unlinkSync, existsSync } from 'fs';

@Injectable()
export class SupplierService {
  private readonly logger = new Logger(SupplierService.name);

  // Define fields to track for supplier changes
  private readonly SUPPLIER_FIELDS_TO_TRACK = [
    'fantasyName',
    'corporateName',
    'cnpj',
    'email',
    'phones',
    'site',
    'representativeName',
    'address',
    'number',
    'complement',
    'neighborhood',
    'city',
    'state',
    'zipCode',
    'country',
    'status',
    'statusOrder',
    'observations',
    'logoId',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly supplierRepository: SupplierRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
  ) {}

  /**
   * Validar fornecedor completo
   */
  private async validateSupplier(
    data: Partial<SupplierCreateFormData | SupplierUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validar nome fantasia (obrigatório e único)
    if (data.fantasyName) {
      const existingByFantasyName = await transaction.supplier.findFirst({
        where: {
          fantasyName: data.fantasyName,
          ...(existingId && { id: { not: existingId } }),
        },
      });

      if (existingByFantasyName) {
        throw new BadRequestException('Nome fantasia já está em uso.');
      }
    }

    // Validar CNPJ (obrigatório para fornecedor e único)
    if (data.cnpj !== undefined && data.cnpj !== null) {
      // Only validate if CNPJ is provided and not empty
      if (data.cnpj !== '') {
        // Validar formato do CNPJ primeiro
        if (!isValidCNPJ(data.cnpj)) {
          throw new BadRequestException('CNPJ inválido.');
        }

        // Verificar unicidade usando o repository method
        const existingByCnpj = await this.supplierRepository.findByCnpj(data.cnpj, tx);
        if (existingByCnpj && existingByCnpj.id !== existingId) {
          throw new BadRequestException('CNPJ já está cadastrado.');
        }
      }
    }

    // Validar email (opcional e único)
    if (data.email) {
      // Validar formato do email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        throw new BadRequestException('Email inválido.');
      }

      // Verificar unicidade usando o repository method
      const existingByEmail = await this.supplierRepository.findByEmail(data.email, tx);
      if (existingByEmail && existingByEmail.id !== existingId) {
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

    // Validar estado brasileiro
    if (data.state) {
      const validStates = [
        'AC',
        'AL',
        'AP',
        'AM',
        'BA',
        'CE',
        'DF',
        'ES',
        'GO',
        'MA',
        'MT',
        'MS',
        'MG',
        'PA',
        'PB',
        'PR',
        'PE',
        'PI',
        'RJ',
        'RN',
        'RS',
        'RO',
        'RR',
        'SC',
        'SP',
        'SE',
        'TO',
      ];
      if (!validStates.includes(data.state)) {
        throw new BadRequestException('Estado inválido.');
      }
    }

    // CEP validation is now handled by the schema/frontend
    // Accept CEP with or without hyphen

    // Garantir que fornecedor tem informações de endereço válidas
    if (!existingId) {
      // Para novos fornecedores, verificar se tem pelo menos cidade e estado
      if (!data.city || !data.state) {
        throw new BadRequestException('Cidade e estado são obrigatórios para fornecedores.');
      }
    }
  }

  /**
   * Buscar muitos fornecedores com filtros
   */
  async findMany(query: SupplierGetManyFormData): Promise<SupplierGetManyResponse> {
    try {
      const result = await this.supplierRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Fornecedores carregados com sucesso',
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao buscar fornecedores:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar fornecedores. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Buscar um fornecedor por ID
   */
  async findById(id: string, include?: SupplierInclude): Promise<SupplierGetUniqueResponse> {
    try {
      const supplier = await this.supplierRepository.findById(id, { include });

      if (!supplier) {
        throw new NotFoundException('Fornecedor não encontrado.');
      }

      return { success: true, data: supplier, message: 'Fornecedor carregado com sucesso' };
    } catch (error: unknown) {
      this.logger.error('Erro ao buscar fornecedor por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar fornecedor. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Process and save logo file to WebDAV
   */
  private async processLogoFile(
    logoFile: Express.Multer.File,
    supplierId: string,
    supplierName: string,
    tx: PrismaTransaction,
    userId?: string,
  ): Promise<string> {
    try {
      // Use centralized file service to create file with proper transaction handling
      const fileRecord = await this.fileService.createFromUploadWithTransaction(
        tx,
        logoFile,
        'supplierLogo',
        userId,
        {
          entityId: supplierId,
          entityType: 'SUPPLIER',
          supplierName,
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
   * Criar novo fornecedor
   */
  async create(
    data: SupplierCreateFormData,
    include?: SupplierInclude,
    userId?: string,
    logoFile?: Express.Multer.File,
  ): Promise<SupplierCreateResponse> {
    try {
      const supplier = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar fornecedor completo
        await this.validateSupplier(data, undefined, tx);

        // Process logo file if provided
        let logoId: string | null = data.logoId || null;
        if (logoFile) {
          try {
            logoId = await this.processLogoFile(
              logoFile,
              '', // We'll update this after supplier creation
              data.fantasyName,
              tx,
              userId,
            );
          } catch (fileError: any) {
            this.logger.error(`Logo file processing failed: ${fileError.message}`);
            // Clean up uploaded file
            if (existsSync(logoFile.path)) {
              unlinkSync(logoFile.path);
            }
            throw new BadRequestException(
              'Erro ao processar arquivo de logo. Por favor, tente novamente.',
            );
          }
        }

        // Criar o fornecedor with logo ID
        const newSupplier = await this.supplierRepository.createWithTransaction(
          tx,
          { ...data, logoId },
          {
            include,
          },
        );

        // Registrar criação no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SUPPLIER,
          entityId: newSupplier.id,
          action: CHANGE_ACTION.CREATE,
          entity: newSupplier,
          reason: `Novo fornecedor cadastrado: ${data.fantasyName}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newSupplier;
      });

      return {
        success: true,
        message: 'Fornecedor criado com sucesso',
        data: supplier,
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

      this.logger.error('Erro ao criar fornecedor:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar fornecedor. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar fornecedor
   */
  async update(
    id: string,
    data: SupplierUpdateFormData,
    include?: SupplierInclude,
    userId?: string,
    logoFile?: Express.Multer.File,
  ): Promise<SupplierUpdateResponse> {
    try {
      const updatedSupplier = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar fornecedor existente
        const existingSupplier = await this.supplierRepository.findByIdWithTransaction(tx, id);

        if (!existingSupplier) {
          throw new NotFoundException('Fornecedor não encontrado. Verifique se o ID está correto.');
        }

        // Validar fornecedor completo
        await this.validateSupplier(data, id, tx);

        // Process logo file if provided
        let logoId: string | null | undefined = data.logoId;
        if (logoFile) {
          try {
            // Delete old logo file before uploading new one
            if (existingSupplier.logoId) {
              try {
                await this.fileService.delete(existingSupplier.logoId, userId);
                this.logger.log(`Deleted old logo file: ${existingSupplier.logoId}`);
              } catch (deleteError: any) {
                // Log but don't fail - old file might already be deleted
                this.logger.warn(
                  `Failed to delete old logo file ${existingSupplier.logoId}: ${deleteError.message}`,
                );
              }
            }

            // Process new logo file
            logoId = await this.processLogoFile(
              logoFile,
              id,
              existingSupplier.fantasyName,
              tx,
              userId,
            );
          } catch (fileError: any) {
            this.logger.error(`Logo file processing failed: ${fileError.message}`);
            // Clean up uploaded file
            if (existsSync(logoFile.path)) {
              unlinkSync(logoFile.path);
            }
            throw new BadRequestException(
              'Erro ao processar arquivo de logo. Por favor, tente novamente.',
            );
          }
        }

        // Atualizar o fornecedor with logo ID if a new file was uploaded
        const updateData = logoFile ? { ...data, logoId } : data;
        const updatedSupplier = await this.supplierRepository.updateWithTransaction(tx, id, updateData, {
          include,
        });

        // Registrar mudanças individuais de campos no changelog
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SUPPLIER,
          entityId: id,
          oldEntity: existingSupplier,
          newEntity: updatedSupplier,
          fieldsToTrack: this.SUPPLIER_FIELDS_TO_TRACK,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedSupplier;
      });

      return {
        success: true,
        message: 'Fornecedor atualizado com sucesso',
        data: updatedSupplier,
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

      this.logger.error('Erro ao atualizar fornecedor:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar fornecedor. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir fornecedor
   */
  async delete(id: string, userId?: string): Promise<SupplierDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const supplier = await this.supplierRepository.findByIdWithTransaction(tx, id);

        if (!supplier) {
          throw new NotFoundException('Fornecedor não encontrado. Verifique se o ID está correto.');
        }

        // Verificar dependências antes da exclusão
        const orderCount = await tx.order.count({ where: { supplierId: id } });
        if (orderCount > 0) {
          throw new BadRequestException(
            'Não é possível excluir fornecedor com pedidos associados. Transfira os pedidos primeiro.',
          );
        }

        const itemCount = await tx.item.count({ where: { supplierId: id } });
        if (itemCount > 0) {
          throw new BadRequestException(
            'Não é possível excluir fornecedor com itens associados. Transfira os itens primeiro.',
          );
        }

        // Registrar exclusão no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SUPPLIER,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: supplier,
          reason: `Fornecedor excluído: ${supplier.fantasyName}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await this.supplierRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Fornecedor excluído com sucesso',
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao excluir fornecedor:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir fornecedor. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Criar múltiplos fornecedores
   */
  async batchCreate(
    data: SupplierBatchCreateFormData,
    include?: SupplierInclude,
    userId?: string,
  ): Promise<SupplierBatchCreateResponse<SupplierCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar cada fornecedor individualmente
        const validationResults: Array<{
          index: number;
          supplier: SupplierCreateFormData;
          error?: string;
        }> = [];

        for (let i = 0; i < data.suppliers.length; i++) {
          const supplier = data.suppliers[i];
          try {
            await this.validateSupplier(supplier, undefined, tx);
            validationResults.push({ index: i, supplier });
          } catch (error: unknown) {
            validationResults.push({
              index: i,
              supplier,
              error: error instanceof Error ? error.message : 'Erro ao validar fornecedor.',
            });
          }
        }

        // Separar fornecedores válidos dos inválidos
        const validSuppliers = validationResults.filter(r => !r.error).map(r => r.supplier);
        const invalidSuppliers = validationResults.filter(r => r.error);

        // Se não houver fornecedores válidos, retornar erro
        if (validSuppliers.length === 0) {
          return {
            success: [],
            failed: invalidSuppliers.map(r => ({
              index: r.index,
              data: r.supplier,
              error: r.error!,
              errorCode: 'VALIDATION_ERROR',
            })),
            totalCreated: 0,
            totalFailed: invalidSuppliers.length,
          };
        }

        // Criar apenas fornecedores válidos
        const result = await this.supplierRepository.createManyWithTransaction(tx, validSuppliers, {
          include,
        });

        // Combinar resultados de validação com resultados de criação
        const finalFailed = [
          ...invalidSuppliers.map(r => ({
            index: r.index,
            data: r.supplier,
            error: r.error!,
            errorCode: 'VALIDATION_ERROR' as const,
          })),
          ...result.failed,
        ];

        // Registrar criações bem-sucedidas
        for (const supplier of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.SUPPLIER,
            entityId: supplier.id,
            action: CHANGE_ACTION.CREATE,
            entity: supplier,
            reason: 'Fornecedor criado em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            userId: userId || null,
            transaction: tx,
          });
        }

        return {
          success: result.success,
          failed: finalFailed,
          totalCreated: result.totalCreated,
          totalFailed: finalFailed.length,
        };
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 fornecedor criado com sucesso'
          : `${result.totalCreated} fornecedores criados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchCreateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
          index: error.index || index,
          id: 'id' in error ? error.id : undefined,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
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
        'Erro ao criar fornecedores em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplos fornecedores
   */
  async batchUpdate(
    data: SupplierBatchUpdateFormData,
    include?: SupplierInclude,
    userId?: string,
  ): Promise<SupplierBatchUpdateResponse<SupplierUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar cada atualização individualmente
        const validationResults: Array<{
          index: number;
          id: string;
          data: SupplierUpdateFormData;
          error?: string;
        }> = [];

        for (let i = 0; i < data.suppliers.length; i++) {
          const update = data.suppliers[i];
          try {
            await this.validateSupplier(update.data, update.id, tx);
            validationResults.push({
              index: i,
              id: update.id,
              data: update.data,
            });
          } catch (error: unknown) {
            validationResults.push({
              index: i,
              id: update.id,
              data: update.data,
              error: error instanceof Error ? error.message : 'Erro ao validar fornecedor.',
            });
          }
        }

        // Separar atualizações válidas das inválidas
        const validUpdates = validationResults
          .filter(r => !r.error)
          .map(r => ({ id: r.id, data: r.data }));
        const invalidUpdates = validationResults.filter(r => r.error);

        // Se não houver atualizações válidas, retornar erro
        if (validUpdates.length === 0) {
          return {
            success: [],
            failed: invalidUpdates.map(r => ({
              index: r.index,
              id: r.id,
              data: { ...r.data, id: r.id },
              error: r.error!,
              errorCode: 'VALIDATION_ERROR',
            })),
            totalUpdated: 0,
            totalFailed: invalidUpdates.length,
          };
        }

        // Atualizar apenas fornecedores válidos
        const result = await this.supplierRepository.updateManyWithTransaction(tx, validUpdates, {
          include,
        });

        // Combinar resultados de validação com resultados de atualização
        const finalFailed = [
          ...invalidUpdates.map(r => ({
            index: r.index,
            id: r.id,
            data: { ...r.data, id: r.id },
            error: r.error!,
            errorCode: 'VALIDATION_ERROR' as const,
          })),
          ...result.failed,
        ];

        // Registrar atualizações bem-sucedidas com tracking de campos
        for (const updateData of validUpdates) {
          // Buscar fornecedor antigo para comparação
          const oldSupplier = await this.supplierRepository.findByIdWithTransaction(
            tx,
            updateData.id,
          );
          const updatedSupplier = result.success.find(s => s.id === updateData.id);

          if (oldSupplier && updatedSupplier) {
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.SUPPLIER,
              entityId: updateData.id,
              oldEntity: oldSupplier,
              newEntity: updatedSupplier,
              fieldsToTrack: this.SUPPLIER_FIELDS_TO_TRACK,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          }
        }

        return {
          success: result.success,
          failed: finalFailed,
          totalUpdated: result.totalUpdated,
          totalFailed: finalFailed.length,
        };
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 fornecedor atualizado com sucesso'
          : `${result.totalUpdated} fornecedores atualizados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: {
            ...error.data,
            id: error.id || '',
          },
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
        'Erro ao atualizar fornecedores em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir múltiplos fornecedores
   */
  async batchDelete(
    data: SupplierBatchDeleteFormData,
    userId?: string,
  ): Promise<SupplierBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar fornecedores antes de excluir para o changelog
        const suppliers = await this.supplierRepository.findByIdsWithTransaction(
          tx,
          data.supplierIds,
        );

        // Verificar se algum fornecedor tem pedidos
        for (const supplier of suppliers) {
          const orderCount = await tx.order.count({ where: { supplierId: supplier.id } });
          if (orderCount > 0) {
            throw new BadRequestException(
              `Fornecedor ${supplier.fantasyName} possui pedidos e não pode ser excluído`,
            );
          }
        }

        // Registrar exclusões
        for (const supplier of suppliers) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.SUPPLIER,
            entityId: supplier.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: supplier,
            reason: 'Fornecedor excluído em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            userId: userId || null,
            transaction: tx,
          });
        }

        return this.supplierRepository.deleteManyWithTransaction(tx, data.supplierIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 fornecedor excluído com sucesso'
          : `${result.totalDeleted} fornecedores excluídos com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchDeleteResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
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
    } catch (error: unknown) {
      this.logger.error('Erro na exclusão em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir fornecedores em lote. Por favor, tente novamente.',
      );
    }
  }
}
