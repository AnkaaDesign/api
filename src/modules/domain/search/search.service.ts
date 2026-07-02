import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { UserPayload } from '@modules/common/auth/decorators/user.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { canAccessAnyPrivilege } from '../../../utils/privilege';
import { normalizeSearchTerm } from '../../../schemas/common';
import { GlobalSearchFormData } from '../../../schemas/search';
import { GlobalSearchEntity, GlobalSearchGroup, GlobalSearchResponse, GlobalSearchResultField, GlobalSearchResultItem } from '../../../types';
import { scoreCandidate, ScoredField } from './search-scoring';

interface SearchContext {
  prisma: PrismaService;
  /** Raw query as typed (trimmed). */
  raw: string;
  /** Accent/case-normalized query (mirrors the *Normalized DB columns). */
  normalized: string;
  /** Normalized query split into tokens — every token must match somewhere (AND of ORs). */
  tokens: string[];
  /** Parsed integer when the query is purely numeric (serial/order/payroll lookups). */
  numeric: number | null;
  /**
   * Whether the query may substring-match invisible identity numbers (CPF, CNPJ,
   * PIS, phone). Short digit fragments ("31") match half the database through
   * these fields and confuse users, so they require >= 5 digits.
   */
  matchIdentityNumbers: boolean;
  /** Skip e-mail substring matching for short pure-numeric queries (same noise problem). */
  matchEmails: boolean;
  /** Day ranges when the query looks like a date ("24/11", "24/11/2020") — year-less queries span recent years. */
  dateRanges: Array<{ gte: Date; lt: Date }> | null;
  /** How many candidates to fetch per entity before scoring. */
  fetch: number;
  /** How many results to return per entity after scoring. */
  take: number;
}

interface EntitySearcher {
  entity: GlobalSearchEntity;
  label: string;
  /**
   * Mirrors the web detail-page route privileges (utils/route-privileges.ts on web),
   * so a spotlight result never navigates into a 403 page. ADMIN always passes.
   */
  privileges: SECTOR_PRIVILEGES[];
  run: (ctx: SearchContext) => Promise<GlobalSearchResultItem[]>;
}

/** AND-of-ORs: every token must match at least one of the field clauses. */
const everyToken = (tokens: string[], clausesFor: (token: string) => object[]) =>
  tokens.map((token) => ({ OR: clausesFor(token) }));

/** Builds the labeled identity line; entries with empty values are dropped. */
const fieldList = (...entries: Array<{ label?: string; value: string | number | null | undefined }>): GlobalSearchResultField[] | null => {
  const fields = entries
    .filter((entry) => entry.value !== null && entry.value !== undefined && String(entry.value).trim() !== '')
    .map((entry) => (entry.label ? { label: entry.label, value: String(entry.value) } : { value: String(entry.value) }));
  return fields.length > 0 ? fields : null;
};

const formatCnpj = (cnpj: string | null | undefined): string | null => {
  if (!cnpj) return null;
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return cnpj;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};

const isoDate = (label: string, value: Date | null | undefined): { label: string; iso: string } | null =>
  value ? { label, iso: value.toISOString() } : null;

