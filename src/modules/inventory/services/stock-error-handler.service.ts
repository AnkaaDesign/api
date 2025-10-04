// apps/api/src/modules/inventory/services/stock-error-handler.service.ts

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { AtomicStockUpdatePlan, StockCalculationResult } from './atomic-stock-calculator.service';
import { STOCK_LEVEL } from '../../../constants/enums';

export enum ErrorType {
  VALIDATION = 'VALIDATION',
  CONSTRAINT = 'CONSTRAINT',
  BUSINESS_RULE = 'BUSINESS_RULE',
  SYSTEM = 'SYSTEM',
  PERMISSION = 'PERMISSION',
  NOT_FOUND = 'NOT_FOUND',
}

export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface StockErrorAnalysis {
  errorType: ErrorType;
  severity: ErrorSeverity;
  canRetry: boolean;
  suggestedActions: string[];
  affectedItems: Array<{
    itemId: string;
    itemName: string;
    currentQuantity: number;
    finalQuantity: number;
    errors: string[];
    warnings: string[];
  }>;
  rootCause: string;
  errorCode: string;
  timestamp: Date;
  operationCount: number;
  executionContext: {
    totalItems: number;
    totalOperations: number;
    hasOrderOperations: boolean;
    hasUserOperations: boolean;
    hasActivityUpdates: boolean;
  };
}

export interface ErrorResolution {
  canAutoResolve: boolean;
  resolutionSteps: string[];
  requiredPermissions: string[];
  estimatedResolutionTime: string;
  preventionTips: string[];
}

@Injectable()
export class StockErrorHandlerService {
  private readonly logger = new Logger(StockErrorHandlerService.name);

  /**
   * Analyze errors from a stock update plan and provide detailed analysis
   */
  analyzeError(plan: AtomicStockUpdatePlan, error?: Error): StockErrorAnalysis {
    const analysis: StockErrorAnalysis = {
      errorType: ErrorType.SYSTEM,
      severity: ErrorSeverity.MEDIUM,
      canRetry: false,
      suggestedActions: [],
      affectedItems: [],
      rootCause: 'Erro desconhecido',
      errorCode: 'UNKNOWN_ERROR',
      timestamp: new Date(),
      operationCount: plan.totalOperations,
      executionContext: {
        totalItems: plan.affectedItems.size,
        totalOperations: plan.totalOperations,
        hasOrderOperations: plan.operations.some(op => op.orderId),
        hasUserOperations: plan.operations.some(op => op.userId),
        hasActivityUpdates: plan.operations.some(op => op.activityId),
      },
    };

    // Build affected items list
    analysis.affectedItems = plan.calculations.map(calc => ({
      itemId: calc.itemId,
      itemName: calc.itemName,
      currentQuantity: calc.currentQuantity,
      finalQuantity: calc.finalQuantity,
      errors: calc.errors,
      warnings: calc.warnings,
    }));

    // Analyze system errors first
    if (error) {
      this.analyzeSystemError(error, analysis);
      return analysis;
    }

    // Analyze global errors
    if (plan.globalErrors.length > 0) {
      this.analyzeGlobalErrors(plan.globalErrors, analysis);
    }

    // Analyze calculation errors
    const calculationErrors = plan.calculations.flatMap(c => c.errors);
    if (calculationErrors.length > 0) {
      this.analyzeCalculationErrors(calculationErrors, plan.calculations, analysis);
    }

    // Determine overall severity
    this.determineSeverity(analysis, plan);

    return analysis;
  }

