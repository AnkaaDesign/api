/**
 * Nº DO PEDIDO DE COMPRA como condição da assinatura de quem é de COMPRAS.
 *
 * A REGRA
 *   Quem assina pelo setor de compras do cliente (`Responsible.roles` contém
 *   `PURCHASING`) só assina se cada veículo do orçamento tiver o nº do pedido
 *   — o que já estava na tarefa, ou o que ele informa na própria cerimônia.
 *   O pedido é o documento de compras do cliente: é ele que a nota e o boleto
 *   precisam citar para o contas a pagar do outro lado aceitar a cobrança, e
 *   quem emite o pedido é justamente esta pessoa. Pedir o número no ato em que
 *   ela aprova o orçamento é pedir no único momento em que ela certamente o
 *   tem à mão.
 *
 * POR QUE ISTO NÃO MEXE NO DOCUMENTO ASSINADO
 *   O nº do pedido já é uma LACUNA DE CADASTRO TARDIO (`LateSlotKey`): o
 *   documento é congelado com o retângulo reservado e o valor é carimbado nele
 *   quando chega. E ele está fora do recorte material e fora do diff
 *   (`QuoteSnapshotVehicle.orderNumber`), então preenchê-lo durante a coleta
 *   não invalida ninguém — nem esta assinatura, nem as dos outros.
 *
 * O QUE O SIGNATÁRIO PODE E NÃO PODE FAZER
 *   · Preencher o que está VAZIO. Só isso.
 *   · Nunca sobrescrever um número que a Ankaa já registrou: esse número pode
 *     já estar numa NFS-e emitida, e uma página pública não é lugar de trocar
 *     dado fiscal. Se estiver errado, ele fala com a Ankaa.
 *   · Número mandado por quem NÃO é de compras é ignorado, não gravado: a
 *     regra pedida é sobre compras, e abrir escrita em `Task` para qualquer
 *     link de assinatura seria ampliar a superfície pública sem motivo.
 *
 * Este arquivo é PURO (sem Prisma, sem Nest) para que a regra possa ser lida e
 * testada sem subir a aplicação. Quem grava é `SignatureEnvelopeService`.
 */

import { RESPONSIBLE_ROLE } from '@constants/enums';

/**
 * Teto do número. O maior registrado em 23/09/2026 tinha 16 caracteres; 60 dá
 * folga para formatos com prefixo e ano ("PC-4500123456/2026-A") sem deixar o
 * campo virar texto livre — ele sai impresso na nota e no boleto.
 */
export const ORDER_NUMBER_MAX_LENGTH = 60;

/**
 * Caracteres aceitos: letras (com acento), dígitos, espaço e a pontuação que
 * aparece em número de pedido de verdade. Fora disso — quebra de linha,
 * controle, emoji, `<` — é recusado: o valor vai para XML de NFS-e e para
 * PDF, e nenhum sistema de compras emite pedido com esses caracteres.
 */
