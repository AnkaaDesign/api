/**
 * Os eventos da ARTE DO IMPLEMENTO (P12).
 *
 * O ATOR É DISCRIMINADO: quem decide é um funcionário (`USER`, pela tela interna,
 * inclusive "em nome do cliente") ou um contato do cliente (`RESPONSIBLE`, pelo
 * portal). ⚠️ Nunca gravar o id de um `Responsible` num campo de `User` — foi o
 * defeito do `@UserId()` de 17/09, que caía no `request.user?.id` do portal.
 */

export type LayoutActor =
  | { kind: 'USER'; id: string; name: string | null }
  | { kind: 'RESPONSIBLE'; id: string; name: string | null };

/** O que o aviso precisa saber da arte e de onde ela está. */
export interface LayoutEventContext {
  layout: { id: string; fileId: string; status: string };
  implementId: string;
  task: { id: string; name: string | null; serialNumber: string | null } | null;
}

/** A arte foi enviada ao cliente (DRAFT → PENDING_APPROVAL). */
export class LayoutSentEvent {
  constructor(
    public readonly context: LayoutEventContext,
    public readonly sentBy: LayoutActor,
  ) {}
}

/** A arte foi aprovada (pelo portal ou em nome do cliente). */
export class LayoutApprovedEvent {
  constructor(
    public readonly context: LayoutEventContext,
    public readonly approvedBy: LayoutActor,
    public readonly note?: string | null,
  ) {}
}

/** A arte foi reprovada (pelo portal, com motivo, ou internamente). */
export class LayoutReprovedEvent {
  constructor(
    public readonly context: LayoutEventContext,
    public readonly reprovedBy: LayoutActor,
    public readonly reason?: string | null,
  ) {}
}

/** Lembrete diário: arte enviada ao cliente e ainda sem resposta. */
export class LayoutPendingApprovalReminderEvent {
  constructor(
    public readonly context: LayoutEventContext,
    public readonly daysPending: number,
  ) {}
}