  /**
   * Analyze system-level errors (exceptions, database issues, etc.)
   */
  private analyzeSystemError(error: Error, analysis: StockErrorAnalysis): void {
    analysis.errorType = ErrorType.SYSTEM;
    analysis.severity = ErrorSeverity.CRITICAL;
    analysis.rootCause = error.message;
    analysis.canRetry = true;

    // Categorize system errors
    if (error.message.includes('connection') || error.message.includes('timeout')) {
      analysis.errorCode = 'DATABASE_CONNECTION_ERROR';
      analysis.suggestedActions.push('Verificar conectividade com o banco de dados');
      analysis.suggestedActions.push('Aguardar alguns momentos e tentar novamente');
      analysis.suggestedActions.push('Verificar status do servidor de banco de dados');
    } else if (error.message.includes('transaction') || error.message.includes('deadlock')) {
      analysis.errorCode = 'TRANSACTION_ERROR';
      analysis.suggestedActions.push('Tentar novamente em alguns momentos');
      analysis.suggestedActions.push('Reduzir número de operações simultâneas');
      analysis.suggestedActions.push('Executar operações em lotes menores');
    } else if (error.message.includes('constraint') || error.message.includes('foreign key')) {
      analysis.errorCode = 'DATABASE_CONSTRAINT_ERROR';
      analysis.errorType = ErrorType.CONSTRAINT;
      analysis.canRetry = false;
      analysis.suggestedActions.push('Verificar integridade referencial dos dados');
      analysis.suggestedActions.push('Verificar se todos os IDs referenciados existem');
    } else {
      analysis.errorCode = 'UNKNOWN_SYSTEM_ERROR';
      analysis.suggestedActions.push('Verificar logs do sistema para mais detalhes');
      analysis.suggestedActions.push('Tentar novamente ou contatar suporte técnico');
    }
  }

  /**
   * Analyze global validation errors
   */
  private analyzeGlobalErrors(globalErrors: string[], analysis: StockErrorAnalysis): void {
    analysis.errorType = ErrorType.VALIDATION;
    analysis.severity = ErrorSeverity.HIGH;
    analysis.rootCause = globalErrors[0];
    analysis.canRetry = false;

    for (const error of globalErrors) {
      if (error.includes('não encontrado')) {
        analysis.errorType = ErrorType.NOT_FOUND;
        analysis.errorCode = 'RESOURCE_NOT_FOUND';
        analysis.suggestedActions.push(
          'Verificar se todos os itens, usuários e pedidos existem no sistema',
        );
        analysis.suggestedActions.push('Atualizar IDs para recursos válidos');
      } else if (error.includes('inativo')) {
        analysis.errorType = ErrorType.BUSINESS_RULE;
        analysis.errorCode = 'INACTIVE_RESOURCE';
        analysis.suggestedActions.push('Ativar os recursos necessários antes de tentar novamente');
        analysis.suggestedActions.push('Verificar status de itens, usuários e pedidos');
      } else if (error.includes('cancelado')) {
        analysis.errorType = ErrorType.BUSINESS_RULE;
        analysis.errorCode = 'CANCELLED_ORDER';
        analysis.suggestedActions.push('Usar apenas pedidos em status válido para recebimento');
        analysis.suggestedActions.push('Verificar status dos pedidos antes de processar');
      } else if (error.includes('limite máximo')) {
        analysis.errorType = ErrorType.CONSTRAINT;
        analysis.errorCode = 'OPERATION_LIMIT_EXCEEDED';
        analysis.suggestedActions.push('Reduzir número de operações por lote');
        analysis.suggestedActions.push('Processar em múltiplos lotes menores');
      } else if (error.includes('duplicadas')) {
        analysis.errorType = ErrorType.VALIDATION;
        analysis.errorCode = 'DUPLICATE_OPERATIONS';
        analysis.suggestedActions.push('Remover operações duplicadas na mesma atividade');
        analysis.suggestedActions.push('Verificar lógica de criação de operações');
      }
    }
  }

