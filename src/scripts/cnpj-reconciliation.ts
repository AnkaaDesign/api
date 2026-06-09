/**
 * cnpj-reconciliation.ts
 * ---------------------------------------------------------------------------
 * Reconciles the REAL recipient CNPJ taken from issued NFS-e (Elotech OXY)
 * against the manually-filled `Customer.cnpj` in our database.
 *
 * Why: customer CNPJs were typed by hand from the fantasy name and are often
 * wrong. The `tomadorCnpjCpf` on each emitted NFS-e is what was actually sent
 * to the prefecture, so when the two differ the NF value is the correct one.
 *
 * Data sources (both live — safe to run on the server):
 *   - Elotech OXY  → read-only "consultar-documentos-fiscais" (same endpoints
 *                    and env vars as ElotechOxyNfseService; inlined here so the
 *                    script is standalone and does not bootstrap the Nest app)
 *   - Database     → prisma.customer (fantasyName / corporateName / cnpj / cpf)
 *
 * Matching: names are linked with IDF-weighted token overlap (a shared RARE
 * token like a surname counts; a generic word like "FRUTAS"/"TRANSPORTE" does
 * not). Any NF CNPJ that name-matches 2+ different customers is treated as a
 * shared carrier/intermediary (transportadora) and NOT reported as an error.
 *
 * Run in dev:   pnpm reconcile:cnpj
 * Run in prod:  NODE_ENV=production pnpm reconcile:cnpj
 *
 * Config (env, all optional):
 *   CNPJ_RECON_YEARS   how many years back to scan          (default 3)
 *   CNPJ_RECON_FROM    explicit start date YYYY-MM-DD        (overrides YEARS)
 *   CNPJ_RECON_TO      explicit end date   YYYY-MM-DD        (default today)
 *   CNPJ_RECON_OUT     output directory                      (default api/reports)
 *
 * Outputs (overwritten each run):
 *   - <OUT>/cnpj-reconciliation.md    human report
 *   - <OUT>/cnpj-reconciliation.json  structured rows (with customerId)
 * Read-only: this script performs NO database writes.
 * ---------------------------------------------------------------------------
 */
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const log = (...a: unknown[]) => console.log('[cnpj-reconciliation]', ...a);

