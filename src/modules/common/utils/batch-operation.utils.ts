import { BatchOperationResult, BatchOperationError } from '../../../types';

/**
 * Convert internal batch result format to standard BatchOperationResult format
 */
export function convertToBatchOperationResult<T, U = unknown>(result: {
  success: T[];
  failed: any[];
  totalCreated?: number;
  totalUpdated?: number;
  totalDeleted?: number;
  totalFailed: number;
}): BatchOperationResult<T, U> {
  // Determine total success count from available properties
  const totalSuccess =
    result.totalCreated ?? result.totalUpdated ?? result.totalDeleted ?? result.success.length;

  // Ensure failed items have correct structure
  const formattedFailed: BatchOperationError<U>[] = result.failed.map(
    (error: any, index: number) => ({
      index: error.index ?? index,
      id: error.id,
      error: error.error || error.message || 'Erro desconhecido',
      errorCode: error.errorCode || 'UNKNOWN_ERROR',
      errorDetails: error.errorDetails,
      data: error.data,
      occurredAt: error.occurredAt,
    }),
  );

  return {
    success: result.success,
    failed: formattedFailed,
    totalProcessed: totalSuccess + result.totalFailed,
    totalSuccess,
    totalFailed: result.totalFailed,
  };
}

/**
 * Generate batch operation response message
 */
export function generateBatchMessage(
  operationType: 'criado' | 'atualizado' | 'excluído',
  totalSuccess: number,
  totalFailed: number,
  entityName: string = 'item', // default entity name
): string {
  const pluralEntityName = totalSuccess !== 1 ? `${entityName}s` : entityName;
  const successMessage =
    totalSuccess > 0
      ? `${totalSuccess} ${pluralEntityName} ${operationType}${totalSuccess !== 1 ? 's' : ''} com sucesso`
      : '';
  const failureMessage =
    totalFailed > 0
      ? `${totalSuccess > 0 ? ', ' : ''}${totalFailed} falhar${totalFailed !== 1 ? 'am' : 'ou'}`
      : '';

  return `${successMessage}${failureMessage}` || `Nenhum ${entityName} foi ${operationType}`;
}