  /**
   * Analyze item-specific calculation errors
   */
  private analyzeCalculationErrors(
    calculationErrors: string[],
    calculations: StockCalculationResult[],
    analysis: StockErrorAnalysis,
  ): void {
    analysis.errorType = ErrorType.CONSTRAINT;
    analysis.severity = ErrorSeverity.HIGH;
    analysis.rootCause = calculationErrors[0];
    analysis.canRetry = false;

    // Count error types
    const negativeStockErrors = calculationErrors.filter(e => e.includes('negativo')).length;
    const maxStockErrors = calculationErrors.filter(e => e.includes('máximo')).length;
    const inactiveItemErrors = calculationErrors.filter(e => e.includes('inativo')).length;
    const orderConstraintErrors = calculationErrors.filter(e => e.includes('pedido')).length;

    if (negativeStockErrors > 0) {
      analysis.errorCode = 'INSUFFICIENT_STOCK';
      analysis.suggestedActions.push('Verificar disponibilidade de estoque antes da operação');
      analysis.suggestedActions.push('Reduzir quantidades de saída ou adicionar entradas');
      analysis.suggestedActions.push('Verificar histórico de movimentações do item');

      // Add specific suggestions for items with negative stock
      const negativeItems = calculations.filter(c => c.finalQuantity < 0);
      if (negativeItems.length > 0) {
        analysis.suggestedActions.push(
          `Itens com estoque insuficiente: ${negativeItems.map(i => `${i.itemName} (disponível: ${i.currentQuantity})`).join(', ')}`,
        );
      }
    }

    if (maxStockErrors > 0) {
      analysis.errorCode = 'STOCK_LIMIT_EXCEEDED';
      analysis.suggestedActions.push('Verificar limites máximos de estoque dos itens');
      analysis.suggestedActions.push(
        'Considerar ajustar os limites ou realizar operações de saída',
      );
      analysis.suggestedActions.push('Distribuir estoque entre múltiplos locais se possível');

      // Add specific suggestions for overstocked items
      const overStockedItems = calculations.filter(
        c => c.maxQuantity && c.finalQuantity > c.maxQuantity,
      );
      if (overStockedItems.length > 0) {
        analysis.suggestedActions.push(
          `Itens com excesso: ${overStockedItems.map(i => `${i.itemName} (limite: ${i.maxQuantity})`).join(', ')}`,
        );
      }
    }

    if (inactiveItemErrors > 0) {
      analysis.errorType = ErrorType.BUSINESS_RULE;
      analysis.errorCode = 'INACTIVE_ITEMS';
      analysis.suggestedActions.push('Ativar itens necessários antes de processar movimentações');
      analysis.suggestedActions.push('Verificar status de todos os itens envolvidos');
    }

    if (orderConstraintErrors > 0) {
      analysis.errorType = ErrorType.BUSINESS_RULE;
      analysis.errorCode = 'ORDER_CONSTRAINT_VIOLATION';
      analysis.suggestedActions.push('Verificar quantidades de pedidos e já recebidas');
      analysis.suggestedActions.push('Ajustar quantidades para não exceder o pedido');
      analysis.suggestedActions.push('Verificar se os itens do pedido estão corretos');
    }
  }

  /**
   * Determine overall error severity based on context
   */
  private determineSeverity(analysis: StockErrorAnalysis, plan: AtomicStockUpdatePlan): void {
    // Increase severity based on context
    if (analysis.operationCount > 100) {
      analysis.severity = ErrorSeverity.CRITICAL;
    }

    if (plan.affectedItems.size > 50) {
      analysis.severity = ErrorSeverity.CRITICAL;
    }

    // Critical items affected
    const criticalStockItems = plan.calculations.filter(
      c => c.stockLevel === STOCK_LEVEL.CRITICAL || c.stockLevel === STOCK_LEVEL.NEGATIVE_STOCK,
    );
    if (criticalStockItems.length > 0) {
      analysis.severity = ErrorSeverity.HIGH;
    }

    // Order operations are more critical
    if (
      analysis.executionContext.hasOrderOperations &&
      analysis.errorType === ErrorType.CONSTRAINT
    ) {
      analysis.severity = ErrorSeverity.HIGH;
    }
  }

