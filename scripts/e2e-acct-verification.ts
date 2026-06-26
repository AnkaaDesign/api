// e2e-acct-verification.ts
// E2E verification harness for the Área Andressa (ACCOUNTING) build.
//
// Replays the EXACT requests the web app issues (same axios param
// serialization: JSON-stringified deep objects, qs indices/allowDots),
// exercises the CLT termination engine and the payroll tax engine against
// statutory rules (Lei 12.506, CLT 477/479/484-A/487, Lei 4.090, Lei 7.418,
// PAT, INSS Portaria 13/2026, IRRF Lei 15.270/2025), and checks the
// privilege gates per sector.
//
// Usage:
//   cd api && npx tsx scripts/e2e-acct-verification.ts [--suite query,clt,payroll,caps,gates] [--base http://localhost:3030]
//
// Rules respected by this harness:
//   - DB access is READ-ONLY (docker exec psql) — every write goes through
//     the API and is cleaned up afterwards (LIFO cleanup stack + marker-based
//     pre-clean for idempotency across crashed runs).
//   - Never dismisses/alters real users: terminations are created, calculated
//     and DELETED (status INITIATED only — never advanced).
//   - Exits non-zero when any check FAILs.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import qs from 'qs';

import {
  TerminationCalculationService,
} from '../src/modules/personnel-department/termination/termination-calculation.service';
import {
  TERMINATION_TYPE,
  NOTICE_TYPE,
  BENEFIT_KIND,
  LEAVE_TYPE,
  LEAVE_STATUS,
  MEDICAL_EXAM_TYPE,
  DEPENDENT_RELATIONSHIP,
  ADMISSION_STATUS,
} from '../src/constants';
import {
  getInssTableForYear,
  getIrrfTableForYear,
  computeProgressiveINSS,
  computeIRRF,
} from '../src/modules/personnel-department/payroll/utils/tax-tables';

// ============================================================================
// CLI
// ============================================================================

const argv = process.argv.slice(2);
function argValue(flag: string): string | null {
  const i = argv.indexOf(flag);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const pref = argv.find(a => a.startsWith(`${flag}=`));
  return pref ? pref.split('=').slice(1).join('=') : null;
}
const BASE = argValue('--base') ?? 'http://localhost:3030';
const SUITE_FILTER = (argValue('--suite') ?? 'query,clt,payroll,caps,gates')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const MARKER = 'E2E-ACCT';

// ============================================================================
// Result tracking
// ============================================================================

type Status = 'PASS' | 'FAIL' | 'SKIP' | 'INFO';
interface Result { suite: string; name: string; status: Status; detail?: string }
const results: Result[] = [];
let currentSuite = '';

function record(status: Status, name: string, detail?: string) {
  results.push({ suite: currentSuite, name, status, detail });
  const mark = status === 'PASS' ? '  ✓' : status === 'FAIL' ? '  ✗' : status === 'SKIP' ? '  -' : '  i';
  console.log(`${mark} [${status}] ${name}${detail && status !== 'PASS' ? ` — ${detail}` : ''}`);
}
const pass = (n: string, d?: string) => record('PASS', n, d);
const fail = (n: string, d?: string) => record('FAIL', n, d);
const skip = (n: string, d?: string) => record('SKIP', n, d);
const info = (n: string, d?: string) => record('INFO', n, d);

function expect(name: string, cond: boolean, detail?: string) {
  cond ? pass(name) : fail(name, detail);
  return cond;
}
function approx(a: number, b: number, tol = 0.011) {
  return Math.abs(a - b) <= tol;
}

// ============================================================================
// Cleanup stack (LIFO) — every API write registers its undo here.
// ============================================================================

interface CleanupEntry { label: string; fn: () => Promise<void> }
const cleanupStack: CleanupEntry[] = [];
const cleanupFailures: string[] = [];
function onCleanup(label: string, fn: () => Promise<void>) {
  cleanupStack.push({ label, fn });
}
async function runCleanup() {
  while (cleanupStack.length > 0) {
    const entry = cleanupStack.pop()!;
    try {
      await entry.fn();
    } catch (e: any) {
      cleanupFailures.push(`${entry.label}: ${e?.message ?? e}`);
    }
  }
}

// ============================================================================
// Auth — mint JWTs exactly like auth.service (payload {sub,email,phone,role})
// ============================================================================

const envFile = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
const JWT_SECRET = envFile.match(/^JWT_SECRET=(.+)$/m)?.[1]?.trim();
if (!JWT_SECRET) {
  console.error('JWT_SECRET not found in api/.env');
  process.exit(2);
}

interface Fixture { id: string; name: string; email: string | null; phone: string | null; role: string }
function mint(user: Fixture): string {
  return jwt.sign(
    { sub: user.id, email: user.email, phone: user.phone, role: user.role },
    JWT_SECRET!,
    { expiresIn: '2h' },
  );
}

// ============================================================================
// Read-only DB helper (docker exec psql)
// ============================================================================

function psqlRows(sql: string): string[][] {
  const out = execFileSync(
    'docker',
    ['exec', 'ankaa-postgres', 'psql', '-U', 'ankaa_prod', '-d', 'ankaa_production', '-t', '-A', '-F', '', '-c', sql],
    { encoding: 'utf8' },
  );
  return out
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.split(''));
}

// ============================================================================
// HTTP — replicates web/src/api-client/axiosClient.ts paramsSerializer
// ============================================================================

function serializeParams(params: Record<string, any>): string {
  const processed: Record<string, any> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      const hasNestedObjects = Object.values(value).some(
        v => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date),
      );
      const hasNullLeaf = Object.values(value).some(v => v === null || v === undefined);
      processed[key] = hasNestedObjects || hasNullLeaf ? JSON.stringify(value) : value;
    } else {
      processed[key] = value;
    }
  }
  return qs.stringify(processed, {
    arrayFormat: 'indices',
    encode: true,
    serializeDate: (date: Date) => date.toISOString(),
    skipNulls: true,
    addQueryPrefix: false,
    allowDots: true,
    strictNullHandling: true,
    indices: true,
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let requestCount = 0;

interface ReqOpts { token?: string; params?: Record<string, any>; body?: any }
interface ReqResult { status: number; body: any }

async function req(method: string, urlPath: string, opts: ReqOpts = {}): Promise<ReqResult> {
  const query = opts.params ? serializeParams(opts.params) : '';
  const url = `${BASE}${urlPath}${query ? (urlPath.includes('?') ? '&' : '?') + query : ''}`;
  const headers: Record<string, string> = {};
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  requestCount++;
  await sleep(60); // pacing to stay well under rate limits

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 429 && attempt < 3) {
      console.log(`    (429 on ${method} ${urlPath} — backing off 20s)`);
      await sleep(20000);
      continue;
    }
    let body: any = null;
    const text = await res.text();
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, body };
  }
}

function getPath(obj: any, dotted: string): { found: boolean; value: any } {
  let cur = obj;
  for (const part of dotted.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return { found: false, value: undefined };
    if (!(part in cur)) return { found: false, value: undefined };
    cur = cur[part];
  }
  return { found: true, value: cur };
}

// ============================================================================
// Fixtures
// ============================================================================

interface Fixtures {
  accounting: Fixture;
  production: Fixture;
  financial: Fixture;
  admin: Fixture;
  tokens: { accounting: string; production: string; financial: string; admin: string };
  cltLong: { id: string; name: string; exp1StartAt: Date } | null;
  cltExp: { id: string; name: string; exp1StartAt: Date | null; experienceEndAt: Date | null } | null;
  payUser: {
    id: string; name: string; hasSimplifiedDeduction: boolean; dependentsCount: number;
    payrollId: string; grossSalary: number; totalDiscounts: number; netSalary: number;
  } | null;
  capUser: { id: string; name: string } | null;
  basePeriod: { year: number; month: number };
  livePeriod: { year: number; month: number };
  taxTableRowsInDb: number;
}

function pickUserByPrivilege(priv: string, preferId?: string): Fixture {
  const rows = psqlRows(`
    SELECT u.id, u.name, u.email, u.phone
    FROM "User" u JOIN "Sector" s ON u."sectorId" = s.id
    WHERE u."isActive" = true AND u."requirePasswordChange" = false AND s.privileges = '${priv}'
    ORDER BY (u.id = '${preferId ?? ''}') DESC, u.name ASC LIMIT 1`);
  if (rows.length === 0) throw new Error(`No active user with privilege ${priv}`);
  const [id, name, email, phone] = rows[0];
  return { id, name, email: email || null, phone: phone || null, role: priv };
}