/** "24/11" | "24/11/20" | "24/11/2020" → day ranges (server-local midnight boundaries). Year-less spans recent years. */
const parseDateQuery = (raw: string): Array<{ gte: Date; lt: Date }> | null => {
  const parsed = /^([0-3]?\d)[/-]([01]?\d)(?:[/-](\d{2}|\d{4}))?$/.exec(raw);
  if (!parsed) return null;
  const day = Number(parsed[1]);
  const month = Number(parsed[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const years: number[] = [];
  if (parsed[3]) {
    years.push(parsed[3].length === 2 ? 2000 + Number(parsed[3]) : Number(parsed[3]));
  } else {
    const currentYear = new Date().getFullYear();
    for (let year = currentYear - 6; year <= currentYear + 1; year++) years.push(year);
  }
  return years.map((year) => ({ gte: new Date(year, month - 1, day), lt: new Date(year, month - 1, day + 1) }));
};

const dateFieldClauses = (field: string, ranges: Array<{ gte: Date; lt: Date }>) =>
  ranges.map((range) => ({ [field]: { gte: range.gte, lt: range.lt } }));

const inDateRanges = (value: Date | null | undefined, ranges: Array<{ gte: Date; lt: Date }>): boolean =>
  !!value && ranges.some((range) => value >= range.gte && value < range.lt);

const formatDateBr = (value: Date): string =>
  `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;

const DATE_MATCH_SCORE = 500;

/** Boosts rows found via a date query and explains which date field matched (first hit wins). */
const applyDateMatch = (
  base: { score: number; match: { label: string; value: string } | null },
  ranges: Array<{ gte: Date; lt: Date }> | null,
  candidates: Array<{ label: string; value: Date | null | undefined }>,
): { score: number; match: { label: string; value: string } | null } => {
  if (!ranges) return base;
  for (const candidate of candidates) {
    if (inDateRanges(candidate.value, ranges)) {
      return {
        score: Math.max(base.score, DATE_MATCH_SCORE),
        match: base.match ?? { label: candidate.label, value: formatDateBr(candidate.value as Date) },
      };
    }
  }
  return base;
};

const OFF_PAYROLL_LABELS: Record<string, string> = {
  INTERN: 'Estagiário',
  TERCEIRIZADO: 'Terceirizado',
  PJ: 'PJ',
  AUTONOMOUS: 'Autônomo',
};

interface CollaboratorContractDates {
  admissionDate: Date | null;
  exp1EndAt: Date | null;
  exp2EndAt: Date | null;
  effectedAt: Date | null;
  terminationDate: Date | null;
}

/**
 * Collaborator situação — mirrors web utils/user.ts getCollaboratorStatus
 * (minus the leave/notice overlays, which need extra queries): TERMINATED →
 * Desligado, no bond → Sem vínculo, off-payroll → Terceirizado/PJ/...,
 * experience contract types → Em experiência 1/2, INDETERMINATE+ACTIVE →
 * Efetivado, else Ativo. Each status pairs with its meaningful contract date.
 */
function collaboratorStatus(
  status: string | null,
  contractType: string | null,
  employeeType: string | null,
  contract: CollaboratorContractDates | null,
): { label: string; variant: string; date: { label: string; iso: string } | null } {
  if (status === 'TERMINATED') {
    return { label: 'Desligado', variant: 'red', date: isoDate('Desligado em', contract?.terminationDate) };
  }
  if (status == null) {
    return { label: 'Sem vínculo', variant: 'gray', date: null };
  }
  if (employeeType && employeeType !== 'CLT') {
    return {
      label: OFF_PAYROLL_LABELS[employeeType] ?? employeeType,
      variant: 'teal',
      date: isoDate('Admitido em', contract?.admissionDate),
    };
  }
  if (contractType === 'EXPERIENCE_PERIOD_1') {
    return {
      label: 'Em experiência 1',
      variant: 'blue',
      date: isoDate('Experiência até', contract?.exp1EndAt) ?? isoDate('Admitido em', contract?.admissionDate),
    };
  }
  if (contractType === 'EXPERIENCE_PERIOD_2') {
    return {
      label: 'Em experiência 2',
      variant: 'orange',
      date: isoDate('Experiência até', contract?.exp2EndAt) ?? isoDate('Admitido em', contract?.admissionDate),
    };
  }
  if (contractType === 'INDETERMINATE') {
    return {
      label: 'Efetivado',
      variant: 'green',
      date: isoDate('Efetivado em', contract?.effectedAt) ?? isoDate('Admitido em', contract?.admissionDate),
    };
  }
  return { label: 'Ativo', variant: 'blue', date: isoDate('Admitido em', contract?.admissionDate) };
}

const rankAndSlice = (items: GlobalSearchResultItem[], take: number) => items.sort((a, b) => b.score - a.score).slice(0, take);

const taskSearcher: EntitySearcher = {
  entity: 'TASK',
  label: 'Tarefas',
  privileges: [
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.PLOTTING,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ADMIN,
  ],
  run: async ({ prisma, normalized, tokens, numeric, dateRanges, fetch, take }) => {
    const tasks = await prisma.task.findMany({
      where: {
        OR: [
          {
            AND: everyToken(tokens, (t) => [
          { nameNormalized: { contains: t } },
          { serialNumberNormalized: { contains: t } },
          { detailsNormalized: { contains: t } },
          { customer: { fantasyNameNormalized: { contains: t } } },
          { customer: { corporateNameNormalized: { contains: t } } },
          { generalPainting: { nameNormalized: { contains: t } } },
          { generalPainting: { codeNormalized: { contains: t } } },
          { logoPaints: { some: { nameNormalized: { contains: t } } } },
          { logoPaints: { some: { codeNormalized: { contains: t } } } },
          { truck: { plateNormalized: { contains: t } } },
          { truck: { chassisNumberNormalized: { contains: t } } },
              { serviceOrders: { some: { descriptionNormalized: { contains: t } } } },
            ]),
          },
          // Orçamento Nº ("0538" → 538) opens the task it belongs to.
          ...(numeric !== null ? [{ quote: { budgetNumber: numeric } }] : []),
          ...(dateRanges
            ? [
                ...dateFieldClauses('finishedAt', dateRanges),
                ...dateFieldClauses('startedAt', dateRanges),
                ...dateFieldClauses('term', dateRanges),
                ...dateFieldClauses('entryDate', dateRanges),
                ...dateFieldClauses('createdAt', dateRanges),
              ]
            : []),
        ],
      },
      select: {
        id: true,
        name: true,
        serialNumber: true,
        details: true,
        status: true,
        finishedAt: true,
        startedAt: true,
        term: true,
        entryDate: true,
        createdAt: true,
        quote: { select: { budgetNumber: true } },
        customer: { select: { fantasyName: true, corporateName: true } },
        truck: { select: { plate: true, chassisNumber: true } },
        generalPainting: { select: { name: true } },
        // Only the relation rows that actually matched, so the "matched by"
        // hint can show them when the reason isn't visible in the row.
        logoPaints: {
          where: { OR: tokens.flatMap((t) => [{ nameNormalized: { contains: t } }, { codeNormalized: { contains: t } }]) },
          select: { name: true },
          take: 2,
        },
        serviceOrders: {
          where: { OR: tokens.map((t) => ({ descriptionNormalized: { contains: t } })) },
          select: { description: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: fetch,
    });

    return rankAndSlice(
      tasks.map((task) => {
        const fields: ScoredField[] = [
          { value: task.serialNumber, weight: 2 },
          { value: task.truck?.plate, weight: 2 },
          { value: task.name, weight: 1.5 },
          { value: task.customer?.fantasyName, weight: 1 },
          { value: task.customer?.corporateName, weight: 1, label: 'Razão social', hidden: true },
          { value: task.truck?.chassisNumber, weight: 1.5, label: 'Chassi', hidden: true },
          { value: task.generalPainting?.name, weight: 1, label: 'Tinta geral', hidden: true },
          ...task.logoPaints.map((paint) => ({ value: paint.name, weight: 1, label: 'Tinta do logo', hidden: true })),
          ...task.serviceOrders.map((so) => ({ value: so.description, weight: 0.8, label: 'Ordem de serviço', hidden: true })),
          { value: task.details, weight: 0.6, label: 'Detalhes', hidden: true },
          { value: task.quote ? String(task.quote.budgetNumber).padStart(4, '0') : null, weight: 2, label: 'Orçamento Nº', hidden: true },
        ];
        const { score, match } = applyDateMatch(scoreCandidate(fields, normalized, tokens), dateRanges, [
          { label: 'Concluída em', value: task.finishedAt },
          { label: 'Iniciada em', value: task.startedAt },
          { label: 'Prazo', value: task.term },
          { label: 'Entrada em', value: task.entryDate },
          { label: 'Criada em', value: task.createdAt },
        ]);
        return {
          entity: 'TASK' as const,
          id: task.id,
          title: task.name || 'Tarefa sem nome',
          fields: fieldList({ label: 'Nº série', value: task.serialNumber }, { label: 'Cliente', value: task.customer?.fantasyName }, { label: 'Placa', value: task.truck?.plate }),
          status: task.status,
          date: task.finishedAt ? isoDate('Concluída em', task.finishedAt) : isoDate('Criada em', task.createdAt),
          match,
          score,
        };
      }),
      take,
    );
  },
};

const itemSearcher: EntitySearcher = {
  entity: 'ITEM',
  label: 'Produtos',
  privileges: [SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
  run: async ({ prisma, raw, normalized, tokens, dateRanges, fetch, take }) => {
    const items = await prisma.item.findMany({
      where: {
        OR: [
          {
            AND: everyToken(tokens, (t) => [
              { nameNormalized: { contains: t } },
              { uniCodeNormalized: { contains: t } },
              { brands: { some: { nameNormalized: { contains: t } } } },
              { category: { nameNormalized: { contains: t } } },
              { supplier: { fantasyNameNormalized: { contains: t } } },
            ]),
          },
          { barcodes: { has: raw } },
          ...(dateRanges ? dateFieldClauses('createdAt', dateRanges) : []),
        ],
      },
      select: {
        id: true,
        name: true,
        uniCode: true,
        quantity: true,
        createdAt: true,
        barcodes: true,
        brands: { select: { name: true }, take: 1 },
        category: { select: { name: true } },
        supplier: { select: { fantasyName: true } },
      },
      take: fetch,
    });

    return rankAndSlice(
      items.map((item) => {
        const fields: ScoredField[] = [
          { value: item.uniCode, weight: 2 },
          { value: item.barcodes.join(' '), weight: 2, label: 'Código de barras', hidden: true },
          { value: item.name, weight: 1.5 },
          { value: item.brands[0]?.name, weight: 0.8 },
          { value: item.category?.name, weight: 0.8 },
          { value: item.supplier?.fantasyName, weight: 0.8, label: 'Fornecedor', hidden: true },
        ];
        const { score, match } = applyDateMatch(scoreCandidate(fields, normalized, tokens), dateRanges, [
          { label: 'Criado em', value: item.createdAt },
        ]);
        return {
          entity: 'ITEM' as const,
          id: item.id,
          title: item.name,
          fields: fieldList({ label: 'Código', value: item.uniCode }, { label: 'Marca', value: item.brands[0]?.name }, { label: 'Categoria', value: item.category?.name }),
          extra: `Qtd ${Number.isInteger(item.quantity) ? item.quantity : item.quantity.toFixed(2)}`,
          date: isoDate('Criado em', item.createdAt),
          match,
          score,
        };
      }),
      take,
    );
  },
};

const orderSearcher: EntitySearcher = {
  entity: 'ORDER',
  label: 'Pedidos',
  privileges: [SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.ADMIN],
  run: async ({ prisma, normalized, tokens, numeric, dateRanges, fetch, take }) => {
    // Orders match only on their OWN values (number, description, notes,
    // supplier) — matching through contained items was too noisy (user request).
    const orders = await prisma.order.findMany({
      where: {
        OR: [
          {
            AND: everyToken(tokens, (t) => [
              { descriptionNormalized: { contains: t } },
              { notesNormalized: { contains: t } },
              { supplier: { fantasyNameNormalized: { contains: t } } },
              { supplier: { corporateNameNormalized: { contains: t } } },
            ]),
          },
          ...(numeric !== null ? [{ orderNumber: numeric }] : []),
          ...(dateRanges ? [...dateFieldClauses('forecast', dateRanges), ...dateFieldClauses('createdAt', dateRanges)] : []),
        ],
      },
      select: {
        id: true,
        description: true,
        orderNumber: true,
        notes: true,
        status: true,
        forecast: true,
        createdAt: true,
        supplier: { select: { fantasyName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: fetch,
    });

    return rankAndSlice(
      orders.map((order) => {
        const fields: ScoredField[] = [
          { value: order.orderNumber, weight: 2 },
          { value: order.description, weight: 1.5 },
          { value: order.supplier?.fantasyName, weight: 1 },
          { value: order.notes, weight: 0.6, label: 'Observações', hidden: true },
        ];
        const { score, match } = applyDateMatch(scoreCandidate(fields, normalized, tokens), dateRanges, [
          { label: 'Previsão', value: order.forecast },
          { label: 'Criado em', value: order.createdAt },
        ]);
        return {
          entity: 'ORDER' as const,
          id: order.id,
          title: order.description,
          fields: fieldList({ label: 'Nº pedido', value: order.orderNumber }, { label: 'Fornecedor', value: order.supplier?.fantasyName }),
          status: order.status,
          date: order.forecast ? isoDate('Previsão', order.forecast) : isoDate('Criado em', order.createdAt),
          match,
          score,
        };
      }),
      take,
    );
  },
};

const userSearcher: EntitySearcher = {
  entity: 'USER',
  label: 'Colaboradores',
  privileges: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
  ],
  run: async ({ prisma, normalized, tokens, numeric, matchIdentityNumbers, matchEmails, dateRanges, fetch, take }) => {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          {
            AND: everyToken(tokens, (t) => [
              { nameNormalized: { contains: t } },
              ...(matchEmails ? [{ emailNormalized: { contains: t } }] : []),
              ...(matchIdentityNumbers ? [{ cpfNormalized: { contains: t } }, { phoneNormalized: { contains: t } }, { pisNormalized: { contains: t } }] : []),
              { position: { nameNormalized: { contains: t } } },
              { sector: { nameNormalized: { contains: t } } },
            ]),
          },
          ...(numeric !== null ? [{ payrollNumber: numeric }] : []),
          ...(dateRanges
            ? dateRanges.flatMap((range) => [
                { currentContract: { admissionDate: { gte: range.gte, lt: range.lt } } },
                { currentContract: { effectedAt: { gte: range.gte, lt: range.lt } } },
                { currentContract: { terminationDate: { gte: range.gte, lt: range.lt } } },
              ])
            : []),
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        cpf: true,
        phone: true,
        pis: true,
        payrollNumber: true,
        currentContractStatus: true,
        currentContractType: true,
        currentEmployeeType: true,
        currentContract: {
          select: { admissionDate: true, exp1EndAt: true, exp2EndAt: true, effectedAt: true, terminationDate: true },
        },
        position: { select: { name: true } },
        sector: { select: { name: true } },
      },
      take: fetch,
    });

    return rankAndSlice(
      users.map((user) => {
        const fields: ScoredField[] = [
          { value: user.payrollNumber, weight: 2 },
          { value: user.name, weight: 1.5 },
          { value: user.email, weight: 1, label: 'E-mail', hidden: true },
          { value: user.cpf, weight: 1, label: 'CPF', hidden: true },
          { value: user.phone, weight: 1, label: 'Telefone', hidden: true },
          { value: user.pis, weight: 1, label: 'PIS', hidden: true },
          { value: user.position?.name, weight: 0.8 },
          { value: user.sector?.name, weight: 0.8 },
        ];
        const { score, match } = applyDateMatch(scoreCandidate(fields, normalized, tokens), dateRanges, [
          { label: 'Desligado em', value: user.currentContract?.terminationDate },
          { label: 'Efetivado em', value: user.currentContract?.effectedAt },
          { label: 'Admitido em', value: user.currentContract?.admissionDate },
        ]);
        // Dismissed collaborators stay findable but rank below active ones.
        const penalized = user.currentContractStatus === 'TERMINATED' ? Math.round(score * 0.6) : score;
        const situacao = collaboratorStatus(user.currentContractStatus, user.currentContractType, user.currentEmployeeType, user.currentContract);
        return {
          entity: 'USER' as const,
          id: user.id,
          title: user.name,
          fields: fieldList({ label: 'Matrícula', value: user.payrollNumber }, { label: 'Cargo', value: user.position?.name }, { label: 'Setor', value: user.sector?.name }),
          status: user.currentContractStatus,
          statusLabel: situacao.label,
          statusVariant: situacao.variant,
          date: situacao.date,
          match,
          score: penalized,
        };
      }),
      take,
    );
  },
};

const paintSearcher: EntitySearcher = {
  entity: 'PAINT',
  label: 'Tintas',
  privileges: [
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.PRODUCTION,
  ],
  run: async ({ prisma, raw, normalized, tokens, fetch, take }) => {
    // Hex matching only for hex-looking queries — short digit fragments ("31")
    // would otherwise match half the palette through invisible hex codes.
    const hexQuery = /^#?[0-9a-fA-F]{4,8}$/.test(raw) ? raw.replace(/^#/, '') : null;

    // Paint.tags is String[] — partial matching needs raw SQL over unnest
    // (same pattern as paint.service.ts findPaintIdsByTagSearch).
    const tagMatches = await prisma.$queryRaw<{ id: string; tag: string }[]>`
      SELECT DISTINCT p.id, tag
      FROM "Paint" p, LATERAL unnest(p.tags) AS tag
      WHERE lower(immutable_unaccent(tag)) LIKE ${'%' + normalized + '%'}
      LIMIT 50
    `;
    const tagByPaintId = new Map(tagMatches.map((row) => [row.id, row.tag]));
    const tagIds = [...tagByPaintId.keys()];

    const paints = await prisma.paint.findMany({
      where: {
        OR: [
          {
            AND: everyToken(tokens, (t) => [
              { nameNormalized: { contains: t } },
              { codeNormalized: { contains: t } },
              { paintBrand: { nameNormalized: { contains: t } } },
              { paintType: { nameNormalized: { contains: t } } },
              { formulas: { some: { descriptionNormalized: { contains: t } } } },
            ]),
          },
          ...(hexQuery ? [{ hex: { contains: hexQuery, mode: 'insensitive' as const } }] : []),
          ...(tagIds.length > 0 ? [{ id: { in: tagIds } }] : []),
        ],
      },
      select: {
        id: true,
        name: true,
        code: true,
        hex: true,
        finish: true,
        paintBrand: { select: { name: true } },
        paintType: { select: { name: true } },
        formulas: {
          where: { OR: tokens.map((t) => ({ descriptionNormalized: { contains: t } })) },
          select: { description: true },
          take: 1,
        },
      },
      take: fetch,
    });

    return rankAndSlice(
      paints.map((paint) => {
        const fields: ScoredField[] = [
          { value: paint.code, weight: 2 },
          { value: paint.name, weight: 1.5 },
          { value: tagByPaintId.get(paint.id), weight: 1, label: 'Tag', hidden: true },
          { value: paint.formulas[0]?.description, weight: 0.8, label: 'Fórmula', hidden: true },
          ...(hexQuery ? [{ value: paint.hex, weight: 1.5, label: 'Hex', hidden: true }] : []),
          { value: paint.paintBrand?.name, weight: 0.8 },
          { value: paint.paintType?.name, weight: 0.8 },
        ];
        const { score, match } = scoreCandidate(fields, normalized, tokens);
        return {
          entity: 'PAINT' as const,
          id: paint.id,
          title: paint.name,
          fields: fieldList({ label: 'Código', value: paint.code }, { label: 'Marca', value: paint.paintBrand?.name }, { label: 'Tipo', value: paint.paintType?.name }),
          status: paint.finish,
          color: paint.hex,
          match,
          score,
        };
      }),
      take,
    );
  },
};

const customerSearcher: EntitySearcher = {
  entity: 'CUSTOMER',
  label: 'Clientes',
  privileges: [
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.COMMERCIAL,
  ],
  run: async ({ prisma, normalized, tokens, matchIdentityNumbers, matchEmails, fetch, take }) => {
    const customers = await prisma.customer.findMany({
      where: {
        AND: everyToken(tokens, (t) => [
          { fantasyNameNormalized: { contains: t } },
          { corporateNameNormalized: { contains: t } },
          ...(matchIdentityNumbers ? [{ cnpjNormalized: { contains: t } }, { cpfNormalized: { contains: t } }] : []),
          ...(matchEmails ? [{ emailNormalized: { contains: t } }] : []),
          { cityNormalized: { contains: t } },
        ]),
      },
      select: {
        id: true,
        fantasyName: true,
        corporateName: true,
        cnpj: true,
        cpf: true,
        email: true,
        city: true,
      },
      take: fetch,
    });

    return rankAndSlice(
      customers.map((customer) => {
        const fields: ScoredField[] = [
          { value: customer.cnpj, weight: 2, label: 'CNPJ', hidden: true },
          { value: customer.cpf, weight: 2, label: 'CPF', hidden: true },
          { value: customer.fantasyName, weight: 1.5 },
          { value: customer.corporateName, weight: 1.2 },
          { value: customer.email, weight: 1, label: 'E-mail', hidden: true },
          { value: customer.city, weight: 0.5 },
        ];
        const { score, match } = scoreCandidate(fields, normalized, tokens);
        return {
          entity: 'CUSTOMER' as const,
          id: customer.id,
          title: customer.fantasyName,
          fields: fieldList({ label: 'Razão social', value: customer.corporateName }, { label: 'CNPJ', value: formatCnpj(customer.cnpj) }, { label: 'Cidade', value: customer.city }),
          match,
          score,
        };
      }),
      take,
    );
  },
};

const supplierSearcher: EntitySearcher = {
  entity: 'SUPPLIER',
  label: 'Fornecedores',
  privileges: [SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
  run: async ({ prisma, normalized, tokens, matchIdentityNumbers, matchEmails, fetch, take }) => {
    const suppliers = await prisma.supplier.findMany({
      where: {
        AND: everyToken(tokens, (t) => [
          { fantasyNameNormalized: { contains: t } },
          { corporateNameNormalized: { contains: t } },
          ...(matchIdentityNumbers ? [{ cnpjNormalized: { contains: t } }] : []),
          ...(matchEmails ? [{ emailNormalized: { contains: t } }] : []),
          { cityNormalized: { contains: t } },
        ]),
      },
      select: {
        id: true,
        fantasyName: true,
        corporateName: true,
        cnpj: true,
        email: true,
        city: true,
      },
      take: fetch,
    });

    return rankAndSlice(
      suppliers.map((supplier) => {
        const fields: ScoredField[] = [
          { value: supplier.cnpj, weight: 2, label: 'CNPJ', hidden: true },
          { value: supplier.fantasyName, weight: 1.5 },
          { value: supplier.corporateName, weight: 1.2 },
          { value: supplier.email, weight: 1, label: 'E-mail', hidden: true },
          { value: supplier.city, weight: 0.5 },
        ];
        const { score, match } = scoreCandidate(fields, normalized, tokens);
        return {
          entity: 'SUPPLIER' as const,
          id: supplier.id,
          title: supplier.fantasyName,
          fields: fieldList({ label: 'Razão social', value: supplier.corporateName }, { label: 'CNPJ', value: formatCnpj(supplier.cnpj) }, { label: 'Cidade', value: supplier.city }),
          match,
          score,
        };
      }),
      take,
    );
  },
};

/**
 * Registry of spotlight searchers. Adding an entity = one new EntitySearcher
 * entry here + a route/icon mapping on the web (spotlight-entities.ts).
 */
const SEARCHERS: EntitySearcher[] = [taskSearcher, itemSearcher, orderSearcher, userSearcher, paintSearcher, customerSearcher, supplierSearcher];

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(private readonly prisma: PrismaService) {}

  async search(query: GlobalSearchFormData, user: UserPayload): Promise<GlobalSearchResponse> {
    const startedAt = Date.now();
    const raw = query.searchingFor.trim();
    const normalized = normalizeSearchTerm(raw);
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const numeric = /^\d{1,9}$/.test(raw) ? Number(raw) : null;
    const digitCount = raw.replace(/\D/g, '').length;
    const isPureNumeric = /^[\d.\-/() ]+$/.test(raw);

    const ctx: SearchContext = {
      prisma: this.prisma,
      raw,
      normalized,
      tokens,
      numeric,
      matchIdentityNumbers: digitCount >= 5,
      matchEmails: !isPureNumeric || digitCount >= 5,
      dateRanges: parseDateQuery(raw),
      take: query.limit,
      // Over-fetch so JS-side scoring can promote exact hits that arbitrary DB
      // ordering would otherwise leave outside the page.
      fetch: Math.max(query.limit * 3, 12),
    };

    const allowed = SEARCHERS.filter((searcher) => canAccessAnyPrivilege(user.role as SECTOR_PRIVILEGES, searcher.privileges));

    const settled = await Promise.allSettled(allowed.map((searcher) => searcher.run(ctx)));

    const groups: GlobalSearchGroup[] = [];
    settled.forEach((result, index) => {
      const searcher = allowed[index];
      if (result.status === 'rejected') {
        this.logger.error(`Spotlight searcher ${searcher.entity} failed: ${result.reason?.message ?? result.reason}`);
        return;
      }
      if (result.value.length === 0) return;
      groups.push({ entity: searcher.entity, label: searcher.label, items: result.value });
    });

    // Groups whose best hit is stronger come first (serial-number hit on a
    // task should outrank name hits on items, and vice versa).
    groups.sort((a, b) => (b.items[0]?.score ?? 0) - (a.items[0]?.score ?? 0));

    return {
      success: true,
      message: 'Busca realizada com sucesso',
      data: {
        query: raw,
        groups,
        tookMs: Date.now() - startedAt,
      },
    };
  }
}