  /**
   * Get error resolution suggestions
   */
  getErrorResolution(analysis: StockErrorAnalysis): ErrorResolution {
    const resolution: ErrorResolution = {
      canAutoResolve: false,
      resolutionSteps: [],
      requiredPermissions: [],
      estimatedResolutionTime: 'Imediato',
      preventionTips: [],
    };

    switch (analysis.errorCode) {
      case 'INSUFFICIENT_STOCK':
        resolution.resolutionSteps = [
          'Verificar disponibilidade atual de estoque',
          'Processar entradas necessárias antes das saídas',
          'Ajustar quantidades das operações',
          'Tentar novamente a operação',
        ];
        resolution.requiredPermissions = ['STOCK_READ', 'STOCK_WRITE'];
        resolution.estimatedResolutionTime = '5-10 minutos';
        resolution.preventionTips = [
          'Sempre verificar estoque antes de operações de saída',
          'Manter pontos de reposição atualizados',
          'Configurar alertas de estoque baixo',
        ];
        break;

      case 'STOCK_LIMIT_EXCEEDED':
        resolution.resolutionSteps = [
          'Verificar limites máximos configurados',
          'Ajustar limites se necessário',
          'Distribuir estoque entre locais',
          'Processar saídas antes das entradas',
        ];
        resolution.requiredPermissions = ['STOCK_READ', 'STOCK_WRITE', 'ITEM_MANAGE'];
        resolution.estimatedResolutionTime = '10-15 minutos';
        resolution.preventionTips = [
          'Revisar limites máximos periodicamente',
          'Considerar múltiplos locais de estoque',
          'Planejar operações para evitar excessos',
        ];
        break;

      case 'RESOURCE_NOT_FOUND':
        resolution.canAutoResolve = false;
        resolution.resolutionSteps = [
          'Verificar se os IDs fornecidos existem',
          'Atualizar referências para recursos válidos',
          'Verificar permissões de acesso aos recursos',
        ];
        resolution.requiredPermissions = ['ITEM_READ', 'USER_READ', 'ORDER_READ'];
        resolution.estimatedResolutionTime = '2-5 minutos';
        resolution.preventionTips = [
          'Validar IDs antes de criar operações',
          'Usar busca/autocomplete para seleção de recursos',
          'Implementar validação client-side',
        ];
        break;

      case 'INACTIVE_RESOURCE':
        resolution.resolutionSteps = [
          'Identificar recursos inativos',
          'Ativar recursos necessários',
          'Verificar se a ativação é permitida',
          'Tentar operação novamente',
        ];
        resolution.requiredPermissions = ['ITEM_MANAGE', 'USER_MANAGE', 'ORDER_MANAGE'];
        resolution.estimatedResolutionTime = '5-10 minutos';
        resolution.preventionTips = [
          'Verificar status antes de usar recursos',
          'Manter recursos ativos quando em uso',
          'Configurar alertas para recursos inativados',
        ];
        break;

      case 'DATABASE_CONNECTION_ERROR':
        resolution.canAutoResolve = true;
        resolution.resolutionSteps = [
          'Aguardar reconexão automática',
          'Verificar conectividade de rede',
          'Tentar operação novamente',
          'Contatar suporte se persistir',
        ];
        resolution.requiredPermissions = [];
        resolution.estimatedResolutionTime = '1-5 minutos';
        resolution.preventionTips = [
          'Implementar retry automático',
          'Configurar alertas de conectividade',
          'Manter conexões de backup',
        ];
        break;

      default:
        resolution.resolutionSteps = [
          'Verificar logs detalhados do erro',
          'Validar dados de entrada',
          'Tentar com operações menores',
          'Contatar suporte técnico se necessário',
        ];
        resolution.estimatedResolutionTime = '10-30 minutos';
        resolution.preventionTips = [
          'Implementar validação robusta',
          'Testar operações em ambiente de desenvolvimento',
          'Monitorar métricas do sistema',
        ];
    }

    return resolution;
  }

