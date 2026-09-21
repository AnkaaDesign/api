// api/src/modules/common/notification/notification-recipient.ts
//
// O DESTINATÁRIO DE UMA NOTIFICAÇÃO — e a regra de que é EXATAMENTE UM.
//
// POR QUE ISTO EXISTE
//   Até 20/09/2026 `Notification.userId → User` era a única FK de pessoa, e
//   `getTargetUsers` só resolvia `prisma.user`: avisar um contato do CLIENTE por
//   dentro do sistema era IMPOSSÍVEL. O portal do responsável precisa disso — um
//   fluxo com passagem de bastão entre o vendedor do cliente, o Compras dele e o
//   comercial da Ankaa não tem como avisar ninguém sem uma segunda FK.
//
//   A segunda FK chegou (`Notification.responsibleId`), e com ela um CHECK:
//
//       Notification_exactly_one_recipient
//       CHECK (("userId" IS NULL) <> ("responsibleId" IS NULL))
//
//   Mesma doutrina de `EnvelopeSigner_exactly_one_identity`, e pela mesma razão:
//   os dois sujeitos NÃO se misturam. `User` é funcionário; `Responsible` é
//   contato de cliente. Uma notificação com os dois preenchidos seria entregue
//   duas vezes, por dois caminhos diferentes, com dois textos diferentes; uma
//   com nenhum seria um broadcast acidental.
//
// POR QUE UM TIPO, E NÃO DOIS CAMPOS OPCIONAIS
//   `{ userId?: string; responsibleId?: string }` deixa `{}` e `{ userId,
//   responsibleId }` compilarem — os dois estados que o banco recusa. O CHECK
//   então dispara em RUNTIME, dentro da transação de negócio, e o cliente vê
//   500. Uma UNIÃO DISCRIMINADA torna os dois estados inexprimíveis: o erro
//   passa do banco para o `tsc`, que é onde ele custa um minuto em vez de um
//   incidente.
//
//   O único ponto em que o par volta a ser "dois campos" é a borda do Prisma, e
//   é exatamente para isso que `recipientColumns` existe: um lugar só,
//   auditável, onde a conversão acontece.
//
// NADA DE NEST AQUI, DE PROPÓSITO
//   Sem `@Injectable`, sem `PrismaService`, sem import de `@prisma/client`. É o
//   que permite `tests/portal-decisao.test.ts` importar este arquivo com `tsx`,
//   sem banco e sem container de injeção.

/** Nome do CHECK no banco. Citado nas mensagens de erro para o diagnóstico ser direto. */
export const NOTIFICATION_RECIPIENT_CHECK = 'Notification_exactly_one_recipient';

/**
 * A quem esta notificação se destina.
 *
 * Discriminada por `kind` e não por "qual campo está preenchido": o `switch`
 * sobre `kind` é exaustivo para o `tsc`, então acrescentar um terceiro sujeito
 * um dia vira erro de compilação em cada caminho de entrega — e não uma entrega
 * silenciosamente pulada.
 */
export type NotificationRecipient =
  | { readonly kind: 'USER'; readonly userId: string }
  | { readonly kind: 'RESPONSIBLE'; readonly responsibleId: string };

/** O funcionário. */
export function userRecipient(userId: string): NotificationRecipient {
  return { kind: 'USER', userId };
}

/** O contato do cliente. */
export function responsibleRecipient(responsibleId: string): NotificationRecipient {
  return { kind: 'RESPONSIBLE', responsibleId };
}

/**
 * A borda do Prisma: a união vira o par de colunas que o `create` pede.
 *
 * Devolve SEMPRE as duas chaves, uma delas `null`. Omitir a outra funcionaria no
 * `create` e mentiria no `update`: lá, chave ausente quer dizer "não mexa", e um
 * `update` que só escrevesse `responsibleId` deixaria o `userId` antigo de pé —
 * os dois preenchidos, que é o estado que o CHECK recusa.
 */
export function recipientColumns(recipient: NotificationRecipient): {
  userId: string | null;
  responsibleId: string | null;
} {
  switch (recipient.kind) {
    case 'USER':
      return { userId: recipient.userId, responsibleId: null };
    case 'RESPONSIBLE':
      return { userId: null, responsibleId: recipient.responsibleId };
  }
}

/** A linha gravada satisfaz o CHECK? Aceita `undefined` porque um `select` parcial o produz. */
export function isExactlyOneRecipient(row: {
  userId?: string | null;
  responsibleId?: string | null;
}): boolean {
  const hasUser = !!row.userId;
  const hasResponsible = !!row.responsibleId;
  return hasUser !== hasResponsible;
}

/**
 * A leitura de volta: a linha do banco vira a união.
 *
 * LANÇA quando a linha não satisfaz o CHECK. Não é paranoia: um `select` que
 * esqueça `responsibleId` entrega `{ userId: null }` ao código de entrega, e o
 * comportamento sem esta guarda seria tratar um aviso de cliente como BROADCAST
 * — `getTargetUsers` sem `userId` varre `prisma.user` inteiro. Falhar alto é a
 * única resposta segura; quem chama de dentro de um dispatch decide se engole.
 */
export function recipientOf(row: {
  userId?: string | null;
  responsibleId?: string | null;
}): NotificationRecipient {
  if (row.userId && row.responsibleId) {
    throw new Error(
      `Notificação com DOIS destinatários (userId e responsibleId). ${NOTIFICATION_RECIPIENT_CHECK} recusa.`,
    );
  }
  if (row.userId) return userRecipient(row.userId);
  if (row.responsibleId) return responsibleRecipient(row.responsibleId);
  throw new Error(
    `Notificação SEM destinatário (nem userId nem responsibleId). ${NOTIFICATION_RECIPIENT_CHECK} recusa.`,
  );
}

/**
 * O destinatário, ou `null` quando a linha é um BROADCAST legítimo.
 *
 * Existe porque `dispatchNotification` precisa distinguir três casos e não dois:
 * dirigida a funcionário, dirigida a contato de cliente, e a notificação SEM
 * `userId` que o código antigo usa para "todo mundo elegível". Essa terceira
 * continua existindo em memória — mas nunca no banco com o CHECK ligado, porque
 * lá ela violaria o `<>`. `recipientOf` lançaria; esta devolve `null`.
 */
export function recipientOrBroadcast(row: {
  userId?: string | null;
  responsibleId?: string | null;
}): NotificationRecipient | null {
  if (!row.userId && !row.responsibleId) return null;
  return recipientOf(row);
}

/** É aviso de CLIENTE? Atalho de leitura para os pontos que só precisam do desvio. */
export function targetsResponsible(row: { responsibleId?: string | null }): boolean {
  return !!row.responsibleId;
}
