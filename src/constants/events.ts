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

/**
 * Publicado quando um vínculo é EFETIVADO (qualquer modalidade de experiência →
 * INDETERMINATE), tanto pela efetivação manual quanto pela automática do cron.
 *
 * É o simétrico da demissão para a bonificação: efetivar alguém no meio do
 * período o coloca no divisor B1 com peso parcial, e `periodDivisor` é um valor
 * DO PERÍODO — o bônus de todo mundo muda junto. Sem este evento, as linhas já
 * salvas do período aberto continuavam com o divisor antigo e o cache SWR do
 * cálculo live servia número velho por até 30 min (TTL duro de 2h).
 *
 * Consumidor: `BonusTerminationListener` (mesmo motivo de ciclo de DI descrito
 * acima — `BonusModule` importa `UserModule`).
 */
export const USER_CONTRACT_EFFECTED_EVENT = 'user.contract.effected';

export interface UserContractEffectedPayload {
  userId: string;
  effectedAt: Date | null;
}
