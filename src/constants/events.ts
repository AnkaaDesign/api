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

/**
 * Publicado sempre que uma mudança de cadastro altera QUEM entra no divisor B1
 * do período corrente, ou COM QUE PESO.
 *
 * Existe porque `USER_CONTRACT_TERMINATED_EVENT` só cobre a TRANSIÇÃO para
 * TERMINATED — e essa é a minoria dos casos que mexem no divisor. Todos estes
 * mudam o bônus de TODO MUNDO do período e nenhum disparava nada:
 *
 *   • a data de demissão de um já-desligado ser CORRIGIDA (mover de 27/07 para
 *     27/06 muda o peso da pessoa e, com ele, o divisor);
 *   • alguém ser EFETIVADO no meio do período (entra no divisor com peso
 *     parcial);
 *   • alguém ser ADMITIDO direto em cargo bonificável;
 *   • cargo mudar de/para bonificável;
 *   • nível de desempenho sair de 0 ou voltar para 0 (o divisor só conta quem
 *     tem nível > 0).
 *
 * Sem isto, as linhas já salvas do período aberto ficavam com o divisor velho
 * até o cron do dia 5, e o cache SWR do cálculo live servia número velho por
 * até 30 min afirmando `isStale: false`.
 *
 * Consumidor: `BonusTerminationListener` — mesmo motivo de ciclo de DI dos
 * eventos acima (`BonusModule` importa `UserModule`).
 */
export const BONUS_ELIGIBILITY_CHANGED_EVENT = 'bonus.eligibility.changed';

export type BonusEligibilityChangeReason =
  | 'TERMINATION_DATE_CHANGED'
  | 'CONTRACT_EFFECTED'
  | 'USER_ADMITTED'
  | 'POSITION_CHANGED'
  | 'PERFORMANCE_LEVEL_CHANGED';

export interface BonusEligibilityChangedPayload {
  userId: string;
  reason: BonusEligibilityChangeReason;
  /**
   * Datas ANTES e DEPOIS, quando a mudança for de data de desligamento. As
   * duas importam: mover a demissão de agosto para junho muda o peso da pessoa
   * nos DOIS períodos, e varrer só a data nova deixaria o antigo intacto.
   */
  previousTerminationDate?: Date | null;
  terminationDate?: Date | null;
}
