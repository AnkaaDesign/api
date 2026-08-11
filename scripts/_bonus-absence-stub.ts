/**
 * _bonus-absence-stub.ts
 *
 * `BonusEligibilityService` depende de `BonusAbsenceService`, que fala com o
 * Secullum. Os scripts de diagnóstico deste diretório rodam com um
 * `PrismaClient` cru, FORA do container do Nest — montar o cliente do Secullum
 * ali significaria reconstruir autenticação, cache e circuit breaker à mão.
 *
 * Este stub devolve o eixo de afastamento NEUTRO: fator 1 para todo mundo,
 * `measured: false`. O resultado é o divisor considerando apenas o eixo do
 * VÍNCULO (admissão/demissão) — que é exatamente o que esses scripts sempre
 * mediram.
 *
 * A dependência NÃO foi tornada opcional no serviço de propósito: um
 * `@Optional()` faria a regra de afastamento sumir em silêncio se a DI algum
 * dia fosse configurada errado, e "some em silêncio" é o modo de falha que
 * mais custou caro neste módulo. Melhor um stub explícito, com este aviso.
 *
 * Para o número COM o eixo de afastamento, use o script que sobe o AppModule:
 *
 *   pnpm bonus:preview-period <ano> <mês>
 */
import type { PeriodAbsence } from '../src/modules/personnel-department/bonus/bonus-absence.service';

export const ABSENCE_STUB_NOTICE =
  'AVISO: este script mede APENAS o eixo do vínculo (admissão/demissão). O fator de\n' +
  '       afastamento médico NÃO é consultado — o divisor exibido pode ser MAIOR que o\n' +
  '       real se alguém estiver afastado acima da franquia de 40%.\n' +
  '       Para o número completo: pnpm bonus:preview-period <ano> <mês>\n';

export function neutralAbsenceService(): {
  resolvePeriodAbsence: (users: Array<{ userId: string; eligibleDays: number }>) => Promise<PeriodAbsence>;
} {
  return {
    resolvePeriodAbsence: async users => ({
      // `available: true` porque nada FALHOU — o eixo simplesmente não foi
      // consultado. Marcar false faria os scripts reportarem uma queda do
      // Secullum que não aconteceu.
      available: true,
      failedUsers: [],
      byUserId: new Map(
        users.map(u => [
          u.userId,
          {
            userId: u.userId,
            absentDays: 0,
            eligibleDays: u.eligibleDays,
            fraction: 0,
            factor: 1,
            fromAfastamento: 0,
            fromAtestadoDiario: 0,
            ranges: [],
            measured: false,
          },
        ]),
      ),
    }),
  };
}