const ORDER_NUMBER_PATTERN = /^[\p{L}\p{N} .\-\/#_]+$/u;

/** Espaços das pontas fora, espaços internos colapsados. */
export function normalizeOrderNumber(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** `null` quando válido; a mensagem de recusa quando não. */
export function orderNumberProblem(value: string): string | null {
  if (!value) return 'Informe o nº do pedido de compra.';
  if (value.length > ORDER_NUMBER_MAX_LENGTH) {
    return `O nº do pedido deve ter no máximo ${ORDER_NUMBER_MAX_LENGTH} caracteres.`;
  }
  if (!ORDER_NUMBER_PATTERN.test(value)) {
    return 'O nº do pedido só pode ter letras, números, espaço e os símbolos . - / # _';
  }
  if (!/[\p{L}\p{N}]/u.test(value)) return 'Informe o nº do pedido de compra.';
  return null;
}

/**
 * Quem está sujeito à regra: contato do CLIENTE com a função Compras.
 *
 * Qualquer uma das funções basta — `roles` é lista, e um contato COMERCIAL +
 * COMPRAS continua sendo quem emite o pedido. As funções são lidas do cadastro
 * VIVO, não do congelamento: isto é regra de negócio sobre quem pode concluir,
 * não evidência do que foi lido.
 */
export function signerRequiresOrderNumber(
  roles: readonly string[] | null | undefined,
): boolean {
  return (roles ?? []).includes(RESPONSIBLE_ROLE.PURCHASING);
}

export interface OrderNumberTask {
  id: string;
  name?: string | null;
  status?: string | null;
  serialNumber?: string | null;
  customerOrderNumber?: string | null;
  implement?: { plate?: string | null } | null;
}

/**
 * As tarefas que PRECISAM do número, na ordem que o chamador passou (a do
 * documento — `sortQuoteTasks`).
 *
 * Tarefa cancelada sai: cobrar pedido de um veículo que não vai ser pintado
 * travaria a assinatura por um implemento que não existe mais no negócio. Se
 * TODAS estiverem canceladas, o conjunto inteiro volta — um orçamento vivo
 * nessa condição é anomalia, e a regra não pode desaparecer por causa dela.
 */
export function orderNumberScope<T extends OrderNumberTask>(tasks: readonly T[]): T[] {
  const live = tasks.filter(t => t.status !== 'CANCELLED');
  return live.length ? live : [...tasks];
}

/** "Série 1234 · ABC1D23" — como o signatário reconhece o veículo. */
export function orderNumberVehicleLabel(task: OrderNumberTask, index: number): string {
  const parts: string[] = [];
  if (task.serialNumber?.trim()) parts.push(`Série ${task.serialNumber.trim()}`);
  if (task.implement?.plate?.trim()) parts.push(task.implement.plate.trim().toUpperCase());
  if (parts.length === 0 && task.name?.trim()) parts.push(task.name.trim());
  return parts.length ? parts.join(' · ') : `Veículo ${index + 1}`;
}

export interface OrderNumberVehicle {
  taskId: string;
  label: string;
  /** O número registrado AGORA; `null` quando falta. */
  value: string | null;
}

export function orderNumberVehicles(tasks: readonly OrderNumberTask[]): OrderNumberVehicle[] {
  return orderNumberScope(tasks).map((t, index) => ({
    taskId: t.id,
    label: orderNumberVehicleLabel(t, index),
    value: normalizeOrderNumber(t.customerOrderNumber) || null,
  }));
}

export interface OrderNumberResolution {
  /** Veículos sem número em que o signatário informou um válido. */
  toWrite: Array<{ taskId: string; value: string }>;
  /** Mensagem de recusa; `null` quando a assinatura pode seguir. */
  problem: string | null;
}

/**
 * Confronta o que o signatário mandou com o que falta.
 *
 * Chamado ANTES de verificar o código: uma recusa aqui não pode queimar o
 * desafio de uso único, senão quem esqueceu um campo esperaria o cooldown para
 * receber outro código.
 *
 * Número mandado para veículo que JÁ tem número é ignorado, não recusado: a
 * tela pode ter sido aberta antes de a Ankaa registrar o pedido, e o
 * signatário não fez nada errado. Veículo que não é deste orçamento é
 * recusado — aí sim a entrada não faz sentido.
 */
export function resolveOrderNumberSubmission(
  vehicles: readonly OrderNumberVehicle[],
  submitted: ReadonlyArray<{ taskId?: string; value?: string }> | null | undefined,
): OrderNumberResolution {
  const byTask = new Map<string, string>();
  const known = new Set(vehicles.map(v => v.taskId));
  for (const row of submitted ?? []) {
    if (!row?.taskId) continue;
    if (!known.has(row.taskId)) {
      return {
        toWrite: [],
        problem: 'Veículo do pedido não pertence a este orçamento. Recarregue a página.',
      };
    }
    byTask.set(row.taskId, normalizeOrderNumber(row.value));
  }

  const toWrite: Array<{ taskId: string; value: string }> = [];
  const multi = vehicles.length > 1;
  for (const v of vehicles) {
    if (v.value) continue;
    const typed = byTask.get(v.taskId) ?? '';
    const problem = orderNumberProblem(typed);
    if (problem) {
      return {
        toWrite: [],
        problem: typed
          ? multi
            ? `${v.label}: ${problem}`
            : problem
          : multi
            ? `Informe o nº do pedido de compra de cada veículo para assinar (falta: ${v.label}).`
            : 'Informe o nº do pedido de compra para assinar.',
      };
    }
    toWrite.push({ taskId: v.taskId, value: typed });
  }
  return { toWrite, problem: null };
}
