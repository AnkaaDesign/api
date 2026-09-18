/**
 * A DISCRIMINAÇÃO DA NFS-e — o único texto que o cliente e o fiscal LEEM.
 *
 * No DANFSe do padrão nacional não há tabela de itens impressa: o quadro
 * "Descrição do Serviço" é tudo o que a folha mostra sobre o que foi feito e
 * para quem. Um orçamento multiveículo faturado de uma vez cabe inteiro nesse
 * quadro, e é por isso que ele tem de ser ORGANIZADO e não uma frase corrida.
 *
 * O que sai, para uma fatura de N veículos:
 *
 *     Pedido: 4000000 - Orçamento nº 984
 *     Serviços: Logomarca Lateral, Aerografia Traseira
 *     Veículos (4) - Toco Refrigerado:
 *     1) Série 78000 - Placa TES1T01 - Chassi 9BM979026CS006622
 *     2) Série 78001 - Placa TES1T02 - Chassi 9BM979026CS006623
 *     3) Série 78002 - Placa TES1T03 - Chassi 9BM979026CS006624
 *     4) Série 78003 - Placa TES1T04 - Chassi 9BM979026CS006625
 *
 * ⚠️ O TETO É RÍGIDO: {@link DISCRIMINACAO_MAX_LINES} linhas de
 * {@link DISCRIMINACAO_MAX_CHARS} caracteres. Quando os veículos não cabem, a
 * lista COLAPSA para contagem + faixa de séries — e nunca a lista de serviços,
 * que é o que sustenta a nota perante o fisco. A ordem de prioridade é:
 * identificação (1 linha) → serviços → veículos.
 *
 * A NOTA DE UM VEÍCULO SÓ NÃO MUDA. É o formato de todas as notas emitidas até
 * aqui, está conferido com a prefeitura e não há nada a organizar numa lista de
 * um item; mexer nele seria risco sem ganho.
 *
 * Este módulo é PURO de propósito: a prévia do web
 * (`web/src/components/financial/billing/preview/billing-document-previews.tsx`)
 * espelha estas regras, e `tests/nfse-discriminacao.test.ts` as trava.
 */

export const DISCRIMINACAO_MAX_LINES = 11;
export const DISCRIMINACAO_MAX_CHARS = 255;
/** Teto de linhas que a lista de serviços pode tomar antes dos veículos. */
export const DISCRIMINACAO_MAX_SERVICE_LINES = 3;

export interface DiscriminacaoVehicle {
  serialNumber?: string | null;
  plate?: string | null;
  chassisNumber?: string | null;
  category?: string | null;
  implementType?: string | null;
  /** O pedido de compra DESTE veículo — mora na tarefa, não no pagador. */
  orderNumber?: string | null;
}

export interface DiscriminacaoInput {
  /** Rótulo do(s) pedido(s) da fatura, já montado por `orderNumberLabel`. */
  orderNumber?: string | null;
  budgetNumber?: number | null;
  /** Os veículos que ESTA nota cobre, na ordem do documento. */
  vehicles: DiscriminacaoVehicle[];
  /** Descrições dos serviços, na ordem das linhas da nota. */
  services: string[];
  /** Descrição explícita: substitui o CORPO (os serviços), nunca a identificação. */
  description?: string | null;
  /** Recuo quando nenhum veículo se identifica ("Ref. OS 78000"). */
  fallbackLabel?: string | null;
  categoryLabels: Record<string, string>;
  implementLabels: Record<string, string>;
}

const clamp = (value: string): string => value.slice(0, DISCRIMINACAO_MAX_CHARS);

/** "Toco Refrigerado" — categoria + implemento, como a nota os nomeia. */
export function vehicleTypeLabel(
  vehicle: DiscriminacaoVehicle,
  categoryLabels: Record<string, string>,
  implementLabels: Record<string, string>,
): string {
  const parts: string[] = [];
  if (vehicle.category) parts.push(categoryLabels[vehicle.category] ?? vehicle.category);
  if (vehicle.implementType) {
    parts.push(implementLabels[vehicle.implementType] ?? vehicle.implementType);
  }
  return parts.join(' ');
}

/**
 * Um veículo por extenso, no formato da NOTA DE UM VEÍCULO SÓ:
 * "Toco Refrigerado de n série: 78000, placa: TES1T01, chassi: 9BM…".
 */
export function describeOneVehicle(
  vehicle: DiscriminacaoVehicle,
  categoryLabels: Record<string, string>,
  implementLabels: Record<string, string>,
): string {
  const typePart = vehicleTypeLabel(vehicle, categoryLabels, implementLabels);
  const idParts: string[] = [];
  if (vehicle.serialNumber) idParts.push(`n série: ${vehicle.serialNumber}`);
  if (vehicle.plate) idParts.push(`placa: ${vehicle.plate}`);
  if (vehicle.chassisNumber) idParts.push(`chassi: ${vehicle.chassisNumber}`);
  const idPart = idParts.join(', ');
  if (typePart && idPart) return `${typePart} de ${idPart}`;
  return typePart || idPart;
}

/** Uma linha da LISTA: "1) Série 78000 - Placa TES1T01 - Chassi 9BM…". */
function vehicleListLine(
  vehicle: DiscriminacaoVehicle,
  index: number,
  options: {
    showType: boolean;
    showOrderNumber: boolean;
    categoryLabels: Record<string, string>;
    implementLabels: Record<string, string>;
  },
): string {
  const parts: string[] = [];
  if (options.showType) {
    const type = vehicleTypeLabel(vehicle, options.categoryLabels, options.implementLabels);
    if (type) parts.push(type);
  }
  if (vehicle.serialNumber) parts.push(`Série ${vehicle.serialNumber}`);
  if (vehicle.plate) parts.push(`Placa ${vehicle.plate}`);
  if (vehicle.chassisNumber) parts.push(`Chassi ${vehicle.chassisNumber}`);
  if (options.showOrderNumber && vehicle.orderNumber) parts.push(`Pedido ${vehicle.orderNumber}`);
  return clamp(`${index + 1}) ${parts.join(' - ')}`);
}