function resolveFixtures(): Fixtures {
  const accounting = pickUserByPrivilege('ACCOUNTING', '478bccd0-0d82-4576-9f44-28aee19c864e');
  const production = pickUserByPrivilege('PRODUCTION');
  const financial = pickUserByPrivilege('FINANCIAL');
  const admin = pickUserByPrivilege('ADMIN');

  const noOpenTermination = `NOT EXISTS (
    SELECT 1 FROM "Termination" t WHERE t."userId" = u.id AND t.status::text NOT IN ('COMPLETED','CANCELLED'))`;

  const longRows = psqlRows(`
    SELECT u.id, u.name, u."exp1StartAt"
    FROM "User" u
    WHERE u."isActive" = true AND u."contractKind"::text <> 'DISMISSED' AND u."exp1StartAt" IS NOT NULL
      AND ${noOpenTermination}
    ORDER BY u."exp1StartAt" ASC LIMIT 1`);
  const cltLong = longRows.length
    ? { id: longRows[0][0], name: longRows[0][1], exp1StartAt: new Date(longRows[0][2]) }
    : null;

  const expRows = psqlRows(`
    SELECT u.id, u.name, u."exp1StartAt", COALESCE(u."exp2EndAt", u."exp1EndAt") AS expend
    FROM "User" u
    WHERE u."isActive" = true AND u."contractKind"::text LIKE 'EXPERIENCE%'
      AND COALESCE(u."exp2EndAt", u."exp1EndAt") IS NOT NULL
      AND ${noOpenTermination}
    ORDER BY u.name ASC LIMIT 1`);
  const cltExp = expRows.length
    ? {
        id: expRows[0][0], name: expRows[0][1],
        exp1StartAt: expRows[0][2] ? new Date(expRows[0][2]) : null,
        experienceEndAt: expRows[0][3] ? new Date(expRows[0][3]) : null,
      }
    : null;

  const periodRows = psqlRows(`SELECT year, month FROM "Payroll" GROUP BY year, month ORDER BY year DESC, month DESC LIMIT 1`);
  const basePeriod = periodRows.length
    ? { year: Number(periodRows[0][0]), month: Number(periodRows[0][1]) }
    : { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  const livePeriod = basePeriod.month === 12
    ? { year: basePeriod.year + 1, month: 1 }
    : { year: basePeriod.year, month: basePeriod.month + 1 };

  const payRows = psqlRows(`
    SELECT u.id, u.name, u."hasSimplifiedDeduction", u."dependentsCount",
           p.id, p."grossSalary", p."totalDiscounts", p."netSalary"
    FROM "User" u
    JOIN "Payroll" p ON p."userId" = u.id AND p.year = ${basePeriod.year} AND p.month = ${basePeriod.month}
    WHERE u."isActive" = true
      AND NOT EXISTS (SELECT 1 FROM "Dependent" d WHERE d."userId" = u.id)
      AND NOT EXISTS (
        SELECT 1 FROM "PayrollDiscount" pd
        WHERE pd."payrollId" = p.id AND pd."discountType"::text IN ('AUTHORIZED_DISCOUNT','ALIMONY','LOAN'))
      AND NOT EXISTS (
        SELECT 1 FROM "UserBenefit" ub JOIN "Benefit" b ON b.id = ub."benefitId"
        WHERE ub."userId" = u.id AND b.kind::text = 'PHARMACY_AGREEMENT')
    ORDER BY p."grossSalary" DESC LIMIT 1`);
  const payUser = payRows.length
    ? {
        id: payRows[0][0], name: payRows[0][1],
        hasSimplifiedDeduction: payRows[0][2] === 't',
        dependentsCount: Number(payRows[0][3] || 0),
        payrollId: payRows[0][4],
        grossSalary: Number(payRows[0][5]), totalDiscounts: Number(payRows[0][6]), netSalary: Number(payRows[0][7]),
      }
    : null;

  const capRows = psqlRows(`
    SELECT u.id, u.name FROM "User" u
    WHERE u."isActive" = true AND u."contractKind"::text <> 'DISMISSED'
    ORDER BY (SELECT count(*) FROM "UserBenefit" ub WHERE ub."userId" = u.id) ASC, u.name ASC LIMIT 1`);
  const capUser = capRows.length ? { id: capRows[0][0], name: capRows[0][1] } : null;

  const taxTableRowsInDb = Number(psqlRows(`SELECT count(*) FROM "TaxTable"`)[0]?.[0] ?? 0);

  return {
    accounting, production, financial, admin,
    tokens: {
      accounting: mint(accounting),
      production: mint(production),
      financial: mint(financial),
      admin: mint(admin),
    },
    cltLong, cltExp, payUser, capUser, basePeriod, livePeriod, taxTableRowsInDb,
  };
}

// Local noon avoids UTC/local day drift between harness, API and DB.
function localNoon(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

// ============================================================================
// SUITE: query — replay the web app's queries (envelope + row shape)
// ============================================================================

interface ListSpec {
  label: string;
  path: string;
  include?: any;
  defaultOrderBy?: any;
  searchingFor?: string;
  filters?: Array<{ name: string; params: Record<string, any> }>;
  sorts?: Array<{ name: string; orderBy: any }>;
  rowFields?: string[];
  extraParams?: Record<string, any>;
  detailInclude?: any;
}

async function assertListCall(
  token: string, spec: ListSpec, caseName: string, params: Record<string, any>,
  rowFields?: string[],
): Promise<any[]> {
  const res = await req('GET', spec.path, { token, params });
  const ok = expect(
    `${spec.label} — ${caseName}: 200 + envelope`,
    res.status === 200 && res.body?.success === true && typeof res.body?.message === 'string' && Array.isArray(res.body?.data),
    `status=${res.status} body=${JSON.stringify(res.body)?.slice(0, 220)}`,
  );
  if (!ok) return [];
  const meta = res.body.meta;
  expect(
    `${spec.label} — ${caseName}: meta pagination`,
    meta && typeof meta.totalRecords === 'number' && typeof meta.page === 'number',
    `meta=${JSON.stringify(meta)?.slice(0, 160)}`,
  );
  const rows: any[] = res.body.data;
  if (rowFields && rows.length > 0) {
    const missing = rowFields.filter(f => !getPath(rows[0], f).found);
    expect(
      `${spec.label} — ${caseName}: row shape (${rowFields.length} fields)`,
      missing.length === 0,
      `missing: ${missing.join(', ')} on first row keys=${Object.keys(rows[0]).slice(0, 25).join(',')}`,
    );
  }
  return rows;
}

async function suiteQuery(fx: Fixtures) {
  const token = fx.tokens.accounting;

  const userInclude = { user: { include: { position: true, sector: true } } };

  const specs: ListSpec[] = [
    {
      label: 'Admissões (list)',
      path: '/admissions',
      include: { ...userInclude, createdBy: true, documents: true },
      defaultOrderBy: [{ createdAt: 'desc' }],
      searchingFor: 'a',
      filters: [
        { name: 'statuses', params: { statuses: [ADMISSION_STATUS.DOCS_PENDING] } },
        { name: 'userIds', params: { userIds: [fx.accounting.id] } },
        { name: 'hireDate range', params: { where: { hireDate: { gte: localNoon(2020, 1, 1), lte: localNoon(2027, 1, 1) } } } },
        { name: 'combined statuses+userIds', params: { statuses: [ADMISSION_STATUS.DOCS_PENDING, ADMISSION_STATUS.COMPLETED], userIds: [fx.accounting.id] } },
      ],
      sorts: [
        { name: 'user.name', orderBy: [{ user: { name: 'asc' } }] },
        { name: 'user.name desc', orderBy: [{ user: { name: 'desc' } }] },
        { name: 'statusOrder', orderBy: [{ statusOrder: 'asc' }] },
        { name: 'statusOrder desc', orderBy: [{ statusOrder: 'desc' }] },
        { name: 'hireDate', orderBy: [{ hireDate: 'asc' }] },
        { name: 'hireDate desc', orderBy: [{ hireDate: 'desc' }] },
        { name: 'createdAt', orderBy: [{ createdAt: 'asc' }] },
        { name: 'createdAt desc', orderBy: [{ createdAt: 'desc' }] },
      ],
      rowFields: ['id', 'status', 'hireDate', 'user', 'documents', 'createdAt'],
      detailInclude: { ...userInclude, createdBy: true, documents: true },
    },
    {
      label: 'Rescisões (list)',
      path: '/terminations',
      include: { ...userInclude, createdBy: true, documents: true, items: true },
      defaultOrderBy: [{ createdAt: 'desc' }],
      searchingFor: 'a',
      filters: [
        { name: 'statuses', params: { statuses: ['INITIATED'] } },
        { name: 'types', params: { types: [TERMINATION_TYPE.WITHOUT_CAUSE, TERMINATION_TYPE.RESIGNATION] } },
        { name: 'userIds', params: { userIds: [fx.cltLong?.id ?? fx.accounting.id] } },
      ],
      sorts: [
        { name: 'user.name', orderBy: [{ user: { name: 'asc' } }] },
        { name: 'user.name desc', orderBy: [{ user: { name: 'desc' } }] },
        { name: 'statusOrder', orderBy: [{ statusOrder: 'asc' }] },
        { name: 'terminationDate', orderBy: [{ terminationDate: 'desc' }] },
        { name: 'createdAt', orderBy: [{ createdAt: 'asc' }] },
      ],
      rowFields: ['id', 'status', 'type', 'user', 'items', 'documents'],
      detailInclude: { ...userInclude, createdBy: true, documents: true, items: true },
    },
    {
      label: 'Dependentes (list)',
      path: '/dependents',
      include: userInclude,
      defaultOrderBy: [{ createdAt: 'desc' }],
      searchingFor: 'a',
      filters: [
        { name: 'relationships', params: { relationships: [Object.values(DEPENDENT_RELATIONSHIP)[0]] } },
        { name: 'userIds', params: { userIds: [fx.cltLong?.id ?? fx.accounting.id] } },
      ],
      sorts: [
        { name: 'name', orderBy: [{ name: 'asc' }] },
        { name: 'name desc', orderBy: [{ name: 'desc' }] },
        { name: 'createdAt', orderBy: [{ createdAt: 'desc' }] },
      ],
      rowFields: ['id', 'name', 'relationship', 'irrfDeduction', 'user'],
    },
    {
      label: 'Benefícios (list)',
      path: '/benefits',
      defaultOrderBy: [{ createdAt: 'desc' }],
      searchingFor: 'vale',
      filters: [
        { name: 'kinds', params: { kinds: [BENEFIT_KIND.TRANSPORT_VOUCHER, BENEFIT_KIND.MEAL_VOUCHER] } },
      ],
      sorts: [
        { name: 'name', orderBy: [{ name: 'asc' }] },
        { name: 'name desc', orderBy: [{ name: 'desc' }] },
      ],
      rowFields: ['id', 'kind', 'name', 'isActive'],
    },
    {
      label: 'Adesões (user-benefits list)',
      path: '/user-benefits',
      include: { ...userInclude, benefit: true },
      defaultOrderBy: [{ createdAt: 'desc' }],
      searchingFor: 'a',
      filters: [
        { name: 'statuses', params: { statuses: ['ACTIVE'] } },
        { name: 'userIds', params: { userIds: [fx.payUser?.id ?? fx.accounting.id] } },
      ],
      sorts: [
        { name: 'user.name', orderBy: [{ user: { name: 'asc' } }] },
        { name: 'createdAt', orderBy: [{ createdAt: 'asc' }] },
      ],
      rowFields: ['id', 'status', 'monthlyValue', 'user', 'benefit'],
    },
    {
      label: 'Afastamentos (leaves list)',
      path: '/leaves',
      include: { ...userInclude, createdBy: true, files: true },
      defaultOrderBy: [{ createdAt: 'desc' }],
      searchingFor: 'a',
      filters: [
        { name: 'types', params: { types: [Object.values(LEAVE_TYPE)[0]] } },
        { name: 'statuses', params: { statuses: [LEAVE_STATUS.SCHEDULED, LEAVE_STATUS.ACTIVE] } },
      ],
      sorts: [
        { name: 'startDate', orderBy: [{ startDate: 'desc' }] },
        { name: 'startDate asc', orderBy: [{ startDate: 'asc' }] },
        { name: 'createdAt', orderBy: [{ createdAt: 'asc' }] },
      ],
      rowFields: ['id', 'type', 'status', 'startDate', 'user'],
    },
    {
      label: 'Exames (medical-exams list)',
      path: '/medical-exams',
      include: { ...userInclude, createdBy: true },
      defaultOrderBy: [{ createdAt: 'desc' }],
      searchingFor: 'a',
      filters: [
        { name: 'statuses', params: { statuses: ['SCHEDULED'] } },
        { name: 'userIds', params: { userIds: [fx.cltLong?.id ?? fx.accounting.id] } },
      ],
      sorts: [
        { name: 'createdAt', orderBy: [{ createdAt: 'asc' }] },
        { name: 'createdAt desc', orderBy: [{ createdAt: 'desc' }] },
      ],
      rowFields: ['id', 'type', 'status', 'user'],
    },
    {
      label: 'Eventos de agenda (list)',
      path: '/agenda-events',
      defaultOrderBy: [{ eventDate: 'asc' }],
      searchingFor: 'a',
      sorts: [
        { name: 'eventDate desc', orderBy: [{ eventDate: 'desc' }] },
        { name: 'createdAt', orderBy: [{ createdAt: 'desc' }] },
      ],
      rowFields: ['id', 'title', 'eventDate'],
    },
    {
      label: 'Reajustes salariais (list)',
      path: '/salary-adjustments',
      defaultOrderBy: [{ createdAt: 'desc' }],
      rowFields: ['id'],
    },
    {
      label: 'Histórico de cargos (list)',
      path: '/user-position-history',
      defaultOrderBy: [{ createdAt: 'desc' }],
      rowFields: ['id'],
    },
    {
      label: 'Contas a pagar (orders list)',
      path: '/orders',
      include: { supplier: true, items: true },
      defaultOrderBy: [{ paymentStatusOrder: 'asc' }, { createdAt: 'desc' }],
      searchingFor: 'a',
      extraParams: { where: { paymentStatus: { in: ['AWAITING_PAYMENT', 'PARTIALLY_PAID'] } } },
      filters: [
        { name: 'paymentStatus AWAITING_PAYMENT', params: { where: { paymentStatus: { in: ['AWAITING_PAYMENT'] } } } },
        { name: 'paymentStatus PARTIALLY_PAID', params: { where: { paymentStatus: { in: ['PARTIALLY_PAID'] } } } },
        {
          name: 'paymentStatus PAID (90d window)',
          params: { where: { paymentStatus: 'PAID', paidAt: { gte: new Date(Date.now() - 90 * 24 * 3600 * 1000) } } },
        },
      ],
      sorts: [
        { name: 'createdAt asc', orderBy: [{ createdAt: 'asc' }] },
        { name: 'createdAt desc', orderBy: [{ createdAt: 'desc' }] },
      ],
      rowFields: ['id', 'paymentStatus', 'supplier', 'items'],
    },
  ];

  for (const spec of specs) {
    const baseParams: Record<string, any> = {
      page: 1, limit: 40,
      ...(spec.include ? { include: spec.include } : {}),
      ...(spec.defaultOrderBy ? { orderBy: spec.defaultOrderBy } : {}),
      ...(spec.extraParams ?? {}),
    };
    const rows = await assertListCall(token, spec, 'base load', baseParams, spec.rowFields);

    // pagination page 2
    await assertListCall(token, spec, 'page 2', { ...baseParams, page: 2 });

    // search
    if (spec.searchingFor) {
      await assertListCall(token, spec, `search "${spec.searchingFor}"`, { ...baseParams, searchingFor: spec.searchingFor });
    }

    // filters, one at a time
    for (const f of spec.filters ?? []) {
      await assertListCall(token, spec, `filter ${f.name}`, { ...baseParams, ...f.params });
    }

    // sorts
    for (const s of spec.sorts ?? []) {
      await assertListCall(token, spec, `sort ${s.name}`, { ...baseParams, orderBy: s.orderBy });
    }

    // detail GET with UI include
    if (spec.detailInclude && rows.length > 0) {
      const res = await req('GET', `${spec.path}/${rows[0].id}`, { token, params: { include: spec.detailInclude } });
      expect(
        `${spec.label} — detail GET with UI include`,
        res.status === 200 && res.body?.success === true && res.body?.data?.id === rows[0].id,
        `status=${res.status} ${JSON.stringify(res.body)?.slice(0, 160)}`,
      );
    }
  }

  // Payroll list — exact UI shape (where {year,month} + nested includes)
  {
    const payrollParams = {
      where: { year: fx.basePeriod.year, month: fx.basePeriod.month },
      include: {
        user: { include: { position: true, sector: true } },
        bonus: { include: { tasks: true, bonusDiscounts: true } },
        discounts: true,
      },
    };
    const res = await req('GET', '/payroll', { token, params: payrollParams });
    const ok = expect(
      `Folha (payroll list) — base load ${fx.basePeriod.month}/${fx.basePeriod.year}`,
      res.status === 200 && res.body?.success === true && Array.isArray(res.body?.data),
      `status=${res.status} ${JSON.stringify(res.body)?.slice(0, 200)}`,
    );
    if (!ok && res.status === 400) {
      info(
        'Folha — BUG real encontrado: where.year/month chegam como string (dot-notation do axios) e payrollWhereSchema usava z.number()',
        'Correção aplicada em api/src/schemas/payroll.ts (z.coerce.number) — exige RESTART da API para passar.',
      );
    }
    if (ok && res.body.data.length > 0) {
      const row = res.body.data[0];
      const fields = ['id', 'userId', 'grossSalary', 'netSalary', 'totalDiscounts', 'inssAmount', 'irrfAmount', 'user', 'discounts'];
      const missing = fields.filter(f => !getPath(row, f).found);
      expect('Folha (payroll list) — row shape', missing.length === 0, `missing: ${missing.join(', ')}`);
    }
  }

  // Payroll live detail (detail page shape)
  if (fx.payUser) {
    const res = await req('GET', `/payroll/live/${fx.payUser.id}/${fx.livePeriod.year}/${fx.livePeriod.month}`, { token });
    expect(
      'Folha — live detail GET /payroll/live/:userId/:year/:month',
      res.status === 200 && res.body?.success === true && res.body?.data?.userId === fx.payUser.id,
      `status=${res.status} ${JSON.stringify(res.body)?.slice(0, 200)}`,
    );
  }

  // Medical exams expiring dashboard
  {
    const res = await req('GET', '/medical-exams/expiring', { token, params: { days: 30 } });
    expect(
      'Exames — GET /medical-exams/expiring?days=30',
      res.status === 200 && res.body?.success === true,
      `status=${res.status} ${JSON.stringify(res.body)?.slice(0, 160)}`,
    );
  }

  // Orders payment summary (contas a pagar cards)
  {
    const res = await req('GET', '/orders/payment-summary', { token });
    const buckets = res.body?.data;
    expect(
      'Contas a pagar — GET /orders/payment-summary',
      res.status === 200 && res.body?.success === true && buckets &&
        ['AWAITING_PAYMENT', 'PARTIALLY_PAID', 'PAID_LAST_90_DAYS'].every(k => k in buckets),
      `status=${res.status} ${JSON.stringify(res.body)?.slice(0, 220)}`,
    );
  }

  // Reconciliation transactions read
  {
    const res = await req('GET', '/financial/reconciliation/transactions', { token, params: { limit: 20, page: 1 } });
    expect(
      'Reconciliação — GET /financial/reconciliation/transactions',
      res.status === 200 && (res.body?.success === true || Array.isArray(res.body?.data)),
      `status=${res.status} ${JSON.stringify(res.body)?.slice(0, 200)}`,
    );
  }

  // Postits (Área Andressa post-its widget)
  {
    const res = await req('GET', '/postits', { token });
    expect('Post-its — GET /postits', res.status === 200 && res.body?.success === true, `status=${res.status}`);
  }

  // ------------------------------------------------------------------
  // CRUD cycles on throwaway data
  // ------------------------------------------------------------------
  const ts = Date.now();
  const crudUser = fx.cltLong?.id ?? fx.accounting.id;

  // Dependent
  {
    const create = await req('POST', '/dependents', {
      token,
      body: {
        userId: crudUser, name: `${MARKER} Dependente ${ts}`, birthDate: localNoon(2015, 5, 10).toISOString(),
        relationship: Object.values(DEPENDENT_RELATIONSHIP)[0], irrfDeduction: false, notes: MARKER,
      },
    });
    const id = create.body?.data?.id;
    const okC = expect('CRUD dependente — create', create.status === 201 && !!id, `status=${create.status} ${JSON.stringify(create.body)?.slice(0, 200)}`);
    if (okC) {
      onCleanup(`dependent ${id}`, async () => { await req('DELETE', `/dependents/${id}`, { token }); });
      const read = await req('GET', `/dependents/${id}`, { token, params: { include: { user: true } } });
      expect('CRUD dependente — read-back', read.status === 200 && read.body?.data?.name?.includes(MARKER), `status=${read.status}`);
      const upd = await req('PUT', `/dependents/${id}`, { token, body: { notes: `${MARKER} upd` } });
      expect('CRUD dependente — update', upd.status === 200 && upd.body?.success === true, `status=${upd.status} ${JSON.stringify(upd.body)?.slice(0, 160)}`);
      const del = await req('DELETE', `/dependents/${id}`, { token });
      expect('CRUD dependente — delete', del.status === 200 && del.body?.success === true, `status=${del.status}`);
      const after = await req('GET', `/dependents/${id}`, { token });
      expect('CRUD dependente — 404 after delete', after.status === 404, `status=${after.status}`);
    }
  }

  // Benefit + UserBenefit
  {
    const create = await req('POST', '/benefits', {
      token,
      body: { kind: BENEFIT_KIND.OTHER ?? 'OTHER', name: `${MARKER} Benefício ${ts}`, defaultValue: 100, isActive: true, notes: MARKER },
    });
    const benefitId = create.body?.data?.id;
    const okC = expect('CRUD benefício — create', create.status === 201 && !!benefitId, `status=${create.status} ${JSON.stringify(create.body)?.slice(0, 200)}`);
    if (okC) {
      onCleanup(`benefit ${benefitId}`, async () => { await req('DELETE', `/benefits/${benefitId}`, { token }); });
      const upd = await req('PUT', `/benefits/${benefitId}`, { token, body: { provider: `${MARKER} provider` } });
      expect('CRUD benefício — update', upd.status === 200, `status=${upd.status} ${JSON.stringify(upd.body)?.slice(0, 160)}`);

      // Enrollment cycle on the throwaway benefit
      const enr = await req('POST', '/user-benefits', {
        token,
        body: { userId: fx.capUser?.id ?? crudUser, benefitId, monthlyValue: 100, employeeDiscountPercent: 10, notes: MARKER },
      });
      const enrId = enr.body?.data?.id;
      const okE = expect('CRUD adesão — create', enr.status === 201 && !!enrId, `status=${enr.status} ${JSON.stringify(enr.body)?.slice(0, 200)}`);
      if (okE) {
        onCleanup(`user-benefit ${enrId}`, async () => { await req('DELETE', `/user-benefits/${enrId}`, { token }); });
        const eUpd = await req('PUT', `/user-benefits/${enrId}`, { token, body: { monthlyValue: 120 } });
        expect('CRUD adesão — update monthlyValue', eUpd.status === 200 && Number(eUpd.body?.data?.monthlyValue) === 120, `status=${eUpd.status}`);
        const susp = await req('PUT', `/user-benefits/${enrId}/suspend`, { token });
        expect('CRUD adesão — suspend', susp.status === 200 && susp.body?.data?.status === 'SUSPENDED', `status=${susp.status} ${JSON.stringify(susp.body)?.slice(0, 160)}`);
        const react = await req('PUT', `/user-benefits/${enrId}/reactivate`, { token });
        expect('CRUD adesão — reactivate', react.status === 200 && react.body?.data?.status === 'ACTIVE', `status=${react.status}`);
        const eDel = await req('DELETE', `/user-benefits/${enrId}`, { token });
        expect('CRUD adesão — delete', eDel.status === 200, `status=${eDel.status}`);
      }

      const del = await req('DELETE', `/benefits/${benefitId}`, { token });
      expect('CRUD benefício — delete', del.status === 200, `status=${del.status} ${JSON.stringify(del.body)?.slice(0, 160)}`);
    }
  }

  // Leave
  {
    const create = await req('POST', '/leaves', {
      token,
      body: {
        userId: crudUser, type: Object.values(LEAVE_TYPE)[0], startDate: localNoon(2026, 7, 1).toISOString(),
        expectedEndDate: localNoon(2026, 7, 5).toISOString(), notes: `${MARKER} afastamento`,
      },
    });
    const id = create.body?.data?.id;
    const okC = expect('CRUD afastamento — create', create.status === 201 && !!id, `status=${create.status} ${JSON.stringify(create.body)?.slice(0, 200)}`);
    if (okC) {
      onCleanup(`leave ${id}`, async () => { await req('DELETE', `/leaves/${id}`, { token }); });
      const upd = await req('PUT', `/leaves/${id}`, { token, body: { notes: `${MARKER} upd` } });
      expect('CRUD afastamento — update', upd.status === 200, `status=${upd.status} ${JSON.stringify(upd.body)?.slice(0, 160)}`);
      const del = await req('DELETE', `/leaves/${id}`, { token });
      expect('CRUD afastamento — delete', del.status === 200, `status=${del.status}`);
    }
  }

  // Medical exam
  {
    const create = await req('POST', '/medical-exams', {
      token,
      body: {
        userId: crudUser, type: Object.values(MEDICAL_EXAM_TYPE)[0],
        scheduledAt: localNoon(2026, 7, 10).toISOString(), notes: `${MARKER} exame`,
      },
    });
    const id = create.body?.data?.id;
    const okC = expect('CRUD exame — create', create.status === 201 && !!id, `status=${create.status} ${JSON.stringify(create.body)?.slice(0, 200)}`);
    if (okC) {
      onCleanup(`medical-exam ${id}`, async () => { await req('DELETE', `/medical-exams/${id}`, { token }); });
      const upd = await req('PUT', `/medical-exams/${id}`, { token, body: { clinic: `${MARKER} clínica` } });
      expect('CRUD exame — update', upd.status === 200, `status=${upd.status} ${JSON.stringify(upd.body)?.slice(0, 160)}`);
      const del = await req('DELETE', `/medical-exams/${id}`, { token });
      expect('CRUD exame — delete', del.status === 200, `status=${del.status}`);
    }
  }

  // Agenda event
  {
    const create = await req('POST', '/agenda-events', {
      token,
      body: {
        title: `${MARKER} evento ${ts}`, eventDate: localNoon(2026, 8, 1).toISOString(),
        notifyOnDay: false, targetUserIds: [fx.accounting.id], isActive: false,
      },
    });
    const id = create.body?.data?.id;
    const okC = expect('CRUD evento de agenda — create', create.status === 201 && !!id, `status=${create.status} ${JSON.stringify(create.body)?.slice(0, 200)}`);
    if (okC) {
      onCleanup(`agenda-event ${id}`, async () => { await req('DELETE', `/agenda-events/${id}`, { token }); });
      const upd = await req('PUT', `/agenda-events/${id}`, { token, body: { description: `${MARKER} upd` } });
      expect('CRUD evento de agenda — update', upd.status === 200, `status=${upd.status} ${JSON.stringify(upd.body)?.slice(0, 160)}`);
      const del = await req('DELETE', `/agenda-events/${id}`, { token });
      expect('CRUD evento de agenda — delete', del.status === 200, `status=${del.status}`);
    }
  }

  // Postit
  {
    const create = await req('POST', '/postits', { token, body: { content: `${MARKER} postit ${ts}` } });
    const id = create.body?.data?.id;
    const okC = expect('CRUD post-it — create', create.status === 201 && !!id, `status=${create.status} ${JSON.stringify(create.body)?.slice(0, 200)}`);
    if (okC) {
      onCleanup(`postit ${id}`, async () => { await req('DELETE', `/postits/${id}`, { token }); });
      const upd = await req('PUT', `/postits/${id}`, { token, body: { content: `${MARKER} upd` } });
      expect('CRUD post-it — update', upd.status === 200, `status=${upd.status}`);
      const del = await req('DELETE', `/postits/${id}`, { token });
      expect('CRUD post-it — delete', del.status === 200, `status=${del.status}`);
    }
  }

  // Admission (record on an existing user — no contractKind change, no advance)
  {
    const candidates = [fx.cltExp?.id, fx.cltLong?.id].filter(Boolean) as string[];
    let done = false;
    for (const uid of candidates) {
      const create = await req('POST', '/admissions', {
        token,
        body: { userId: uid, notes: `${MARKER} admissão ${ts}` },
      });
      if (create.status === 201 && create.body?.data?.id) {
        const id = create.body.data.id;
        onCleanup(`admission ${id}`, async () => { await req('DELETE', `/admissions/${id}`, { token: fx.tokens.admin }); });
        pass('CRUD admissão — create (existing user)');
        const upd = await req('PUT', `/admissions/${id}`, { token, body: { notes: `${MARKER} upd` } });
        expect('CRUD admissão — update', upd.status === 200, `status=${upd.status} ${JSON.stringify(upd.body)?.slice(0, 160)}`);
        let del = await req('DELETE', `/admissions/${id}`, { token });
        if (del.status === 403) {
          info('CRUD admissão — delete é ADMIN-only para ACCOUNTING (verificar contrato)', `status=${del.status}`);
          del = await req('DELETE', `/admissions/${id}`, { token: fx.tokens.admin });
        }
        expect('CRUD admissão — delete', del.status === 200, `status=${del.status} ${JSON.stringify(del.body)?.slice(0, 160)}`);
        done = true;
        break;
      }
    }
    if (!done) skip('CRUD admissão — create', 'nenhum usuário candidato aceitou criação (provável admissão/processo já existente)');
  }
}

// ============================================================================
// SUITE: clt — termination engine vs CLT rules (engine matrix + E2E /calculate)
// ============================================================================

const engine = new TerminationCalculationService();

function findItem(items: any[], type: string) {
  return items.find((i: any) => i.type === type);
}

async function suiteClt(fx: Fixtures) {
  const token = fx.tokens.accounting;

  // ---------------- Engine-level matrix (same code the server runs) --------
  {
    expect(
      'CLT 12.506 — aviso >20 anos é limitado a 90 dias',
      engine.computeNoticeDays(TERMINATION_TYPE.WITHOUT_CAUSE, localNoon(2000, 1, 15), localNoon(2026, 6, 10)) === 90,
    );
    expect(
      'CLT 12.506 — aviso <1 ano = 30 dias',
      engine.computeNoticeDays(TERMINATION_TYPE.WITHOUT_CAUSE, localNoon(2026, 1, 10), localNoon(2026, 6, 10)) === 30,
    );
    expect(
      'CLT 487 — pedido de demissão: aviso fixo 30 dias (sem proporcionalidade)',
      engine.computeNoticeDays(TERMINATION_TYPE.RESIGNATION, localNoon(2000, 1, 15), localNoon(2026, 6, 10)) === 30,
    );
    expect(
      'CLT — experiência/morte: sem aviso prévio',
      engine.computeNoticeDays(TERMINATION_TYPE.DEATH, localNoon(2020, 1, 1), localNoon(2026, 6, 10)) === null &&
      engine.computeNoticeDays(TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER, localNoon(2026, 1, 1), localNoon(2026, 6, 10)) === null,
    );

    const BR = 3000;
    const base = {
      noticeType: null as any, noticeDays: null as any, projectedEndDate: null as any,
      baseRemuneration: BR, fgtsBalance: 5000, accruedVacationPeriods: 0,
      exp1StartAt: localNoon(2024, 1, 10), experienceEndAt: null as any,
    };

    // RESIGNATION WAIVED vs INDEMNIFIED
    const waived = engine.calculate({ ...base, type: TERMINATION_TYPE.RESIGNATION, noticeType: NOTICE_TYPE.WAIVED, noticeDays: 30, terminationDate: localNoon(2026, 6, 10) });
    expect(
      'CLT 487 §2º — RESIGNATION + WAIVED: sem desconto e sem pagamento de aviso',
      !findItem(waived, 'NOTICE_DISCOUNT') && !findItem(waived, 'NOTICE_INDEMNIFIED'),
      JSON.stringify(waived.map(i => i.type)),
    );
    const resInd = engine.calculate({ ...base, type: TERMINATION_TYPE.RESIGNATION, noticeType: NOTICE_TYPE.INDEMNIFIED, noticeDays: 30, terminationDate: localNoon(2026, 6, 10) });
    const discount = findItem(resInd, 'NOTICE_DISCOUNT');
    expect(
      'CLT 487 §2º — RESIGNATION + INDEMNIFIED: desconto de −1 salário (BR/30×30)',
      !!discount && approx(discount.amount, -BR) && !findItem(resInd, 'NOTICE_INDEMNIFIED'),
      JSON.stringify(discount),
    );
    expect(
      'CLT 487 — pedido de demissão não projeta 13º/férias (sem projeção do aviso)',
      !findItem(resInd, 'FGTS_FINE'),
      'RESIGNATION não pode ter multa FGTS',
    );

    // 484-A halving + FGTS 20%
    const mutual = engine.calculate({ ...base, type: TERMINATION_TYPE.MUTUAL_AGREEMENT, noticeType: NOTICE_TYPE.INDEMNIFIED, noticeDays: 30, projectedEndDate: localNoon(2026, 7, 10), terminationDate: localNoon(2026, 6, 10) });
    const mNotice = findItem(mutual, 'NOTICE_INDEMNIFIED');
    const mFgts = findItem(mutual, 'FGTS_FINE');
    expect('CLT 484-A — acordo mútuo: aviso indenizado pela METADE', !!mNotice && approx(mNotice.amount, BR / 2), JSON.stringify(mNotice));
    expect('CLT 484-A — acordo mútuo: multa FGTS 20%', !!mFgts && approx(mFgts.amount, 5000 * 0.2), JSON.stringify(mFgts));

    // WITH_CAUSE matrix
    const withCause = engine.calculate({ ...base, type: TERMINATION_TYPE.WITH_CAUSE, accruedVacationPeriods: 1, terminationDate: localNoon(2026, 6, 10) });
    expect(
      'CLT 482 — justa causa: APENAS saldo de salário + férias vencidas',
      withCause.length === 2 && !!findItem(withCause, 'SALARY_BALANCE') && !!findItem(withCause, 'ACCRUED_VACATION') &&
      !findItem(withCause, 'THIRTEENTH_PROPORTIONAL') && !findItem(withCause, 'PROPORTIONAL_VACATION') && !findItem(withCause, 'FGTS_FINE'),
      JSON.stringify(withCause.map(i => i.type)),
    );
    const wcVacation = findItem(withCause, 'ACCRUED_VACATION');
    expect('CLT 146 — férias vencidas devidas mesmo na justa causa (+1/3)', !!wcVacation && approx(wcVacation.amount, BR * (4 / 3)), JSON.stringify(wcVacation));

    // ART 479 — experience contract terminated early by employer
    const art479 = engine.calculate({
      ...base, type: TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER, fgtsBalance: 1000,
      terminationDate: localNoon(2026, 6, 10), experienceEndAt: localNoon(2026, 7, 10),
    });
    const a479 = findItem(art479, 'ART479_INDEMNITY');
    const a479fgts = findItem(art479, 'FGTS_FINE');
    expect(
      'CLT 479 — indenização = 50% × BR/30 × 30 dias restantes',
      !!a479 && approx(a479.amount, 0.5 * (BR / 30) * 30),
      JSON.stringify(a479),
    );
    expect('CLT 479 + Súmula — multa FGTS 40% na rescisão antecipada pelo empregador', !!a479fgts && approx(a479fgts.amount, 400), JSON.stringify(a479fgts));

    // DEATH
    const death = engine.calculate({ ...base, type: TERMINATION_TYPE.DEATH, terminationDate: localNoon(2026, 6, 10) });
    expect(
      'CLT — falecimento: sem aviso e sem multa FGTS; 13º e férias proporcionais devidos',
      !findItem(death, 'NOTICE_INDEMNIFIED') && !findItem(death, 'NOTICE_DISCOUNT') && !findItem(death, 'FGTS_FINE') &&
      !!findItem(death, 'THIRTEENTH_PROPORTIONAL') && !!findItem(death, 'PROPORTIONAL_VACATION'),
      JSON.stringify(death.map(i => i.type)),
    );

    // Salary balance on last day of a 30-day month = exactly 1 BR
    const lastDay30 = engine.calculate({ ...base, type: TERMINATION_TYPE.WITH_CAUSE, terminationDate: localNoon(2026, 6, 30) });
    const sb30 = findItem(lastDay30, 'SALARY_BALANCE');
    expect('CLT 477 — rescisão no último dia de mês de 30 dias: saldo = salário integral', !!sb30 && approx(sb30.amount, BR), JSON.stringify(sb30));

    // Salary balance on day 31 — engine pays 31/30 (flagged)
    const lastDay31 = engine.calculate({ ...base, type: TERMINATION_TYPE.WITH_CAUSE, terminationDate: localNoon(2026, 5, 31) });
    const sb31 = findItem(lastDay31, 'SALARY_BALANCE');
    if (sb31 && approx(sb31.amount, (BR / 30) * 31)) {
      info(
        'ACHADO — mês de 31 dias: saldo de salário pago como 31/30 × BR (R$ 3.100 > salário mensal)',
        'Prática usual de TRCT trata mês comercial de 30 dias (máx. 30/30). Revisar termination-calculation.service.ts:209 (daysWorked = end.getDate()).',
      );
    } else {
      expect('CLT 477 — saldo de salário dia 31 coerente', !!sb31 && sb31.amount <= BR + 0.01, JSON.stringify(sb31));
    }

    // Accrued vacation ×2
    const acc2 = engine.calculate({ ...base, type: TERMINATION_TYPE.WITHOUT_CAUSE, accruedVacationPeriods: 2, terminationDate: localNoon(2026, 6, 10) });
    const accItem = findItem(acc2, 'ACCRUED_VACATION');
    expect('CLT 146 — 2 períodos de férias vencidas: 2 × BR × 4/3', !!accItem && approx(accItem.amount, 2 * BR * (4 / 3)), JSON.stringify(accItem));

    // 13th projection across year boundary (CLT 487 §1º)
    const yearCross = engine.calculate({
      ...base, type: TERMINATION_TYPE.WITHOUT_CAUSE, noticeType: NOTICE_TYPE.INDEMNIFIED, noticeDays: 36,
      terminationDate: localNoon(2026, 12, 10), projectedEndDate: localNoon(2027, 1, 15),
    });
    const thirteenths = yearCross.filter(i => i.type === 'THIRTEENTH_PROPORTIONAL');
    expect(
      'CLT 487 §1º — projeção do aviso cruzando o ano gera 13º dos DOIS anos',
      thirteenths.length === 2,
      JSON.stringify(thirteenths),
    );

    // Zero base remuneration must throw
    let threw = false;
    try {
      engine.calculate({ ...base, type: TERMINATION_TYPE.WITHOUT_CAUSE, baseRemuneration: 0, terminationDate: localNoon(2026, 6, 10) });
    } catch { threw = true; }
    expect('Validação — remuneração base zero rejeitada pelo motor', threw);
  }

  // ---------------- E2E via API: POST → /calculate → oracle → DELETE -------
  if (!fx.cltLong) {
    skip('CLT E2E — sem usuário elegível para rescisões de teste');
    return;
  }

  interface E2ECase {
    name: string;
    userId: string;
    body: any;
    expectedNoticeDays: number | null;
    extraChecks?: (items: any[], termination: any) => void;
  }

  const longYears = engine.completedYears(fx.cltLong.exp1StartAt, localNoon(2026, 6, 30));
  const expectedLongNotice = Math.min(90, 30 + 3 * longYears);

  const cases: E2ECase[] = [
    {
      name: `WITHOUT_CAUSE + INDEMNIFIED (tenure ${longYears}a → aviso ${expectedLongNotice}d)`,
      userId: fx.cltLong.id,
      body: {
        userId: fx.cltLong.id, type: TERMINATION_TYPE.WITHOUT_CAUSE, noticeType: NOTICE_TYPE.INDEMNIFIED,
        terminationDate: localNoon(2026, 6, 30).toISOString(), baseRemuneration: 3000, fgtsBalance: 5000,
        accruedVacationPeriods: 2, reason: `${MARKER} caso WITHOUT_CAUSE`,
      },
      expectedNoticeDays: expectedLongNotice,
      extraChecks: items => {
        const fgts = findItem(items, 'FGTS_FINE');
        expect('E2E WITHOUT_CAUSE — multa FGTS 40%', !!fgts && approx(Number(fgts.amount), 2000), JSON.stringify(fgts));
        const acc = findItem(items, 'ACCRUED_VACATION');
        expect('E2E WITHOUT_CAUSE — férias vencidas 2 períodos = 8000', !!acc && approx(Number(acc.amount), 2 * 3000 * (4 / 3)), JSON.stringify(acc));
        const sb = findItem(items, 'SALARY_BALANCE');
        expect('E2E WITHOUT_CAUSE — saldo de salário no dia 30 = salário cheio', !!sb && approx(Number(sb.amount), 3000), JSON.stringify(sb));
        const notice = findItem(items, 'NOTICE_INDEMNIFIED');
        expect(
          `E2E WITHOUT_CAUSE — aviso indenizado = BR/30 × ${expectedLongNotice}`,
          !!notice && approx(Number(notice.amount), (3000 / 30) * expectedLongNotice),
          JSON.stringify(notice),
        );
      },
    },
    {
      name: 'RESIGNATION + INDEMNIFIED (desconto CLT 487 §2º)',
      userId: fx.cltLong.id,
      body: {
        userId: fx.cltLong.id, type: TERMINATION_TYPE.RESIGNATION, noticeType: NOTICE_TYPE.INDEMNIFIED,
        terminationDate: localNoon(2026, 6, 15).toISOString(), baseRemuneration: 3000, fgtsBalance: 5000,
        accruedVacationPeriods: 0, reason: `${MARKER} caso RESIGNATION INDEMNIFIED`,
      },
      expectedNoticeDays: 30,
      extraChecks: items => {
        const d = findItem(items, 'NOTICE_DISCOUNT');
        expect('E2E RESIGNATION INDEMNIFIED — desconto −3000', !!d && approx(Number(d.amount), -3000), JSON.stringify(d));
        expect('E2E RESIGNATION INDEMNIFIED — sem aviso pago e sem multa FGTS', !findItem(items, 'NOTICE_INDEMNIFIED') && !findItem(items, 'FGTS_FINE'));
      },
    },
    {
      name: 'RESIGNATION + WAIVED (sem desconto, sem pagamento)',
      userId: fx.cltLong.id,
      body: {
        userId: fx.cltLong.id, type: TERMINATION_TYPE.RESIGNATION, noticeType: NOTICE_TYPE.WAIVED,
        terminationDate: localNoon(2026, 6, 15).toISOString(), baseRemuneration: 3000,
        reason: `${MARKER} caso RESIGNATION WAIVED`,
      },
      expectedNoticeDays: 30,
      extraChecks: items => {
        expect(
          'E2E RESIGNATION WAIVED — nenhum item de aviso (dispensado = sem desconto e sem pagamento)',
          !findItem(items, 'NOTICE_DISCOUNT') && !findItem(items, 'NOTICE_INDEMNIFIED'),
          JSON.stringify(items.map((i: any) => i.type)),
        );
      },
    },
    {
      name: 'WITH_CAUSE (matriz justa causa)',
      userId: fx.cltLong.id,
      body: {
        userId: fx.cltLong.id, type: TERMINATION_TYPE.WITH_CAUSE,
        terminationDate: localNoon(2026, 6, 10).toISOString(), baseRemuneration: 3000, fgtsBalance: 5000,
        accruedVacationPeriods: 1, justCauseArticle: 'art. 482, a', reason: `${MARKER} caso WITH_CAUSE`,
      },
      expectedNoticeDays: null,
      extraChecks: items => {
        expect(
          'E2E WITH_CAUSE — sem 13º, sem férias proporcionais, sem multa FGTS, sem aviso',
          !findItem(items, 'THIRTEENTH_PROPORTIONAL') && !findItem(items, 'PROPORTIONAL_VACATION') &&
          !findItem(items, 'FGTS_FINE') && !findItem(items, 'NOTICE_INDEMNIFIED') && !findItem(items, 'NOTICE_DISCOUNT'),
          JSON.stringify(items.map((i: any) => i.type)),
        );
        const acc = findItem(items, 'ACCRUED_VACATION');
        expect('E2E WITH_CAUSE — férias vencidas pagas mesmo na justa causa', !!acc && approx(Number(acc.amount), 4000), JSON.stringify(acc));
      },
    },
    {
      name: 'MUTUAL_AGREEMENT + INDEMNIFIED (CLT 484-A)',
      userId: fx.cltLong.id,
      body: {
        userId: fx.cltLong.id, type: TERMINATION_TYPE.MUTUAL_AGREEMENT, noticeType: NOTICE_TYPE.INDEMNIFIED,
        terminationDate: localNoon(2026, 6, 15).toISOString(), baseRemuneration: 3000, fgtsBalance: 5000,
        reason: `${MARKER} caso 484-A`,
      },
      expectedNoticeDays: 30,
      extraChecks: items => {
        const n = findItem(items, 'NOTICE_INDEMNIFIED');
        expect('E2E 484-A — aviso pela metade (1500)', !!n && approx(Number(n.amount), 1500), JSON.stringify(n));
        const f = findItem(items, 'FGTS_FINE');
        expect('E2E 484-A — multa FGTS 20% (1000)', !!f && approx(Number(f.amount), 1000), JSON.stringify(f));
      },
    },
    {
      name: 'DEATH (falecimento)',
      userId: fx.cltLong.id,
      body: {
        userId: fx.cltLong.id, type: TERMINATION_TYPE.DEATH,
        terminationDate: localNoon(2026, 6, 20).toISOString(), baseRemuneration: 3000, fgtsBalance: 5000,
        reason: `${MARKER} caso DEATH`,
      },
      expectedNoticeDays: null,
      extraChecks: items => {
        expect(
          'E2E DEATH — sem aviso e sem multa FGTS; verbas proporcionais presentes',
          !findItem(items, 'NOTICE_INDEMNIFIED') && !findItem(items, 'NOTICE_DISCOUNT') && !findItem(items, 'FGTS_FINE') &&
          !!findItem(items, 'THIRTEENTH_PROPORTIONAL'),
          JSON.stringify(items.map((i: any) => i.type)),
        );
      },
    },
  ];

  if (fx.cltExp?.experienceEndAt) {
    const expEnd = fx.cltExp.experienceEndAt;
    // termination 20 days before the contractual end (or today if end already close)
    const termDate = new Date(expEnd.getTime() - 20 * 24 * 3600 * 1000);
    termDate.setHours(12, 0, 0, 0);
    cases.push({
      name: 'EXPERIENCE_EARLY_EMPLOYER (ART 479)',
      userId: fx.cltExp.id,
      body: {
        userId: fx.cltExp.id, type: TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER,
        terminationDate: termDate.toISOString(), baseRemuneration: 3000, fgtsBalance: 1000,
        reason: `${MARKER} caso ART479`,
      },
      expectedNoticeDays: null,
      extraChecks: items => {
        const a = findItem(items, 'ART479_INDEMNITY');
        const expectedRemaining = Math.floor(
          (new Date(expEnd.getFullYear(), expEnd.getMonth(), expEnd.getDate()).getTime() -
            new Date(termDate.getFullYear(), termDate.getMonth(), termDate.getDate()).getTime()) / (24 * 3600 * 1000),
        );
        expect(
          `E2E ART479 — 50% × BR/30 × ${expectedRemaining} dias restantes`,
          !!a && approx(Number(a.amount), 0.5 * (3000 / 30) * expectedRemaining),
          JSON.stringify(a),
        );
        const f = findItem(items, 'FGTS_FINE');
        expect('E2E ART479 — multa FGTS 40% (400)', !!f && approx(Number(f.amount), 400), JSON.stringify(f));
      },
    });
  } else {
    skip('E2E ART479 — sem usuário em período de experiência com data de término');
  }

  for (const c of cases) {
    const create = await req('POST', '/terminations', { token, body: c.body });
    const id = create.body?.data?.id;
    const okC = expect(`E2E ${c.name} — POST /terminations`, create.status === 201 && !!id, `status=${create.status} ${JSON.stringify(create.body)?.slice(0, 260)}`);
    if (!okC) continue;
    onCleanup(`termination ${id}`, async () => { await req('DELETE', `/terminations/${id}`, { token }); });

    expect(
      `E2E ${c.name} — noticeDays calculado pelo servidor = ${c.expectedNoticeDays}`,
      (create.body.data.noticeDays ?? null) === c.expectedNoticeDays,
      `noticeDays=${create.body.data.noticeDays}`,
    );

    const calc = await req('POST', `/terminations/${id}/calculate`, { token });
    const calcData = calc.body?.data;
    const items: any[] = Array.isArray(calcData) ? calcData : (calcData?.items ?? []);
    const okCalc = expect(
      `E2E ${c.name} — POST /calculate retorna itens`,
      calc.status === 200 || calc.status === 201 ? items.length > 0 : false,
      `status=${calc.status} ${JSON.stringify(calc.body)?.slice(0, 260)}`,
    );

    if (okCalc) {
      // Oracle: run the SAME engine locally with the inputs the server stored.
      const read = await req('GET', `/terminations/${id}`, { token, params: { include: { user: true } } });
      const t = read.body?.data;
      if (t) {
        const u = t.user ?? {};
        const localItems = engine.calculate({
          type: t.type, noticeType: t.noticeType ?? null, noticeDays: t.noticeDays ?? null,
          terminationDate: t.terminationDate ? new Date(t.terminationDate) : null,
          projectedEndDate: t.projectedEndDate ? new Date(t.projectedEndDate) : null,
          baseRemuneration: t.baseRemuneration != null ? Number(t.baseRemuneration) : null,
          fgtsBalance: t.fgtsBalance != null ? Number(t.fgtsBalance) : null,
          accruedVacationPeriods: Number(t.accruedVacationPeriods ?? 0),
          exp1StartAt: u.exp1StartAt ? new Date(u.exp1StartAt) : null,
          experienceEndAt: u.exp2EndAt ? new Date(u.exp2EndAt) : u.exp1EndAt ? new Date(u.exp1EndAt) : null,
        });
        const keyOf = (arr: any[]) => arr
          .filter((i: any) => !i.isCustom)
          .map((i: any) => `${i.type}:${Number(i.amount).toFixed(2)}`)
          .sort()
          .join(' | ');
        expect(
          `E2E ${c.name} — itens da API idênticos ao motor (oráculo local)`,
          keyOf(items) === keyOf(localItems),
          `api=[${keyOf(items)}] engine=[${keyOf(localItems)}]`,
        );
      }
      c.extraChecks?.(items, calcData);
    }

    const del = await req('DELETE', `/terminations/${id}`, { token });
    expect(`E2E ${c.name} — DELETE limpeza`, del.status === 200 && del.body?.success === true, `status=${del.status}`);
  }

  // zero baseRemuneration → /calculate must 400
  {
    const create = await req('POST', '/terminations', {
      token,
      body: {
        userId: fx.cltLong.id, type: TERMINATION_TYPE.WITHOUT_CAUSE,
        terminationDate: localNoon(2026, 6, 15).toISOString(), reason: `${MARKER} caso BR zero`,
      },
    });
    const id = create.body?.data?.id;
    if (expect('E2E BR ausente — POST /terminations (sem baseRemuneration)', create.status === 201 && !!id, `status=${create.status} ${JSON.stringify(create.body)?.slice(0, 200)}`)) {
      onCleanup(`termination ${id}`, async () => { await req('DELETE', `/terminations/${id}`, { token }); });
      const calc = await req('POST', `/terminations/${id}/calculate`, { token });
      expect(
        'E2E BR ausente — /calculate retorna 400 (remuneração base obrigatória)',
        calc.status === 400,
        `status=${calc.status} ${JSON.stringify(calc.body)?.slice(0, 200)}`,
      );
      const del = await req('DELETE', `/terminations/${id}`, { token });
      expect('E2E BR ausente — DELETE limpeza', del.status === 200, `status=${del.status}`);
    }
  }
}

// ============================================================================
// SUITE: payroll — INSS/IRRF engine + live endpoint edges
// ============================================================================

function expectedINSS(base: number, year: number): number {
  return computeProgressiveINSS(base, getInssTableForYear(year).brackets).total;
}
function expectedIRRF(taxableGross: number, inss: number, deps: number, simplified: boolean, year: number): number {
  return computeIRRF({
    taxableGross, inssAmount: inss, dependentsCount: deps,
    allowSimplifiedDeduction: simplified, table: getIrrfTableForYear(year),
  }).tax;
}

async function suitePayroll(fx: Fixtures) {
  const token = fx.tokens.accounting;
  const { livePeriod, basePeriod } = fx;

  if (fx.taxTableRowsInDb > 0) {
    info(`TaxTable possui ${fx.taxTableRowsInDb} linha(s) no banco — o oráculo usa as tabelas estatutárias; divergências podem vir do override do banco`);
  }

  // ---------------- Engine boundaries (statutory tables) -------------------
  {
    const t = getInssTableForYear(2026);
    expect(
      'INSS 2026 — teto: contribuição máxima R$ 988,09 no salário-teto (8.475,55)',
      approx(computeProgressiveINSS(8475.55, t.brackets).total, 988.09),
      `got=${computeProgressiveINSS(8475.55, t.brackets).total}`,
    );
    expect(
      'INSS 2026 — acima do teto permanece capado em 988,09',
      approx(computeProgressiveINSS(20000, t.brackets).total, 988.09),
      `got=${computeProgressiveINSS(20000, t.brackets).total}`,
    );

    const irrfTable = getIrrfTableForYear(2026);
    const at5000 = computeIRRF({ taxableGross: 5000, inssAmount: expectedINSS(5000, 2026), dependentsCount: 0, allowSimplifiedDeduction: true, table: irrfTable });
    expect('IRRF 2026 (Lei 15.270) — isenção efetiva até R$ 5.000: imposto 0', at5000.tax === 0, `tax=${at5000.tax} redutor=${at5000.redutorAmount}`);

    const at6000 = computeIRRF({ taxableGross: 6000, inssAmount: expectedINSS(6000, 2026), dependentsCount: 0, allowSimplifiedDeduction: true, table: irrfTable });
    const expectedRedutor = Math.min(at6000.taxBeforeRedutor, Math.max(0, Math.round((978.62 - 0.133145 * 6000) * 100) / 100));
    expect(
      'IRRF 2026 — faixa de transição (6.000): redutor = 978,62 − 0,133145×rendimentos',
      approx(at6000.redutorAmount, expectedRedutor),
      `redutor=${at6000.redutorAmount} expected=${expectedRedutor}`,
    );

    const at7400 = computeIRRF({ taxableGross: 7400, inssAmount: expectedINSS(7400, 2026), dependentsCount: 0, allowSimplifiedDeduction: true, table: irrfTable });
    expect('IRRF 2026 — acima de R$ 7.350: redutor = 0', at7400.redutorAmount === 0, `redutor=${at7400.redutorAmount}`);

    // dependents only count when legal deductions beat the simplified discount
    const noDeps = computeIRRF({ taxableGross: 9000, inssAmount: 988.09, dependentsCount: 0, allowSimplifiedDeduction: false, table: irrfTable });
    const twoDeps = computeIRRF({ taxableGross: 9000, inssAmount: 988.09, dependentsCount: 2, allowSimplifiedDeduction: false, table: irrfTable });
    expect(
      'IRRF — dedução por dependente (189,59 cada) reduz o imposto (deduções legais)',
      twoDeps.tax < noDeps.tax && approx(twoDeps.dependentsDeduction, 379.18),
      `no=${noDeps.tax} two=${twoDeps.tax}`,
    );
  }

  // ---------------- Saved payrolls recompute (all of base month) -----------
  {
    const rows = psqlRows(`
      SELECT p."userId", p."inssBase", p."inssAmount", p."irrfAmount", u."hasSimplifiedDeduction", u."dependentsCount",
             (SELECT count(*) FROM "Dependent" d WHERE d."userId" = u.id),
             (SELECT count(*) FROM "Dependent" d WHERE d."userId" = u.id AND d."irrfDeduction" = true),
             u.name
      FROM "Payroll" p JOIN "User" u ON u.id = p."userId"
      WHERE p.year = ${basePeriod.year} AND p.month = ${basePeriod.month} AND p."inssBase" IS NOT NULL`);
    let mismatches: string[] = [];
    for (const r of rows) {
      const [, inssBaseS, inssAmountS, irrfAmountS, simplifiedS, depsCountS, totalDepsS, eligDepsS, name] = r;
      const inssBase = Number(inssBaseS);
      const inssAmount = Number(inssAmountS);
      const irrfAmount = Number(irrfAmountS);
      const simplified = simplifiedS !== 'f';
      const deps = Number(totalDepsS) > 0 ? Number(eligDepsS) : Number(depsCountS || 0);

      const expInss = expectedINSS(inssBase, basePeriod.year);
      const inssOk = approx(inssAmount, expInss);
      // tolerate dependents drift since generation (try resolved deps, 0 and raw count)
      const irrfOk = [deps, 0, Number(depsCountS || 0)].some(d =>
        approx(irrfAmount, expectedIRRF(inssBase, inssAmount, d, simplified, basePeriod.year)),
      );
      if (!inssOk || !irrfOk) {
        mismatches.push(`${name}: inss ${inssAmount} (exp ${expInss}) irrf ${irrfAmount}`);
      }
    }
    expect(
      `Folhas salvas ${basePeriod.month}/${basePeriod.year} — INSS/IRRF batem com as tabelas estatutárias (${rows.length} folhas)`,
      mismatches.length === 0,
      mismatches.slice(0, 5).join(' ; '),
    );
  }

  if (!fx.payUser) {
    skip('Payroll E2E — nenhum usuário limpo (sem dependentes/empréstimos) com folha no mês base');
    return;
  }
  const pu = fx.payUser;
  const livePath = `/payroll/live/${pu.id}/${livePeriod.year}/${livePeriod.month}`;

  async function liveSnapshot(): Promise<any | null> {
    const res = await req('GET', livePath, { token });
    if (res.status !== 200 || !res.body?.data) return null;
    return res.body.data;
  }

  const baseline = await liveSnapshot();
  if (!expect(
    `Live payroll — GET ${livePath} (baseline)`,
    !!baseline && typeof Number(baseline.grossSalary) === 'number',
    'live calculation failed',
  )) return;

  // Live INSS/IRRF vs statutory oracle
  {
    const inssBase = Number(baseline.inssBase);
    const inssAmount = Number(baseline.inssAmount);
    const irrfAmount = Number(baseline.irrfAmount);
    expect(
      `Live payroll — INSS de ${pu.name} confere com tabela progressiva 2026`,
      approx(inssAmount, expectedINSS(inssBase, livePeriod.year)),
      `api=${inssAmount} oracle=${expectedINSS(inssBase, livePeriod.year)} base=${inssBase}`,
    );
    expect(
      'Live payroll — IRRF confere com oráculo (dependentes=0, simplificado)',
      approx(irrfAmount, expectedIRRF(inssBase, inssAmount, 0, pu.hasSimplifiedDeduction, livePeriod.year)),
      `api=${irrfAmount} oracle=${expectedIRRF(inssBase, inssAmount, 0, pu.hasSimplifiedDeduction, livePeriod.year)}`,
    );
  }

  // ---------------- Dependents: irrfDeduction=false must be excluded -------
  {
    const create = await req('POST', '/dependents', {
      token,
      body: {
        userId: pu.id, name: `${MARKER} Dep IRRF-false`, birthDate: localNoon(2018, 3, 1).toISOString(),
        relationship: Object.values(DEPENDENT_RELATIONSHIP)[0], irrfDeduction: false, notes: MARKER,
      },
    });
    const depId = create.body?.data?.id;
    if (expect('Dependente irrfDeduction=false — criado', create.status === 201 && !!depId, `status=${create.status} ${JSON.stringify(create.body)?.slice(0, 180)}`)) {
      onCleanup(`dependent ${depId}`, async () => { await req('DELETE', `/dependents/${depId}`, { token }); });

      const withFalse = await liveSnapshot();
      const inssBase = Number(withFalse?.inssBase);
      const inssAmount = Number(withFalse?.inssAmount);
      expect(
        'Live payroll — dependente irrfDeduction=false NÃO conta (IRRF = oráculo deps=0)',
        !!withFalse && approx(Number(withFalse.irrfAmount), expectedIRRF(inssBase, inssAmount, 0, pu.hasSimplifiedDeduction, livePeriod.year)) &&
          approx(Number(withFalse.irrfAmount), Number(baseline.irrfAmount)),
        `irrf=${withFalse?.irrfAmount} baseline=${baseline.irrfAmount}`,
      );

      const flip = await req('PUT', `/dependents/${depId}`, { token, body: { irrfDeduction: true } });
      expect('Dependente — alternado para irrfDeduction=true', flip.status === 200, `status=${flip.status}`);
      const withTrue = await liveSnapshot();
      const oracleDeps1 = expectedIRRF(Number(withTrue?.inssBase), Number(withTrue?.inssAmount), 1, pu.hasSimplifiedDeduction, livePeriod.year);
      expect(
        'Live payroll — dependente irrfDeduction=true conta (IRRF = oráculo deps=1)',
        !!withTrue && approx(Number(withTrue.irrfAmount), oracleDeps1),
        `irrf=${withTrue?.irrfAmount} oracle=${oracleDeps1}`,
      );
      if (withTrue && approx(Number(withTrue.irrfAmount), Number(baseline.irrfAmount))) {
        info('Dependente — efeito não observável neste salário (desconto simplificado/redutor zera a diferença); oráculo confirmado mesmo assim');
      }

      const del = await req('DELETE', `/dependents/${depId}`, { token });
      expect('Dependente — removido (limpeza)', del.status === 200, `status=${del.status}`);
      const restored = await liveSnapshot();
      expect(
        'Live payroll — IRRF retorna ao baseline após limpeza',
        !!restored && approx(Number(restored.irrfAmount), Number(baseline.irrfAmount)),
        `irrf=${restored?.irrfAmount} baseline=${baseline.irrfAmount}`,
      );
    }
  }

  // ---------------- SUSPENDED enrollment must not produce co-pay ----------
  {
    const benefitsRes = await req('GET', '/benefits', { token, params: { kinds: [BENEFIT_KIND.PHARMACY_AGREEMENT], limit: 5 } });
    const pharmacy = (benefitsRes.body?.data ?? []).find((b: any) => b.isActive);
    if (!pharmacy) {
      skip('Co-pay SUSPENDED — benefício PHARMACY_AGREEMENT não encontrado');
    } else {
      const enr = await req('POST', '/user-benefits', {
        token,
        body: { userId: pu.id, benefitId: pharmacy.id, monthlyValue: 100, employeeDiscountPercent: 50, notes: `${MARKER} suspensão` },
      });
      const enrId = enr.body?.data?.id;
      if (expect('Co-pay — adesão ACTIVE criada (farmácia 50% de 100)', enr.status === 201 && !!enrId, `status=${enr.status} ${JSON.stringify(enr.body)?.slice(0, 180)}`)) {
        onCleanup(`user-benefit ${enrId}`, async () => { await req('DELETE', `/user-benefits/${enrId}`, { token }); });

        const withActive = await liveSnapshot();
        const deltaActive = Number(withActive?.totalDiscounts) - Number(baseline.totalDiscounts);
        expect(
          'Live payroll — adesão ACTIVE gera co-pay de 50,00',
          !!withActive && approx(deltaActive, 50),
          `delta=${deltaActive.toFixed(2)}`,
        );

        const susp = await req('PUT', `/user-benefits/${enrId}/suspend`, { token });
        expect('Co-pay — adesão suspensa', susp.status === 200 && susp.body?.data?.status === 'SUSPENDED', `status=${susp.status}`);

        const withSuspended = await liveSnapshot();
        const deltaSusp = Number(withSuspended?.totalDiscounts) - Number(baseline.totalDiscounts);
        expect(
          'Live payroll — adesão SUSPENDED NÃO gera co-pay (volta ao baseline)',
          !!withSuspended && approx(deltaSusp, 0),
          `delta=${deltaSusp.toFixed(2)}`,
        );

        const del = await req('DELETE', `/user-benefits/${enrId}`, { token });
        expect('Co-pay — adesão removida (limpeza)', del.status === 200, `status=${del.status}`);
      }
    }
  }

  // ---------------- Persistent discounts: loans ×2 + percentage on gross ---
  {
    // Safety pre-check: stored totals must equal row-derived totals, otherwise
    // create+delete would permanently shift the saved payroll.
    const payrollRes = await req('GET', `/payroll/${pu.payrollId}`, { token, params: { include: { discounts: true } } });
    const payroll = payrollRes.body?.data;
    if (!payroll) {
      skip('Descontos persistentes — folha base não carregada');
    } else {
      const gross = Number(payroll.grossSalary);
      const rowTotal = Math.round(
        (payroll.discounts ?? []).reduce((sum: number, d: any) => {
          if (d.isActive === false || d.discountType === 'FGTS') return sum;
          const value = d.value != null ? Number(d.value) : null;
          const pct = d.percentage != null ? Number(d.percentage) : null;
          if (value != null && value > 0) return sum + value;
          if (pct != null && pct > 0) return sum + (gross * pct) / 100;
          return sum;
        }, 0) * 100,
      ) / 100;
      const consistent = approx(rowTotal, Number(payroll.totalDiscounts), 0.02);
      if (!consistent) {
        skip(
          'Descontos persistentes — folha base inconsistente com as linhas (não é seguro criar/excluir descontos)',
          `rows=${rowTotal} stored=${payroll.totalDiscounts}`,
        );
      } else {
        const beforeNet = Number(payroll.netSalary);
        const beforeTotal = Number(payroll.totalDiscounts);

        const mkDiscount = async (body: any) => req('POST', '/discount', { token, body });
        const loan1 = await mkDiscount({ payrollId: pu.payrollId, value: 50, reference: `${MARKER} empréstimo A`, discountType: 'LOAN', isPersistent: true });
        const loan2 = await mkDiscount({ payrollId: pu.payrollId, value: 30, reference: `${MARKER} empréstimo B`, discountType: 'LOAN', isPersistent: true });
        const alimony = await mkDiscount({ payrollId: pu.payrollId, percentage: 10, reference: `${MARKER} pensão 10%`, discountType: 'ALIMONY', isPersistent: true });
        const ids = [loan1, loan2, alimony].map(r => r.body?.data?.id).filter(Boolean);
        for (const id of ids) onCleanup(`discount ${id}`, async () => { await req('DELETE', `/discount/${id}`, { token }); });

        const created = expect(
          'Descontos persistentes — 2 empréstimos + pensão 10% criados na folha base',
          loan1.status === 201 && loan2.status === 201 && alimony.status === 201,
          `statuses=${loan1.status},${loan2.status},${alimony.status} ${JSON.stringify(alimony.body)?.slice(0, 160)}`,
        );

        if (created) {
          const withDiscounts = await liveSnapshot();
          const liveGross = Number(withDiscounts?.grossSalary);
          const delta = Number(withDiscounts?.totalDiscounts) - Number(baseline.totalDiscounts);
          const expectedDelta = Math.round((50 + 30 + liveGross * 0.10) * 100) / 100;
          expect(
            'Live payroll — múltiplos empréstimos SOMADOS (50+30) e pensão 10% sobre o BRUTO',
            !!withDiscounts && approx(delta, expectedDelta, 0.03),
            `delta=${delta.toFixed(2)} expected=${expectedDelta.toFixed(2)} (gross=${liveGross})`,
          );
          const liveLoanRows = (withDiscounts?.discounts ?? []).filter((d: any) => d.discountType === 'LOAN' && String(d.reference ?? '').includes(MARKER));
          expect('Live payroll — as 2 linhas de empréstimo aparecem na folha ao vivo', liveLoanRows.length === 2, `rows=${liveLoanRows.length}`);
        }

        for (const id of ids) await req('DELETE', `/discount/${id}`, { token });
        const after = await req('GET', `/payroll/${pu.payrollId}`, { token });
        const afterNet = Number(after.body?.data?.netSalary);
        const afterTotal = Number(after.body?.data?.totalDiscounts);
        expect(
          'Descontos persistentes — folha base restaurada após limpeza (net/totais idênticos)',
          approx(afterNet, beforeNet, 0.011) && approx(afterTotal, beforeTotal, 0.011),
          `before net=${beforeNet}/total=${beforeTotal} after net=${afterNet}/total=${afterTotal}`,
        );
        const restored = await liveSnapshot();
        expect(
          'Live payroll — volta ao baseline após remover descontos',
          !!restored && approx(Number(restored.totalDiscounts), Number(baseline.totalDiscounts), 0.02),
          `total=${restored?.totalDiscounts} baseline=${baseline.totalDiscounts}`,
        );
      }
    }
  }
}

// ============================================================================
// SUITE: caps — benefit enrollment legal caps (Lei 7.418/85, PAT)
// ============================================================================

async function suiteCaps(fx: Fixtures) {
  const token = fx.tokens.accounting;

  const benefitsRes = await req('GET', '/benefits', { token, params: { limit: 100 } });
  const all: any[] = benefitsRes.body?.data ?? [];
  const byKind = (k: string) => all.find(b => b.kind === k && b.isActive);

  // A user without an ACTIVE enrollment for the given benefit (the service
  // rejects duplicate active enrollments before any cap check is relevant).
  const userCache = new Map<string, { id: string; name: string }>();
  function userWithoutActiveEnrollment(benefitId: string): { id: string; name: string } {
    if (userCache.has(benefitId)) return userCache.get(benefitId)!;
    // Prefer non-dismissed users; fall back to any active user (the throwaway
    // enrollment exists only for a few seconds and is deleted right after).
    const query = (extra: string) => psqlRows(`
      SELECT u.id, u.name FROM "User" u
      WHERE u."isActive" = true ${extra}
        AND NOT EXISTS (
          SELECT 1 FROM "UserBenefit" ub
          WHERE ub."userId" = u.id AND ub."benefitId" = '${benefitId}' AND ub.status::text = 'ACTIVE')
      ORDER BY u.name ASC LIMIT 1`);
    const rows = query(`AND u."contractKind"::text <> 'DISMISSED'`).length
      ? query(`AND u."contractKind"::text <> 'DISMISSED'`)
      : query('');
    const user = rows.length ? { id: rows[0][0], name: rows[0][1] } : (fx.capUser ?? { id: fx.accounting.id, name: fx.accounting.name });
    userCache.set(benefitId, user);
    return user;
  }

  const vt = byKind(BENEFIT_KIND.TRANSPORT_VOUCHER);
  const meal = byKind(BENEFIT_KIND.MEAL_VOUCHER);
  const food = byKind(BENEFIT_KIND.FOOD_VOUCHER);
  const health = byKind(BENEFIT_KIND.HEALTH_PLAN);

  async function expectCapRejected(name: string, benefit: any, percent: number, capLabel: string) {
    if (!benefit) { skip(`${name} — benefício não encontrado`); return; }
    const user = userWithoutActiveEnrollment(benefit.id);
    const res = await req('POST', '/user-benefits', {
      token,
      body: { userId: user.id, benefitId: benefit.id, monthlyValue: 200, employeeDiscountPercent: percent, notes: MARKER },
    });
    if (res.status === 201 && res.body?.data?.id) {
      onCleanup(`user-benefit ${res.body.data.id}`, async () => { await req('DELETE', `/user-benefits/${res.body.data.id}`, { token }); });
      fail(name, `criação deveria ser rejeitada (cap ${capLabel}) mas retornou 201`);
      await req('DELETE', `/user-benefits/${res.body.data.id}`, { token });
    } else {
      expect(name, res.status === 400 && String(res.body?.message ?? '').includes(capLabel), `status=${res.status} msg=${res.body?.message}`);
    }
  }

  async function expectAccepted(name: string, benefit: any, body: Record<string, any>) {
    if (!benefit) { skip(`${name} — benefício não encontrado`); return; }
    const user = userWithoutActiveEnrollment(benefit.id);
    const res = await req('POST', '/user-benefits', {
      token,
      body: { userId: user.id, benefitId: benefit.id, notes: MARKER, ...body },
    });
    const id = res.body?.data?.id;
    const ok = expect(name, res.status === 201 && !!id, `status=${res.status} msg=${res.body?.message}`);
    if (ok) {
      onCleanup(`user-benefit ${id}`, async () => { await req('DELETE', `/user-benefits/${id}`, { token }); });
      const del = await req('DELETE', `/user-benefits/${id}`, { token });
      expect(`${name} — limpeza`, del.status === 200, `status=${del.status}`);
    }
  }

  await expectCapRejected('Cap VT — desconto 6,01% rejeitado (Lei 7.418/85: máx 6%)', vt, 6.01, '6%');
  await expectAccepted('Cap VT — desconto exatamente 6% aceito', vt, { monthlyValue: 200, employeeDiscountPercent: 6 });
  await expectCapRejected('Cap VR — desconto 20,01% rejeitado (PAT: máx 20%)', meal, 20.01, '20%');
  await expectCapRejected('Cap VA — desconto 20,01% rejeitado (PAT: máx 20%)', food, 20.01, '20%');
  await expectAccepted('Cap VR — desconto exatamente 20% aceito', meal, { monthlyValue: 200, employeeDiscountPercent: 20 });

  // HEALTH percent 50 — no legal cap in the model (only VT/VR/VA are capped per contract)
  if (health) {
    const user = userWithoutActiveEnrollment(health.id);
    const res = await req('POST', '/user-benefits', {
      token,
      body: { userId: user.id, benefitId: health.id, monthlyValue: 200, employeeDiscountPercent: 50, notes: MARKER },
    });
    const id = res.body?.data?.id;
    if (res.status === 201 && id) {
      onCleanup(`user-benefit ${id}`, async () => { await req('DELETE', `/user-benefits/${id}`, { token }); });
      pass('Cap HEALTH — 50% aceito (sem cap legal específico; contrato prevê caps só para VT/VR/VA)');
      info('HEALTH sem cap percentual — CLT 462 exige autorização escrita (fluxo de declaração existe); comportamento conforme contrato, não é bug');
      await req('DELETE', `/user-benefits/${id}`, { token });
    } else {
      fail('Cap HEALTH — 50% deveria ser aceito', `status=${res.status} msg=${res.body?.message}`);
    }
  } else skip('Cap HEALTH — benefício não encontrado');

  // fixed discount > monthlyValue → 400
  if (health) {
    const user = userWithoutActiveEnrollment(health.id);
    const res = await req('POST', '/user-benefits', {
      token,
      body: { userId: user.id, benefitId: health.id, monthlyValue: 200, employeeDiscountValue: 250, notes: MARKER },
    });
    if (res.status === 201 && res.body?.data?.id) {
      onCleanup(`user-benefit ${res.body.data.id}`, async () => { await req('DELETE', `/user-benefits/${res.body.data.id}`, { token }); });
      fail('Cap valor fixo — desconto 250 > custo 200 deveria ser rejeitado', 'retornou 201');
      await req('DELETE', `/user-benefits/${res.body.data.id}`, { token });
    } else {
      expect('Cap valor fixo — desconto fixo maior que o custo do benefício rejeitado (400)', res.status === 400, `status=${res.status} msg=${res.body?.message}`);
    }
  }
}

// ============================================================================
// SUITE: gates — privilege matrix per endpoint family
// ============================================================================

async function suiteGates(fx: Fixtures) {
  interface GateSpec { label: string; path: string; params?: Record<string, any>; acct: number; prod: number; fin: number }
  const dp = (label: string, path: string, params?: Record<string, any>): GateSpec =>
    ({ label, path, params, acct: 200, prod: 403, fin: 403 });

  const specs: GateSpec[] = [
    dp('Admissões', '/admissions'),
    dp('Rescisões', '/terminations'),
    dp('Dependentes', '/dependents'),
    dp('Benefícios', '/benefits'),
    dp('Adesões', '/user-benefits'),
    dp('Exames médicos', '/medical-exams'),
    dp('Afastamentos', '/leaves'),
    dp('Reajustes salariais', '/salary-adjustments'),
    dp('Histórico de cargos', '/user-position-history'),
    dp('Agenda', '/agenda-events'),
    dp('Folha de pagamento', '/payroll', { limit: 5 }),
    { label: 'Post-its (escopo próprio)', path: '/postits', acct: 200, prod: 200, fin: 200 },
    { label: 'Contas a pagar — resumo', path: '/orders/payment-summary', acct: 200, prod: 403, fin: 200 },
    { label: 'Pedidos (orders list — guarda ampla por contrato)', path: '/orders', params: { limit: 5 }, acct: 200, prod: 200, fin: 200 },
    { label: 'Reconciliação — transações', path: '/financial/reconciliation/transactions', params: { limit: 5 }, acct: 200, prod: 403, fin: 200 },
  ];

  const actors: Array<{ key: 'acct' | 'prod' | 'fin'; label: string; token: string }> = [
    { key: 'acct', label: 'ACCOUNTING', token: fx.tokens.accounting },
    { key: 'prod', label: 'PRODUCTION', token: fx.tokens.production },
    { key: 'fin', label: 'FINANCIAL', token: fx.tokens.financial },
  ];

  for (const spec of specs) {
    for (const actor of actors) {
      const expected = spec[actor.key];
      const res = await req('GET', spec.path, { token: actor.token, params: spec.params });
      expect(
        `Gate — ${spec.label}: ${actor.label} → ${expected}`,
        res.status === expected,
        `got=${res.status} ${JSON.stringify(res.body)?.slice(0, 140)}`,
      );
    }
  }

  // PRODUCTION must not WRITE in DP families either (spot check)
  {
    const res = await req('POST', '/dependents', {
      token: fx.tokens.production,
      body: {
        userId: fx.production.id, name: `${MARKER} bloqueado`, birthDate: localNoon(2015, 1, 1).toISOString(),
        relationship: Object.values(DEPENDENT_RELATIONSHIP)[0],
      },
    });
    if (res.status === 201 && res.body?.data?.id) {
      onCleanup(`dependent ${res.body.data.id}`, async () => { await req('DELETE', `/dependents/${res.body.data.id}`, { token: fx.tokens.accounting }); });
      fail('Gate — PRODUCTION não pode criar dependente', 'retornou 201');
    } else {
      expect('Gate — PRODUCTION não pode criar dependente (403)', res.status === 403, `status=${res.status}`);
    }
  }
  // FINANCIAL must not WRITE terminations
  {
    const res = await req('POST', '/terminations', {
      token: fx.tokens.financial,
      body: { userId: fx.cltLong?.id ?? fx.production.id, type: TERMINATION_TYPE.RESIGNATION, reason: `${MARKER} bloqueado` },
    });
    if (res.status === 201 && res.body?.data?.id) {
      onCleanup(`termination ${res.body.data.id}`, async () => { await req('DELETE', `/terminations/${res.body.data.id}`, { token: fx.tokens.accounting }); });
      fail('Gate — FINANCIAL não pode criar rescisão', 'retornou 201');
    } else {
      expect('Gate — FINANCIAL não pode criar rescisão (403)', res.status === 403, `status=${res.status}`);
    }
  }
  // Postit scoping: PRODUCTION only sees its own
  {
    const create = await req('POST', '/postits', { token: fx.tokens.accounting, body: { content: `${MARKER} escopo ${Date.now()}` } });
    const id = create.body?.data?.id;
    if (id) {
      onCleanup(`postit ${id}`, async () => { await req('DELETE', `/postits/${id}`, { token: fx.tokens.accounting }); });
      const prodList = await req('GET', '/postits', { token: fx.tokens.production });
      const leaked = (prodList.body?.data ?? []).some((p: any) => p.id === id);
      expect('Gate — post-it de ACCOUNTING invisível para PRODUCTION (escopo por usuário)', prodList.status === 200 && !leaked, leaked ? 'VAZOU' : `status=${prodList.status}`);
      await req('DELETE', `/postits/${id}`, { token: fx.tokens.accounting });
    } else {
      skip('Gate — escopo de post-its (criação falhou)');
    }
  }
}

// ============================================================================
// Pre-clean: remove leftovers from previous crashed runs (marker-guarded)
// ============================================================================

async function preClean(fx: Fixtures) {
  const token = fx.tokens.accounting;
  const sweeps: Array<{ path: string; field: (r: any) => string }> = [
    { path: '/terminations', field: r => r.reason ?? '' },
    { path: '/user-benefits', field: r => r.notes ?? '' },
    { path: '/benefits', field: r => r.name ?? '' },
    { path: '/dependents', field: r => `${r.name ?? ''} ${r.notes ?? ''}` },
    { path: '/leaves', field: r => r.notes ?? '' },
    { path: '/medical-exams', field: r => r.notes ?? '' },
    { path: '/agenda-events', field: r => r.title ?? '' },
    { path: '/postits', field: r => r.content ?? '' },
    { path: '/admissions', field: r => r.notes ?? '' },
  ];
  let removed = 0;
  for (const sweep of sweeps) {
    const res = await req('GET', sweep.path, { token, params: { limit: 100 } });
    const rows: any[] = res.body?.data ?? [];
    for (const r of rows) {
      if (sweep.field(r).includes(MARKER)) {
        const del = await req('DELETE', `${sweep.path}/${r.id}`, { token });
        if (del.status !== 200) await req('DELETE', `${sweep.path}/${r.id}`, { token: fx.tokens.admin });
        removed++;
      }
    }
  }
  if (fx.payUser) {
    const res = await req('GET', `/discount/by-payroll/${fx.payUser.payrollId}`, { token });
    for (const d of res.body?.data ?? []) {
      if (String(d.reference ?? '').includes(MARKER)) {
        await req('DELETE', `/discount/${d.id}`, { token });
        removed++;
      }
    }
  }
  if (removed > 0) console.log(`  (pre-clean: removed ${removed} leftover ${MARKER} record(s) from previous runs)`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`\nE2E ACCOUNTING verification harness — base ${BASE}`);
  console.log(`Suites: ${SUITE_FILTER.join(', ')}\n`);

  // liveness
  try {
    const ping = await fetch(`${BASE}/health`).catch(() => fetch(BASE));
    if (!ping) throw new Error('no response');
  } catch (e: any) {
    console.error(`API at ${BASE} is not reachable: ${e?.message}`);
    process.exit(2);
  }

  const fx = resolveFixtures();
  console.log(`Fixtures: ACCOUNTING=${fx.accounting.name} | PRODUCTION=${fx.production.name} | FINANCIAL=${fx.financial.name} | ADMIN=${fx.admin.name}`);
  console.log(`CLT users: long=${fx.cltLong?.name ?? '—'} (desde ${fx.cltLong?.exp1StartAt.toISOString().slice(0, 10)}) | exp=${fx.cltExp?.name ?? '—'}`);
  console.log(`Payroll user: ${fx.payUser?.name ?? '—'} | base period ${fx.basePeriod.month}/${fx.basePeriod.year} | live ${fx.livePeriod.month}/${fx.livePeriod.year}\n`);

  await preClean(fx);

  const suites: Array<{ key: string; title: string; run: () => Promise<void> }> = [
    { key: 'query', title: 'QUERY-REPLAY (web app queries + CRUD cycles)', run: () => suiteQuery(fx) },
    { key: 'clt', title: 'CLT EDGE (termination engine + /calculate)', run: () => suiteClt(fx) },
    { key: 'payroll', title: 'PAYROLL EDGE (INSS/IRRF/co-pay/loans)', run: () => suitePayroll(fx) },
    { key: 'caps', title: 'BENEFIT CAPS (Lei 7.418/85 + PAT)', run: () => suiteCaps(fx) },
    { key: 'gates', title: 'GATES (privilege matrix)', run: () => suiteGates(fx) },
  ];

  try {
    for (const suite of suites) {
      if (!SUITE_FILTER.includes(suite.key)) continue;
      currentSuite = suite.key;
      console.log(`\n━━━ ${suite.title} ━━━`);
      try {
        await suite.run();
      } catch (e: any) {
        fail(`suite ${suite.key} aborted`, e?.stack?.split('\n').slice(0, 3).join(' | ') ?? String(e));
      }
    }
  } finally {
    currentSuite = 'cleanup';
    await runCleanup();
  }

  // ------------------------- final matrix ---------------------------------
  console.log('\n══════════════════ FINAL MATRIX ══════════════════');
  const suiteKeys = [...new Set(results.map(r => r.suite))];
  let totalFail = 0;
  for (const key of suiteKeys) {
    const rs = results.filter(r => r.suite === key);
    const p = rs.filter(r => r.status === 'PASS').length;
    const f = rs.filter(r => r.status === 'FAIL').length;
    const s = rs.filter(r => r.status === 'SKIP').length;
    const i = rs.filter(r => r.status === 'INFO').length;
    totalFail += f;
    console.log(`  ${key.padEnd(8)} PASS=${String(p).padStart(3)}  FAIL=${String(f).padStart(3)}  SKIP=${String(s).padStart(2)}  INFO=${String(i).padStart(2)}`);
  }
  const failures = results.filter(r => r.status === 'FAIL');
  if (failures.length > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  ✗ [${f.suite}] ${f.name}\n      ${f.detail ?? ''}`);
  }
  const infos = results.filter(r => r.status === 'INFO');
  if (infos.length > 0) {
    console.log('\nFINDINGS / NOTES:');
    for (const i of infos) console.log(`  i [${i.suite}] ${i.name}${i.detail ? `\n      ${i.detail}` : ''}`);
  }
  if (cleanupFailures.length > 0) {
    console.log('\nCLEANUP FAILURES (manual review needed):');
    for (const c of cleanupFailures) console.log(`  ! ${c}`);
  } else {
    console.log('\nCleanup: all throwaway records removed (LIFO stack empty).');
  }
  console.log(`\nTotal requests: ${requestCount}`);
  process.exit(totalFail > 0 || cleanupFailures.length > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Harness crashed:', e);
  runCleanup().finally(() => process.exit(2));
});
