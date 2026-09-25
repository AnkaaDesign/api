// utils/task-implement-spot.ts

import { PrismaTransaction } from '@modules/common/base/base.repository';
import { IMPLEMENT_SPOT } from '../constants/enums';
import { YARD_SPOTS } from '../constants/garage';

/**
 * Mantém a posição do implemento no pátio em sincronia com o campo `cleared` da tarefa.
 *
 * `cleared` significa que o implemento foi liberado e está aqui — então ele entra no
 * Pátio de Espera. Quando `cleared` é desfeito (previsão reagendada, data de entrada
 * removida, liberação desmarcada) o implemento não está mais aqui e precisa sair do
 * pátio; caso contrário a visão da garagem continua mostrando implementos fantasmas
 * (foi exatamente o que aconteceu com o lote SEM Limite de 2026-07-30).
 *
 * Apenas os spots de pátio derivam de `cleared`. Um implemento estacionado em uma vaga
 * real de garagem (B1_F1_V1 …) foi colocado lá manualmente e nunca é movido
 * automaticamente — `spot: null` significa "fora das instalações".
 */
export async function syncImplementSpotWithCleared(
  transaction: PrismaTransaction,
  taskId: string,
  cleared: boolean,
): Promise<void> {
  if (cleared) {
    await transaction.implement.updateMany({
      where: { taskId, spot: null },
      data: { spot: IMPLEMENT_SPOT.YARD_WAIT as any },
    });
    return;
  }

  await transaction.implement.updateMany({
    where: { taskId, spot: { in: [...YARD_SPOTS] as any } },
    data: { spot: null },
  });
}
