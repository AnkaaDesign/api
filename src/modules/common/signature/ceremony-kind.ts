// api/src/modules/common/signature/ceremony-kind.ts
//
// Qual CERIMÔNIA autentica um signatário, a partir do `authMethod` congelado
// nele.
//
// POR QUE ISTO SAIU DE DENTRO DO SERVIÇO
//   Era um ternário de UMA LINHA, método privado de um serviço de 7.900 linhas
//   que arrasta Prisma, Chromium, PAdES, NFS-e e Sicredi atrás de si. Duas
//   consequências, e as duas doeram:
//
//   1. **Não havia como testá-lo.** A tabela-verdade desta função decide quatro
//      comportamentos (`assertOtpCeremony`, `resendInvitation`,
//      `noticeChannelOf`, `getPublicState.canSign`) e nenhum deles podia ser
//      verificado sem subir o módulo inteiro. Agora é um arquivo sem
//      dependências, e `tests/portal-assinatura-compras.test.ts` percorre TODO
//      valor do enum.
//
//   2. **O ternário convidava ao erro.** "`INTERNAL_SESSION` → INTERNAL, o resto
//      → OTP" transforma todo valor novo em OTP por omissão — e um método de
//      SESSÃO tratado como OTP é um signatário assinando pelo link público sem
//      código, ou seja, uma capability de obrigar a empresa viajando por e-mail.
//      O `switch` abaixo nomeia os cinco valores e obriga quem acrescentar o
//      sexto a decidir.
//
// ⚠️ AS TRÊS CERIMÔNIAS NÃO SÃO DUAS.
//   `INTERNAL` e `PORTAL` dispensam o código de uso único, e é SÓ isso que têm
//   em comum. `INTERNAL` significa lado ANKAA em todo consumidor: não recebe
//   convite, o aviso tem template próprio, o botão mora no painel interno. Dar
//   `INTERNAL_SESSION` a um contato do cliente — o atalho óbvio, já que o valor
//   existia — faria os quatro consumidores tratá-lo como lado Ankaa em
//   silêncio. Por isso `RESPONSIBLE_SESSION` é valor próprio no enum e `PORTAL`
//   é cerimônia própria aqui.

import { SignatureAuthMethod } from '@prisma/client';
import type { CeremonyKind } from './signature.constants';

/**
 * Como aquele signatário é autenticado.
 *
 * `INTERNAL_SESSION` → `INTERNAL` (a Ankaa contra-assinando no sistema).
 * `RESPONSIBLE_SESSION` → `PORTAL` (o contato do cliente assinando no Portal do
 * Cliente). Tudo o mais é `OTP`, inclusive o legado `SMS_OTP`, que continua no
 * enum porque envelopes já selados o carregam na evidência.
 */
export function ceremonyKindOfAuthMethod(
  authMethod: SignatureAuthMethod | string | null | undefined,
): CeremonyKind {
  switch (authMethod) {
    case SignatureAuthMethod.INTERNAL_SESSION:
      return 'INTERNAL';
    case SignatureAuthMethod.RESPONSIBLE_SESSION:
      return 'PORTAL';
    // EMAIL_OTP, WHATSAPP_OTP, SMS_OTP — e a ausência.
    //
    // O `default` é OTP porque é o que TODA linha antiga do banco é (a coluna
    // tem `@default(EMAIL_OTP)`), e porque um método de código novo é, por
    // definição, código. O que ele NÃO pode ser é a porta por onde um método de
    // SESSÃO entre sem ser notado — daí os dois `case` nomeados acima.
    default:
      return 'OTP';
  }
}

/**
 * Esta cerimônia dispensa o código de uso único?
 *
 * Existe como pergunta própria em vez de um `!== 'OTP'` solto porque ela é
 * feita em quatro lugares com o MESMO sentido ("este signatário não tem canal,
 * não recebe código, e o ato dele não acontece na página pública") e em nenhum
 * deles as duas sessões devem ser confundidas uma com a outra.
 */
export function isSessionCeremony(
  authMethod: SignatureAuthMethod | string | null | undefined,
): boolean {
  return ceremonyKindOfAuthMethod(authMethod) !== 'OTP';
}