// ----------------------------------------------------------------------------
// Elotech OXY — read-only NFS-e listing (mirrors ElotechOxyNfseService)
// ----------------------------------------------------------------------------
async function makeElotechClient() {
  const BASE = process.env.ELOTECH_OXY_BASE_URL!;
  const USER = process.env.ELOTECH_OXY_USERNAME!;
  const PASS = process.env.ELOTECH_OXY_PASSWORD!;
  let EMPRESA = process.env.ELOTECH_OXY_EMPRESA_ID || '';
  const CONTRIB = Number(process.env.ELOTECH_OXY_CONTRIBUINTE_ID || '98895');
  if (!BASE || !USER || !PASS) throw new Error('Missing ELOTECH_OXY_* env vars');

  const login = await axios.post(`${BASE}/authentication/login`, {
    username: USER, password: PASS, tipo: 'USUARIO', captcha: '', rememberMe: true,
  });
  const token: string = login.data.id_token;
  if (!token) throw new Error('No id_token in Elotech login response');

  const contrib = await axios.get(`${BASE}/acesso-web-empresas/contribuinte-padrao`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const contribData = contrib.data;
  if (!EMPRESA && contribData?.id) EMPRESA = String(contribData.id);
  const cookie = encodeURIComponent(JSON.stringify(contribData));
  const headers = {
    Authorization: `Bearer ${token}`,
    empresa: EMPRESA,
    active_view: '/consulta-documentos-fiscais',
    'Content-Type': 'application/json',
    Cookie: `authorization_iss=${token}; contribuinte_iss=${cookie}`,
  };
  log(`Authenticated as ${contribData?.razaoSocialNome} (${contribData?.cnpjCpf}), empresa=${EMPRESA}`);

  const basePayload = (firstResult: number, maxResult: number, from: string, to: string) => ({
    tipoServico: 'PRESTADOS', homologacao: 'N',
    dataEmissaoInicial: from, dataEmissaoFinal: to,
    dataDigitacaoInicial: null, dataDigitacaoFinal: null,
    apenasAtividadesDoCadastro: 'false', tipoPessoa: null, cpfCnpj: null,
    uf: null, cidade: null, razaoSocial: null, intermediario: 'false', cnae: '',
    inscricaoMunicipal: null, situacao: null, naturezaOperacaoId: null,
    issRetido: null, possuiImpostoFederal: null, entregueNaDMS: null,
    numeroDocumentoInicial: null, numeroDocumentoFinal: null, tipoDocumentoFiscalId: null,
    firstResult, maxResult, contribuinteId: CONTRIB,
    notasSelecionadas: [], sortBy: null, sortOrder: null,
  });

  return {
    async total(from: string, to: string): Promise<number> {
      const res = await axios.post(`${BASE}/consultar-documentos-fiscais/totais-consulta`,
        basePayload(0, 1, from, to), { headers, timeout: 20000 });
      return res.data?.totalDocumentos || 0;
    },
    async page(firstResult: number, maxResult: number, from: string, to: string): Promise<any[]> {
      const res = await axios.post(`${BASE}/consultar-documentos-fiscais/consultar`,
        basePayload(firstResult, maxResult, from, to), { headers, timeout: 30000 });
      return res.data?.data || [];
    },
  };
}

// ----------------------------------------------------------------------------
// text helpers
// ----------------------------------------------------------------------------
const onlyDigits = (s?: string | null) => (s || '').replace(/\D/g, '');
const root8 = (cnpj: string) => (cnpj || '').slice(0, 8);

const SUFFIXES =
  /\b(LTDA|ME|EPP|EIRELI|S\/?A|SA|S\/S|SS|MEI|EI|COMERCIO|COMERCIAL|INDUSTRIA|INDUSTRIAL|DISTRIBUIDORA|TRANSPORTES|ALIMENTOS|SUPERMERCADO|SUPERMERCADOS|MERCADO|& CIA|CIA|E CIA)\b/g;

// generic commercial words that must NOT, on their own, link two companies
const STOP = new Set([
  'COMERCIO', 'COMERCIAL', 'DISTRIBUIDORA', 'DISTRIBUICAO', 'TRANSPORTE', 'TRANSPORTES', 'TRANSPORTADORA',
  'ALIMENTOS', 'ALIMENTO', 'PRODUTOS', 'PRODUTO', 'FRUTAS', 'FRUTA', 'CARNES', 'CARNE', 'FRIGORIFICO',
  'INDUSTRIA', 'INDUSTRIAL', 'SUPERMERCADO', 'SUPERMERCADOS', 'MERCADO', 'HORTIFRUTI', 'HORTIFRUTIGRANJEIROS',
  'DOCES', 'BEBIDAS', 'COMESTIVEIS', 'GENEROS', 'ATACADO', 'ATACADISTA', 'VAREJO', 'REPRESENTACAO',
  'REPRESENTACOES', 'SERVICOS', 'SERVICO', 'LOGISTICA', 'NACIONAL', 'BRASIL', 'DERIVADOS', 'GRANJA',
  'GRANJEIROS', 'EMPORIO', 'RESTAURANTE', 'PADARIA', 'CONVENIENCIA', 'CARGAS', 'RODOVIARIO', 'IMPORTACAO',
  'EXPORTACAO', 'COM', 'IND', 'DISTR', 'LOG', 'TRANSP', 'PROD', 'REST', 'LTDA', 'EIRELI', 'EPP',
]);

function norm(s?: string | null): string {
  return (s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,/&'`\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function nameKey(s?: string | null): string {
  return norm(s).replace(SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(s?: string | null): Set<string> {
  return new Set(nameKey(s).split(' ').filter((t) => t.length >= 3 && !STOP.has(t)));
}

const fmt = (d?: string | null) =>
  !d
    ? '(vazio)'
    : d.length === 14
    ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : d.length === 11
    ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
    : d;

// ----------------------------------------------------------------------------
// types
// ----------------------------------------------------------------------------
interface Party {
  cnpj: string;
  topName: string;
  count: number;
  first: string;
  last: string;
  toks: Set<string>;
}
interface Cust {
  id: string;
  fantasyName: string | null;
  corporateName: string | null;
  cnpj: string | null;
  cpf: string | null;
}
interface Result {
  cust: Cust;
  custDoc: string;
  directHit: Party | null;
  best: Party | null;
  bestScore: number;
  bestRareDf: number;
  hitNameScore: number;
  hitComparable: boolean;
}

// ----------------------------------------------------------------------------
async function main() {
  const prisma = new PrismaClient();

  try {
    const elotech = await makeElotechClient();

    // ---- date range ----
    const to = process.env.CNPJ_RECON_TO || new Date().toISOString().slice(0, 10);
    let from = process.env.CNPJ_RECON_FROM;
    if (!from) {
      const years = Number(process.env.CNPJ_RECON_YEARS || '3');
      const d = new Date(to);
      d.setFullYear(d.getFullYear() - years);
      from = d.toISOString().slice(0, 10);
    }
    log(`Scanning NFS-e from ${from} to ${to}...`);

    // ---- fetch all NFs (paged) ----
    const PAGE = 200;
    const seen = new Map<number, any>();
    const total = await elotech.total(from, to);
    for (let f = 0; f < total; f += PAGE) {
      const page = await elotech.page(f, PAGE, from, to);
      for (const d of page) seen.set(d.id, d);
      log(`  fetched ${seen.size}/${total}`);
    }
    const nfs = [...seen.values()];
    log(`Total NFs: ${nfs.length} (declared ${total})`);

    // ---- aggregate NF recipients (tomador) by CNPJ/CPF ----
    const byCnpj = new Map<string, Party>();
    for (const nf of nfs) {
      const doc = onlyDigits(nf.tomadorCnpjCpf);
      if (!doc) continue;
      const name = nf.tomadorRazaoNome || '';
      let e = byCnpj.get(doc);
      if (!e) {
        e = { cnpj: doc, topName: name, count: 0, first: nf.dataEmissao, last: nf.dataEmissao, toks: new Set() };
        (e as any).names = new Map<string, number>();
        byCnpj.set(doc, e);
      }
      const names: Map<string, number> = (e as any).names;
      names.set(name, (names.get(name) || 0) + 1);
      e.count++;
      if (nf.dataEmissao < e.first) e.first = nf.dataEmissao;
      if (nf.dataEmissao > e.last) e.last = nf.dataEmissao;
    }
    const nfParties: Party[] = [...byCnpj.values()].map((e) => {
      const names: Map<string, number> = (e as any).names;
      const topName = [...names.entries()].sort((a, b) => b[1] - a[1])[0][0];
      e.topName = topName;
      e.toks = tokens(topName);
      return e;
    });
    const partyByCnpj = new Map(nfParties.map((p) => [p.cnpj, p]));
    const realCnpjSet = new Set(nfParties.map((p) => p.cnpj));

    // ---- customers ----
    const customers: Cust[] = await prisma.customer.findMany({
      select: { id: true, fantasyName: true, corporateName: true, cnpj: true, cpf: true },
    });

    // ---- IDF corpus ----
    const DF = new Map<string, number>();
    let NDOCS = 0;
    const addDoc = (toks: Set<string>) => {
      NDOCS++;
      for (const t of toks) DF.set(t, (DF.get(t) || 0) + 1);
    };
    const idf = (t: string) => Math.log((NDOCS + 1) / ((DF.get(t) || 0) + 1)) + 1;
    for (const p of nfParties) addDoc(p.toks);
    for (const c of customers) {
      addDoc(tokens(c.fantasyName));
      addDoc(tokens(c.corporateName));
    }
    const matchScore = (a: Set<string>, b: Set<string>) => {
      if (!a.size || !b.size) return { score: 0, rareDf: 99 };
      let interW = 0, aW = 0, bW = 0, rareDf = 99;
      for (const t of a) aW += idf(t);
      for (const t of b) bW += idf(t);
      for (const t of a)
        if (b.has(t)) {
          interW += idf(t);
          rareDf = Math.min(rareDf, DF.get(t) || 99);
        }
      if (interW === 0) return { score: 0, rareDf: 99 };
      return { score: interW / Math.min(aW, bW), rareDf };
    };

    // ---- match each customer to best NF party ----
    const results: Result[] = customers.map((cust) => {
      const custDoc = onlyDigits(cust.cnpj) || onlyDigits(cust.cpf);
      const tf = tokens(cust.fantasyName);
      const tc = tokens(cust.corporateName);
      const directHit = custDoc && realCnpjSet.has(custDoc) ? partyByCnpj.get(custDoc)! : null;

      let best: Party | null = null, bestScore = 0, bestRareDf = 99;
      for (const p of nfParties) {
        const mf = matchScore(tf, p.toks);
        const mc = matchScore(tc, p.toks);
        const m = mf.score >= mc.score ? mf : mc;
        if (m.score > bestScore) {
          bestScore = m.score;
          best = p;
          bestRareDf = m.rareDf;
        }
      }

      let hitNameScore = 1, hitComparable = false;
      if (directHit) {
        hitNameScore = Math.max(matchScore(tf, directHit.toks).score, matchScore(tc, directHit.toks).score);
        hitComparable = directHit.toks.size > 0 && (tf.size > 0 || tc.size > 0);
      }
      return { cust, custDoc, directHit, best, bestScore, bestRareDf, hitNameScore, hitComparable };
    });

    // ---- detect shared carriers: an NF CNPJ that name-matches 2+ customers ----
    const matchVotes = new Map<string, Set<string>>();
    for (const r of results)
      if (r.best && r.bestScore >= 0.6) {
        if (!matchVotes.has(r.best.cnpj)) matchVotes.set(r.best.cnpj, new Set());
        matchVotes.get(r.best.cnpj)!.add(r.cust.id);
      }
    const sharedCarrierCnpjs = new Set(
      [...matchVotes.entries()].filter(([, ids]) => ids.size >= 2).map(([cnpj]) => cnpj),
    );

    // ---- classify ----
    const confirmed: Result[] = [];
    const crossed: Result[] = [];
    const mismatch: Result[] = [];
    const review: Result[] = [];
    const filial: Result[] = [];
    const sharedCarrier: Result[] = [];
    const noCnpj: Result[] = [];
    const cpfCust: Result[] = [];
    const noNf: Result[] = [];

    for (const r of results) {
      const { cust, custDoc, directHit, best, bestScore, bestRareDf } = r;
      if (!cust.cnpj && cust.cpf) { cpfCust.push(r); continue; }
      if (!cust.cnpj) { noCnpj.push(r); continue; }
      if (directHit) {
        if (r.hitComparable && r.hitNameScore < 0.35) crossed.push(r);
        else confirmed.push(r);
        continue;
      }
      if (best && bestScore >= 0.6 && best.cnpj !== custDoc) {
        if (root8(best.cnpj) === root8(custDoc)) { filial.push(r); continue; }
        if (sharedCarrierCnpjs.has(best.cnpj)) { sharedCarrier.push(r); continue; }
        if (bestRareDf <= 3) mismatch.push(r);
        else review.push(r);
        continue;
      }
      noNf.push(r);
    }

    // ---- NF recipients with no customer in DB ----
    const matchedNfCnpjs = new Set<string>();
    for (const r of [...confirmed, ...mismatch, ...review, ...filial, ...sharedCarrier]) {
      if (r.directHit) matchedNfCnpjs.add(r.directHit.cnpj);
      if (r.best && r.bestScore >= 0.6) matchedNfCnpjs.add(r.best.cnpj);
    }
    const unmatchedNf = nfParties
      .filter((p) => !matchedNfCnpjs.has(p.cnpj))
      .filter((p) => {
        let bs = 0;
        for (const c of customers)
          bs = Math.max(bs, matchScore(p.toks, tokens(c.fantasyName)).score, matchScore(p.toks, tokens(c.corporateName)).score);
        return bs < 0.6;
      })
      .sort((a, b) => b.count - a.count);

    // ---- markdown ----
    const cf = fmt;
    const rowsByCount = (arr: Result[]) => [...arr].sort((a, b) => (b.best?.count || 0) - (a.best?.count || 0));
    const mdRow = (r: Result) =>
      `| ${r.cust.fantasyName ?? ''} | ${r.cust.corporateName ?? ''} | ${cf(r.custDoc)} | ${r.best!.topName.trim()} | ${cf(r.best!.cnpj)} | ${r.best!.count} |\n`;

    let md = '';
    md += `# Reconciliação de CNPJ — NFS-e (Elotech) × Cadastro de Clientes\n\n`;
    md += `**Período:** ${from} a ${to}  \n`;
    md += `**NFs analisadas:** ${nfs.length}  |  **Tomadores únicos:** ${nfParties.length}  |  **Clientes:** ${customers.length}\n\n`;
    md += `O CNPJ "real" vem de \`tomadorCnpjCpf\` de cada NF (o que foi enviado à prefeitura). Quando diverge do cadastro, **o da NF é o correto**.\n\n`;
    md += `## Resumo\n\n| Categoria | Qtd |\n|---|---:|\n`;
    md += `| ✔ CNPJ confirmado | ${confirmed.length} |\n`;
    md += `| ✖ CNPJ errado — alta confiança | ${mismatch.length} |\n`;
    md += `| ~ CNPJ divergente — revisar | ${review.length} |\n`;
    md += `| ⤫ CNPJ trocado (de outra empresa) | ${crossed.length} |\n`;
    md += `| ↪ Filial diferente (mesma raiz) | ${filial.length} |\n`;
    md += `| 🚚 CNPJ de transportadora/compartilhado (ignorar) | ${sharedCarrier.length} |\n`;
    md += `| ⚠ Sem CNPJ no cadastro | ${noCnpj.length} |\n`;
    md += `| • Pessoa física (CPF) | ${cpfCust.length} |\n`;
    md += `| ? Não verificável | ${noNf.length} |\n`;
    md += `| ⛔ Faturado sem cadastro | ${unmatchedNf.length} |\n\n`;

    const section = (title: string, arr: Result[]) => {
      md += `## ${title}\n\n| Cliente (fantasia) | Razão no cadastro | CNPJ cadastrado | Nome na NF | CNPJ real (NF) | NFs |\n|---|---|---|---|---|---:|\n`;
      for (const r of rowsByCount(arr)) md += mdRow(r);
      md += `\n`;
    };
    section('✖ CNPJ errado — alta confiança (corrigir)', mismatch);
    section('~ CNPJ divergente — revisar', review);

    md += `## ⤫ CNPJ trocado (pertence a outra empresa)\n\n| Cliente | CNPJ cadastrado | Dono real do CNPJ (NF) | NFs |\n|---|---|---|---:|\n`;
    for (const r of crossed.sort((a, b) => (b.directHit?.count || 0) - (a.directHit?.count || 0)))
      md += `| ${r.cust.fantasyName ?? ''} | ${cf(r.custDoc)} | ${r.directHit!.topName.trim()} | ${r.directHit!.count} |\n`;
    md += `\n## ↪ Filial diferente (mesma empresa)\n\n| Cliente | CNPJ cadastrado | CNPJ na NF | NFs |\n|---|---|---|---:|\n`;
    for (const r of rowsByCount(filial)) md += `| ${r.cust.fantasyName ?? ''} | ${cf(r.custDoc)} | ${cf(r.best!.cnpj)} | ${r.best!.count} |\n`;
    md += `\n## 🚚 CNPJ de transportadora/compartilhado (NÃO corrigir)\n\n_Mesmo CNPJ da NF casou com 2+ clientes — provável transportadora/intermediário._\n\n| Cliente | CNPJ cadastrado | Nome na NF | CNPJ NF | NFs |\n|---|---|---|---|---:|\n`;
    for (const r of rowsByCount(sharedCarrier)) md += `| ${r.cust.fantasyName ?? ''} | ${cf(r.custDoc)} | ${r.best!.topName.trim()} | ${cf(r.best!.cnpj)} | ${r.best!.count} |\n`;
    md += `\n## ⛔ Tomadores faturados sem cadastro (top por NFs)\n\n| Nome na NF | CNPJ/CPF | NFs |\n|---|---|---:|\n`;
    for (const p of unmatchedNf) md += `| ${p.topName.trim()} | ${cf(p.cnpj)} | ${p.count} |\n`;
    md += `\n## ⚠ Clientes sem CNPJ (com possível NF correspondente)\n\n| Cliente | Possível CNPJ (NF) | Nome na NF |\n|---|---|---|\n`;
    for (const r of noCnpj) if (r.best && r.bestScore >= 0.55) md += `| ${r.cust.fantasyName ?? ''} | ${cf(r.best.cnpj)} | ${r.best.topName.trim()} |\n`;
    md += `\n---\n_Gerado por \`pnpm reconcile:cnpj\` em ${to}._\n`;

    // ---- structured json ----
    const toRow = (r: Result, kind: string) => ({
      kind,
      customerId: r.cust.id,
      fantasyName: r.cust.fantasyName,
      corporateName: r.cust.corporateName,
      storedCnpj: r.custDoc,
      nfCnpj: r.best?.cnpj ?? null,
      nfName: r.best?.topName ?? null,
      nfCount: r.best?.count ?? 0,
      sameRoot: r.best ? root8(r.best.cnpj) === root8(r.custDoc) : false,
      score: r.best ? Number(r.bestScore.toFixed(2)) : 0,
    });
    const json = [
      ...mismatch.map((r) => toRow(r, 'WRONG_CNPJ_HIGH')),
      ...review.map((r) => toRow(r, 'WRONG_CNPJ_REVIEW')),
      ...crossed.map((r) => ({
        kind: 'CNPJ_BELONGS_TO_OTHER',
        customerId: r.cust.id,
        fantasyName: r.cust.fantasyName,
        corporateName: r.cust.corporateName,
        storedCnpj: r.custDoc,
        cnpjRealOwner: r.directHit!.topName,
        ownerNfCount: r.directHit!.count,
      })),
      ...filial.map((r) => toRow(r, 'DIFFERENT_BRANCH')),
      ...sharedCarrier.map((r) => toRow(r, 'SHARED_CARRIER')),
    ];

    // ---- write ----
    const outDir = process.env.CNPJ_RECON_OUT || path.resolve(process.cwd(), 'reports');
    await fs.mkdir(outDir, { recursive: true });
    const mdPath = path.join(outDir, 'cnpj-reconciliation.md');
    const jsonPath = path.join(outDir, 'cnpj-reconciliation.json');
    await fs.writeFile(mdPath, md);
    await fs.writeFile(jsonPath, JSON.stringify(json, null, 2));

    log('======================================================');
    log(`✔ confirmado: ${confirmed.length}   ✖ errado: ${mismatch.length}   ~ revisar: ${review.length}`);
    log(`⤫ trocado: ${crossed.length}   ↪ filial: ${filial.length}   🚚 transportadora: ${sharedCarrier.length}`);
    log(`⚠ sem cnpj: ${noCnpj.length}   • cpf: ${cpfCust.length}   ? n/verif: ${noNf.length}   ⛔ faturado s/ cadastro: ${unmatchedNf.length}`);
    log(`Relatório:  ${mdPath}`);
    log(`JSON:       ${jsonPath}`);
    log('======================================================');
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('cnpj-reconciliation failed:', err?.response?.data || err);
    process.exit(1);
  });