/** Empacota descrições em até `maxLines` linhas de `maxChars`, juntando por vírgula. */
export function packServiceLines(
  descriptions: string[],
  maxLines: number,
  maxChars = DISCRIMINACAO_MAX_CHARS,
): string[] {
  const lines: string[] = [];
  let current = '';
  for (const raw of descriptions) {
    const item = (raw || '').slice(0, maxChars);
    if (!item) continue;
    if (current === '') {
      current = item;
    } else if (current.length + 2 + item.length <= maxChars) {
      current += `, ${item}`;
    } else {
      lines.push(current);
      if (lines.length >= maxLines) return lines;
      current = item;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

/** "(séries 78000 a 78003)" — a faixa que substitui a lista quando ela não cabe. */
function serialRange(vehicles: DiscriminacaoVehicle[]): string {
  const serials = vehicles
    .map(v => v.serialNumber)
    .filter((n): n is string => Boolean(n))
    .sort();
  if (serials.length === 0) return '';
  if (serials.length === 1) return ` (série ${serials[0]})`;
  return ` (séries ${serials[0]} a ${serials[serials.length - 1]})`;
}

export function buildDiscriminacao(input: DiscriminacaoInput): string {
  const { categoryLabels, implementLabels } = input;
  const vehicles = (input.vehicles ?? []).filter(
    v => describeOneVehicle(v, categoryLabels, implementLabels).length > 0,
  );
  const orderNumber = (input.orderNumber ?? '').trim();
  const budgetRef = input.budgetNumber ? `Orçamento nº ${input.budgetNumber}` : '';

  // ── A nota de UM veículo (ou de nenhum identificado): formato legado ───────
  if (vehicles.length <= 1) {
    const headerLines: string[] = [];
    if (orderNumber) headerLines.push(clamp(`Pedido: ${orderNumber}`));
    const described = vehicles.length === 1
      ? describeOneVehicle(vehicles[0], categoryLabels, implementLabels)
      : '';
    if (described) {
      headerLines.push(clamp(`Referente aos serviços executados no veículo ${described}.`));
    } else if (input.fallbackLabel) {
      headerLines.push(clamp(input.fallbackLabel));
    }
    const body = input.description
      ? [clamp(input.description)]
      : packServiceLines(
          input.services,
          Math.max(1, DISCRIMINACAO_MAX_LINES - headerLines.length),
        );
    return [...headerLines, ...body].slice(0, DISCRIMINACAO_MAX_LINES).join('\n');
  }

  // ── A nota MULTIVEÍCULO: identificação, serviços, lista de veículos ────────
  const lines: string[] = [];

  // Pedidos DIVERGENTES entre os veículos vão em cada linha da lista; iguais (o
  // caso comum) vão uma vez no cabeçalho. O rótulo do lote (`orderNumber`) é o
  // que sobra quando a lista colapsa.
  const distinctOrders = Array.from(
    new Set(vehicles.map(v => (v.orderNumber ?? '').trim()).filter(Boolean)),
  );
  const perVehicleOrders = distinctOrders.length > 1;

  const identParts: string[] = [];
  if (orderNumber && !perVehicleOrders) identParts.push(`Pedido: ${orderNumber}`);
  if (budgetRef) identParts.push(budgetRef);
  if (identParts.length > 0) lines.push(clamp(identParts.join(' - ')));

  // Os serviços vêm ANTES da lista: se o teto apertar, quem encolhe é a lista.
  const serviceLines = input.description
    ? [clamp(input.description)]
    : packServiceLines(
        input.services,
        DISCRIMINACAO_MAX_SERVICE_LINES,
        DISCRIMINACAO_MAX_CHARS - 'Serviços: '.length,
      ).map((line, i) => (i === 0 ? `Serviços: ${line}` : line));
  lines.push(...serviceLines);

  const firstType = vehicleTypeLabel(vehicles[0], categoryLabels, implementLabels);
  const sameType = vehicles.every(
    v => vehicleTypeLabel(v, categoryLabels, implementLabels) === firstType,
  );
  const typeSuffix = sameType && firstType ? ` - ${firstType}` : '';
  const remaining = DISCRIMINACAO_MAX_LINES - lines.length;

  if (remaining >= vehicles.length + 1) {
    lines.push(clamp(`Veículos (${vehicles.length})${typeSuffix}:`));
    vehicles.forEach((vehicle, index) => {
      lines.push(
        vehicleListLine(vehicle, index, {
          showType: !sameType,
          showOrderNumber: perVehicleOrders,
          categoryLabels,
          implementLabels,
        }),
      );
    });
  } else if (remaining >= 1) {
    // Não cabe a lista: contagem, tipo e faixa de séries. Quem precisa do
    // veículo a veículo tem o orçamento assinado e o dossiê, ambos completos.
    const typeWord = sameType && firstType ? ` ${firstType}` : '';
    const pedido = perVehicleOrders && orderNumber ? ` Pedidos: ${orderNumber}.` : '';
    lines.push(
      clamp(
        `Referente aos serviços executados em ${vehicles.length} veículos${typeWord}` +
          `${serialRange(vehicles)}.${pedido}`,
      ),
    );
  }

  return lines.slice(0, DISCRIMINACAO_MAX_LINES).join('\n');
}
