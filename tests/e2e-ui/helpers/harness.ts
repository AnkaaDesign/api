/**
 * Harness do e2e de UI — mesma ideia do `check()` de `multitask-quote-e2e`:
 * nenhuma asserção derruba a bateria. Um cenário que falha registra o defeito,
 * tira a foto da tela e o próximo cenário continua — é o contrário de um
 * `expect` que aborta e esconde os outros oito defeitos atrás do primeiro.
 */
import fs from 'fs';
import path from 'path';
import type { Page } from 'playwright';

export const ART = path.join(__dirname, '..', 'artifacts');

export interface Finding {
  phase: string;
  name: string;
  ok: boolean;
  detail?: string;
  shot?: string;
}

const findings: Finding[] = [];
let currentPhase = 'geral';

export function phase(title: string) {
  currentPhase = title;
  console.log(`\n\x1b[1m═══ ${title} ═══\x1b[0m`);
}

export function check(name: string, ok: boolean, detail?: string): boolean {
  findings.push({ phase: currentPhase, name, ok, detail });
  const mark = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${mark} ${name}${ok || !detail ? '' : `\n       ↳ ${detail}`}`);
  return ok;
}

export function info(msg: string) {
  console.log(`  \x1b[2m·\x1b[0m ${msg}`);
}

export async function shoot(page: Page, tag: string): Promise<string> {
  const file = path.join(ART, `shot-${tag}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
  } catch {
    /* página pode ter morrido */
  }
  return file;
}

/** Roda um cenário isolado: erro não derruba a bateria, vira defeito + foto. */
export async function scenario(name: string, page: Page, fn: () => Promise<void>) {
  console.log(`\n\x1b[36m▶ ${name}\x1b[0m`);
  try {
    await fn();
  } catch (err: any) {
    const shot = await shoot(page, name.replace(/[^\w]+/g, '-').toLowerCase());
    findings.push({
      phase: currentPhase,
      name: `${name} — ERRO NÃO TRATADO`,
      ok: false,
      detail: `${err?.message ?? err}`.split('\n').slice(0, 4).join(' | '),
      shot,
    });
    console.log(`  \x1b[31m✗ ERRO\x1b[0m ${err?.message ?? err}`.split('\n').slice(0, 3).join('\n'));
  }
}

export function report(): number {
  const bad = findings.filter(f => !f.ok);
  console.log(`\n\x1b[1m═══════════════ RESUMO ═══════════════\x1b[0m`);
  const byPhase = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!byPhase.has(f.phase)) byPhase.set(f.phase, []);
    byPhase.get(f.phase)!.push(f);
  }
  for (const [p, fs_] of byPhase) {
    const ok = fs_.filter(f => f.ok).length;
    console.log(`  ${fs_.length - ok === 0 ? '\x1b[32m' : '\x1b[31m'}${ok}/${fs_.length}\x1b[0m  ${p}`);
  }
  console.log(`\n  TOTAL: ${findings.length - bad.length}/${findings.length} passaram`);
  if (bad.length) {
    console.log(`\n\x1b[31m\x1b[1m  ${bad.length} DEFEITO(S):\x1b[0m`);
    bad.forEach((f, i) => {
      console.log(`  ${i + 1}. [${f.phase}] ${f.name}`);
      if (f.detail) console.log(`     ${f.detail}`);
      if (f.shot) console.log(`     foto: ${f.shot}`);
    });
  }
  fs.writeFileSync(path.join(ART, 'findings.json'), JSON.stringify(findings, null, 2));
  return bad.length;
}

/** "R$ 1.234,56" → 1234.56 */
export function brl(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/\s/g, '').match(/R\$?(-?[\d.]+,\d{2})/);
  if (!m) return null;
  return Number(m[1].replace(/\./g, '').replace(',', '.'));
}

export const money = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const near = (a: number, b: number, eps = 0.005) => Math.abs(a - b) < eps;
