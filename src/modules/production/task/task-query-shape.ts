import type { ZodValidationPipeOptions } from '../../common/pipes/zod-validation.pipe';

/**
 * G1: toda consulta de tarefa (include/select/where/orderBy) passa pelo
 * validador derivado do DMMF depois do zod — chave inventada vira 400 nomeado.
 * O repositório de tarefa ignora o argumento de relação do topo sem
 * include/select; o G1 também não o julga (só conta), como antes dele.
 *
 * Mora fora do controller para o teste de contrato (G4) usar exatamente as
 * opções que as rotas usam.
 */
export const TASK_QUERY_SHAPE: ZodValidationPipeOptions = {
  queryModel: 'Task',
  bareRelationArgsIgnored: true,
};
