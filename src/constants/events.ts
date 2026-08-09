// events.ts
//
// Nomes de eventos de domínio publicados no EventEmitter e consumidos por
// módulos que NÃO podem ser injetados diretamente no publicador — tipicamente
// porque a dependência inversa já existe e uma injeção fecharia um ciclo de DI.

/**
 * Publicado quando o vínculo de um colaborador passa a TERMINATED — apenas na
 * TRANSIÇÃO, nunca em edições posteriores de alguém já desligado.
 *
 * Consumidor: `BonusTerminationListener` (módulo de bonificação), que fecha o
 * bônus dos períodos que a pessoa trabalhou. `BonusModule` importa `UserModule`,
 * então o caminho direto (UserService → BonusService) é um ciclo.
 */
export const USER_CONTRACT_TERMINATED_EVENT = 'user.contract.terminated';

export interface UserContractTerminatedPayload {
  userId: string;
  terminationDate: Date | null;
}
