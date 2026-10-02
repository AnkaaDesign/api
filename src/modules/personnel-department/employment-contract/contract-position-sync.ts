// contract-position-sync.ts
// Propaga o cargo do colaborador (User.positionId) para o vínculo ABERTO
// (EmploymentContract.positionId) dentro da transação de quem mudou o cargo.
//
// Por que existe: o cargo mora em DOIS lugares — User.positionId (o que a
// bonificação, a folha e as telas leem) e EmploymentContract.positionId (o
// registro de RH do vínculo). `syncUserCurrentContract` espelha o do VÍNCULO
// no User sempre que qualquer coisa mexe no vínculo (troca de fase da
// experiência, rescisão, readmissão, cancelamento de admissão...). Então um
// caminho que muda só o User deixa o vínculo velho E arma uma reversão
// silenciosa: a próxima sincronização devolve a pessoa ao cargo antigo, sem
// ChangeLog nem histórico de cargo. Foi o que ficou armado nas promoções de
// 12/08/2026 feitas por `UserPositionHistoryService.promote` (Davyd, Fábio,
// Wellington, Gabriel — corrigidos em 28/09/2026).
//
// Só o vínculo NÃO encerrado recebe o cargo: um vínculo rescindido é registro
// histórico do cargo que a pessoa tinha QUANDO saiu, e reescrevê-lo apagaria
// isso. Note que `isCurrent` quer dizer "mais recente", não "aberto" — por isso
// o filtro é `NOT_TERMINATED_CONTRACT_WHERE`, não `isCurrent`.

import type { ChangeLogService } from '@modules/common/changelog/changelog.service';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import { CHANGE_ACTION, CHANGE_TRIGGERED_BY, ENTITY_TYPE } from '../../../constants';
import { NOT_TERMINATED_CONTRACT_WHERE } from '../../../utils/contract';

/**
 * Campo do ChangeLog para a mudança de cargo DO VÍNCULO.
 *
 * NÃO pode ser `positionId`: não existe `EMPLOYMENT_CONTRACT` em
 * ChangeLogEntityType, então o vínculo loga sob `USER`/entityId = userId — e
 * `BonusEligibilityService.buildHistoricalState` rebobina exatamente
 * `USER.positionId` para saber o cargo de um período fechado (o `oldValue` da
 * primeira mudança posterior ao corte vence). Com vínculo desatualizado, o
 * `oldValue` do vínculo é o cargo ANTIGO, e o período seria recalculado como
 * se a promoção não tivesse acontecido. Um campo próprio mantém a auditoria do
 * vínculo sem contaminar o eixo que a bonificação lê.
 */
export const CONTRACT_POSITION_CHANGELOG_FIELD = 'contractPositionId';

/**
 * Registra no ChangeLog a troca de cargo de um vínculo. Os valores gravados
 * são os NOMES dos cargos (a tela de histórico não resolve ids de um campo que
 * ela não conhece); os ids vão em `metadata` para quem precisar cruzar.
 */
export async function logContractPositionChange(
  tx: PrismaTransaction,
  changeLogService: ChangeLogService,
  params: {
    userId: string;
    contractId: string;
    contractSequence?: number | null;
    previousPositionId: string | null;
    positionId: string | null;
    reason: string;
    changedById?: string | null;
    triggeredBy?: CHANGE_TRIGGERED_BY;
  },
): Promise<void> {
  const ids = [params.previousPositionId, params.positionId].filter((v): v is string => !!v);
  const positions = ids.length
    ? await tx.position.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameOf = (id: string | null) =>
    id ? (positions.find(p => p.id === id)?.name ?? id) : 'Sem cargo';

  await changeLogService.logChange({
    entityType: ENTITY_TYPE.USER,
    entityId: params.userId,
    action: CHANGE_ACTION.UPDATE,
    field: CONTRACT_POSITION_CHANGELOG_FIELD,
    oldValue: nameOf(params.previousPositionId),
    newValue: nameOf(params.positionId),
    reason: params.reason,
    triggeredBy: params.triggeredBy ?? CHANGE_TRIGGERED_BY.USER_ACTION,
    triggeredById: params.userId,
    userId: params.changedById ?? null,
    transaction: tx,
    metadata: {
      contractId: params.contractId,
      contractSequence: params.contractSequence ?? null,
      previousPositionId: params.previousPositionId,
      positionId: params.positionId,
    },
  });
}

/**
 * Leva `positionId` para o vínculo aberto mais recente do colaborador, com
 * ChangeLog do vínculo. No-op (retorna null) quando não há vínculo aberto ou
 * ele já está no cargo. Deve rodar na MESMA transação que mudou o User.
 */
export async function syncOpenContractPosition(
  tx: PrismaTransaction,
  changeLogService: ChangeLogService,
  params: {
    userId: string;
    positionId: string | null;
    reason: string;
    changedById?: string | null;
    triggeredBy?: CHANGE_TRIGGERED_BY;
  },
): Promise<{ contractId: string; previousPositionId: string | null } | null> {
  // Maior sequence entre os abertos — a mesma regra de "vínculo atual" de
  // `syncUserCurrentContract`, mas sem cair para um vínculo encerrado.
  const contract = await tx.employmentContract.findFirst({
    where: { userId: params.userId, ...NOT_TERMINATED_CONTRACT_WHERE },
    orderBy: { sequence: 'desc' },
    select: { id: true, sequence: true, positionId: true },
  });
  if (!contract || contract.positionId === params.positionId) return null;

  await tx.employmentContract.update({
    where: { id: contract.id },
    data: { positionId: params.positionId },
  });

  await logContractPositionChange(tx, changeLogService, {
    userId: params.userId,
    contractId: contract.id,
    contractSequence: contract.sequence,
    previousPositionId: contract.positionId,
    positionId: params.positionId,
    reason: params.reason,
    changedById: params.changedById,
    triggeredBy: params.triggeredBy,
  });

  return { contractId: contract.id, previousPositionId: contract.positionId };
}