  /**
   * Format comprehensive error message for the user
   */
  formatErrorMessage(analysis: StockErrorAnalysis): string {
    const parts = [
      `🚨 ERRO NA OPERAÇÃO DE ESTOQUE`,
      ``,
      `Tipo: ${this.getErrorTypeLabel(analysis.errorType)}`,
      `Severidade: ${this.getSeverityLabel(analysis.severity)}`,
      `Código: ${analysis.errorCode}`,
      ``,
      `📋 DETALHES:`,
      `${analysis.rootCause}`,
      ``,
    ];

    // Add affected items summary
    if (analysis.affectedItems.length > 0) {
      parts.push(`📦 ITENS AFETADOS (${analysis.affectedItems.length}):`);
      analysis.affectedItems.slice(0, 5).forEach((item, i) => {
        parts.push(
          `${i + 1}. ${item.itemName} - Atual: ${item.currentQuantity}, Final: ${item.finalQuantity}`,
        );
        if (item.errors.length > 0) {
          parts.push(`   ❌ ${item.errors.join('; ')}`);
        }
      });

      if (analysis.affectedItems.length > 5) {
        parts.push(`   ... e mais ${analysis.affectedItems.length - 5} itens`);
      }
      parts.push('');
    }

    // Add operation context
    parts.push(`🔧 CONTEXTO DA OPERAÇÃO:`);
    parts.push(`Total de operações: ${analysis.operationCount}`);
    parts.push(`Itens envolvidos: ${analysis.executionContext.totalItems}`);
    if (analysis.executionContext.hasOrderOperations) {
      parts.push(`Inclui operações de pedidos`);
    }
    if (analysis.executionContext.hasActivityUpdates) {
      parts.push(`Inclui atualizações de atividades`);
    }
    parts.push('');

    // Add suggested actions
    if (analysis.suggestedActions.length > 0) {
      parts.push(`💡 AÇÕES SUGERIDAS:`);
      analysis.suggestedActions.forEach((action, i) => {
        parts.push(`${i + 1}. ${action}`);
      });
      parts.push('');
    }

    // Add retry information
    if (analysis.canRetry) {
      parts.push(`🔄 Esta operação pode ser tentada novamente após corrigir os problemas.`);
    } else {
      parts.push(`⚠️  Esta operação requer correções antes de tentar novamente.`);
    }

    return parts.join('\n');
  }

  /**
   * Handle stock error by analyzing and throwing appropriate exception
   */
  handleStockError(plan: AtomicStockUpdatePlan, error?: Error): never {
    const analysis = this.analyzeError(plan, error);
    const message = this.formatErrorMessage(analysis);

    // Log detailed error information
    this.logger.error(`Stock operation failed [${analysis.errorCode}]:`, {
      errorType: analysis.errorType,
      severity: analysis.severity,
      affectedItems: analysis.affectedItems.length,
      operationCount: analysis.operationCount,
      canRetry: analysis.canRetry,
      rootCause: analysis.rootCause,
      stack: error?.stack,
    });

    // Log individual item errors for debugging
    analysis.affectedItems.forEach(item => {
      if (item.errors.length > 0) {
        this.logger.error(`Item ${item.itemName} (${item.itemId}) errors:`, item.errors);
      }
    });

    throw new BadRequestException(message);
  }

  /**
   * Get user-friendly error type label
   */
  private getErrorTypeLabel(errorType: ErrorType): string {
    const labels = {
      [ErrorType.VALIDATION]: 'Erro de Validação',
      [ErrorType.CONSTRAINT]: 'Violação de Restrição',
      [ErrorType.BUSINESS_RULE]: 'Regra de Negócio',
      [ErrorType.SYSTEM]: 'Erro do Sistema',
      [ErrorType.PERMISSION]: 'Erro de Permissão',
      [ErrorType.NOT_FOUND]: 'Recurso Não Encontrado',
    };
    return labels[errorType] || errorType;
  }

  /**
   * Get user-friendly severity label
   */
  private getSeverityLabel(severity: ErrorSeverity): string {
    const labels = {
      [ErrorSeverity.LOW]: 'Baixa',
      [ErrorSeverity.MEDIUM]: 'Média',
      [ErrorSeverity.HIGH]: 'Alta',
      [ErrorSeverity.CRITICAL]: 'Crítica',
    };
    return labels[severity] || severity;
  }

  /**
   * Generate error report for monitoring/analytics
   */
  generateErrorReport(analysis: StockErrorAnalysis): any {
    return {
      timestamp: analysis.timestamp,
      errorCode: analysis.errorCode,
      errorType: analysis.errorType,
      severity: analysis.severity,
      operationCount: analysis.operationCount,
      affectedItemsCount: analysis.affectedItems.length,
      canRetry: analysis.canRetry,
      executionContext: analysis.executionContext,
      itemBreakdown: analysis.affectedItems.map(item => ({
        itemId: item.itemId,
        errorCount: item.errors.length,
        warningCount: item.warnings.length,
        stockImpact: item.finalQuantity - item.currentQuantity,
      })),
    };
  }
}
