import { INVOICE_STATUS } from '../constants/enums';

/**
 * A FATURA VIVA DE UMA FATIA — e por que isto precisou virar um conceito com nome.
 *
 * `Invoice.customerConfigId` foi declarado `@unique` no `schema.prisma` e o índice
 * global correspondente foi DROPADO do banco em
 * `20260506000001_invoice_customer_config_partial_unique`, trocado por um índice
 * PARCIAL — `UNIQUE (customerConfigId) WHERE status <> 'CANCELLED'`. O schema ficou
 * para trás, e por meses o cliente do Prisma entregou `config.invoice` como se fosse
 * uma fatura só, enquanto o banco já guardava **a viva mais todas as canceladas dos
 * ciclos anteriores**. Qual delas o Prisma devolvia não era escolha de ninguém.
 *
 * Isso não era teórico: a leitura que decide se uma fatia está CONGELADA
 * (`budget-customer-config-sync.ts`) perguntava `invoice.status !== 'CANCELLED'`.
 * Recebendo a CANCELADA de um ciclo antigo, a resposta era "não congelada" — e a
 * cobertura de um faturamento VIVO voltava a ser reescrita.
 *
 * Agora a relação é `invoices: Invoice[]`, como o banco sempre foi, e a pergunta
 * "qual é a fatura desta fatia?" tem uma resposta só, escrita aqui. O índice parcial
 * garante que no máximo uma sobreviva ao filtro.
 */

/** Filtro Prisma da fatura viva. Use no `where` de `invoices` ao incluir a fatia. */
export const LIVE_INVOICE_WHERE = {
  status: { not: INVOICE_STATUS.CANCELLED },
} as const;

type MaybeInvoice = { status: string } | null | undefined;

/**
 * A fatura viva entre as da fatia, ou `null`. Aceita tanto a lista nova (`invoices`)
 * quanto o campo antigo (`invoice`), para que um chamador que ainda não migrou o
 * `include` não silencie a resposta — ele recebe a mesma verdade.
 */
export function liveInvoiceOf<T extends MaybeInvoice>(
  config: { invoices?: readonly T[] | null; invoice?: T } | null | undefined,
): T | null {
  if (!config) return null;
  const list = config.invoices;
  if (Array.isArray(list)) {
    return list.find(i => i && i.status !== INVOICE_STATUS.CANCELLED) ?? null;
  }
  const single = config.invoice;
  if (single && single.status !== INVOICE_STATUS.CANCELLED) return single;
  return null;
}

/** A fatia tem fatura viva? É metade do critério de "congelada". */
export function hasLiveInvoice(
  config: { invoices?: readonly MaybeInvoice[] | null; invoice?: MaybeInvoice } | null | undefined,
): boolean {
  return liveInvoiceOf(config as any) !== null;
}
