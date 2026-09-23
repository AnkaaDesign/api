/**
 * G0 — catraca do tipo (src/ + tests/ + scripts/).
 *
 * Roda `tsc -p tsconfig.check.json` e compara cada erro com a base gravada em
 * `.typecheck-baseline.json`, por ASSINATURA: arquivo + código + mensagem (sem
 * linha nem coluna, para que mexer em outra parte do arquivo não conte como erro
 * novo). A base guarda quantas vezes cada assinatura aparece.
 *
 * Regras:
 *   - erro em `src/` reprova sempre (a base de src/ é ZERO; o build tem
 *     `noEmitOnError: true`);
 *   - assinatura que não está na base, ou que aparece MAIS vezes que na base,
 *     reprova;
 *   - assinatura que sumiu ou caiu passa, e o script avisa para baixar a base
 *     com `--update` (a catraca só desce: `--update` recusa subir qualquer
 *     contagem).
 *
 *   - arquivo NOVO que o tsconfig.check.json deixa de fora (`*.spec.ts`,
 *     `*.test-utils.ts`, `*.example.ts(x)`, `src/scripts/archive/**`) reprova:
 *     erro de tipo ali passaria calado (R-B-14). Os que já existem ficam em
 *     `foraDoTipo` na base, lista que só encolhe. Teste novo é `.test.ts`.
 *
 * Uso:  npx tsx scripts/typecheck-ratchet.ts            (verifica)
 *       npx tsx scripts/typecheck-ratchet.ts --update   (baixa a base)
 *       npx tsx scripts/typecheck-ratchet.ts --init     (grava a primeira base)
 */
import { spawnSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const BASELINE = join(ROOT, '.typecheck-baseline.json');

interface Baseline {
  geradaEm: string;
  total: number;
  assinaturas: Record<string, number>;
  /** arquivos que o tsconfig.check.json exclui e já existiam (só encolhe) */
  foraDoTipo?: string[];
}

/** Os padrões de exclusão do tsconfig.check.json que escondem código NOVO. */
const FORA_DO_TIPO = [/\.spec\.ts$/, /\.test-utils\.ts$/, /\.example\.tsx?$/, /^src\/scripts\/archive\//];

function arquivosForaDoTipo(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const nome = e.name;
      if (nome === 'node_modules' || nome === 'dist' || nome.startsWith('.')) continue;
      const r = `${rel}/${nome}`;
      // link simbólico (artefatos do e2e) não é código: fica de fora
      if (e.isDirectory()) walk(r);
      else if (e.isFile() && /\.tsx?$/.test(nome) && FORA_DO_TIPO.some(p => p.test(r))) out.push(r);
    }
  };
  for (const d of ['src', 'tests', 'scripts']) walk(d);
  return out.sort();
}

function runTsc(): { output: string; status: number | null } {
  const tscBin = join(ROOT, 'node_modules', '.bin', 'tsc');
  const r = spawnSync(tscBin, ['-p', 'tsconfig.check.json', '--pretty', 'false'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { output: `${r.stdout ?? ''}${r.stderr ?? ''}`, status: r.status };
}

/** Uma entrada por erro: `arquivo|TSxxxx|mensagem` (mensagem com as linhas de continuação). */
function parseErrors(output: string): string[] {
  const lines = output.split('\n');
  const errors: string[] = [];
  const head = /^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const m = head.exec(lines[i]);
    if (!m) continue;
    const parts = [m[3].trim()];
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !head.test(lines[i + 1])) {
      parts.push(lines[i + 1].trim());
      i++;
    }
    errors.push(`${m[1].replace(/\\/g, '/')}|${m[2]}|${parts.join(' ')}`);
  }
  return errors;
}

function count(errors: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of errors) out[e] = (out[e] ?? 0) + 1;
  return out;
}

function sortRecord(r: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
}

function main(): void {
  const mode = process.argv.includes('--init')
    ? 'init'
    : process.argv.includes('--update')
      ? 'update'
      : 'check';

  const { output, status } = runTsc();
  const errors = parseErrors(output);
  if (status !== 0 && errors.length === 0) {
    console.error('[typecheck] o tsc falhou sem erro de tipo reconhecível:\n' + output);
    process.exit(2);
  }
  const current = count(errors);
  const srcErrors = errors.filter(e => e.startsWith('src/'));

  if (mode === 'init') {
    if (existsSync(BASELINE)) {
      console.error('[typecheck] a base já existe; use --update (só desce).');
      process.exit(2);
    }
    if (srcErrors.length > 0) {
      console.error(`[typecheck] src/ tem ${srcErrors.length} erro(s); zere antes de gravar a base.`);
      srcErrors.forEach(e => console.error('  ' + e));
      process.exit(1);
    }
    const base: Baseline = {
      geradaEm: new Date().toISOString().slice(0, 10),
      total: errors.length,
      assinaturas: sortRecord(current),
      foraDoTipo: arquivosForaDoTipo(),
    };
    writeFileSync(BASELINE, JSON.stringify(base, null, 2) + '\n');
    console.log(`[typecheck] base gravada: ${errors.length} erro(s) em tests/ e scripts/.`);
    return;
  }

  if (!existsSync(BASELINE)) {
    console.error('[typecheck] falta .typecheck-baseline.json (rode com --init uma vez).');
    process.exit(2);
  }
  const base: Baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

  const novos: string[] = [];
  const caiu: string[] = [];
  for (const [sig, n] of Object.entries(current)) {
    const antes = base.assinaturas[sig] ?? 0;
    if (n > antes) novos.push(`${sig}  (${antes} → ${n})`);
  }
  for (const [sig, antes] of Object.entries(base.assinaturas)) {
    const n = current[sig] ?? 0;
    if (n < antes) caiu.push(`${sig}  (${antes} → ${n})`);
  }

  const fora = arquivosForaDoTipo();
  const conhecidos = new Set(base.foraDoTipo ?? []);
  const foraNovos = base.foraDoTipo ? fora.filter(f => !conhecidos.has(f)) : [];
  const foraSumiram = (base.foraDoTipo ?? []).filter(f => !fora.includes(f));

  const reprovado = srcErrors.length > 0 || novos.length > 0 || foraNovos.length > 0;
  if (foraNovos.length > 0) {
    console.error(
      `[typecheck] ✗ ${foraNovos.length} arquivo(s) NOVO(S) que o tsconfig.check.json não checa ` +
        '(jest não está instalado: teste novo é .test.ts; archive/ não recebe código novo):',
    );
    foraNovos.forEach(f => console.error('  ' + f));
  }
  if (srcErrors.length > 0) {
    console.error(`[typecheck] ✗ src/ tem ${srcErrors.length} erro(s) — src/ não tem base:`);
    srcErrors.forEach(e => console.error('  ' + e));
  }
  if (novos.length > 0) {
    console.error(`[typecheck] ✗ ${novos.length} erro(s) NOVO(S) fora da base:`);
    novos.forEach(e => console.error('  ' + e));
  }

  if (mode === 'update') {
    if (reprovado) {
      console.error('[typecheck] --update recusado: a catraca só desce.');
      process.exit(1);
    }
    const nova: Baseline = {
      geradaEm: new Date().toISOString().slice(0, 10),
      total: errors.length,
      assinaturas: sortRecord(current),
      // primeira vez (base de antes da lista): grava o que existe; depois, só encolhe
      foraDoTipo: fora,
    };
    writeFileSync(BASELINE, JSON.stringify(nova, null, 2) + '\n');
    console.log(`[typecheck] base baixada: ${base.total} → ${errors.length}.`);
    return;
  }

  if (reprovado) process.exit(1);
  console.log(
    `[typecheck] ✓ src/ com 0 erro; tests/+scripts/ com ${errors.length} (base ${base.total}).`,
  );
  if (!base.foraDoTipo) {
    console.log(
      '[typecheck] a base não tem a lista foraDoTipo — grave-a: npm run typecheck:full -- --update',
    );
  }
  if (caiu.length > 0 || foraSumiram.length > 0) {
    console.log(
      `[typecheck] ${caiu.length} assinatura(s) e ${foraSumiram.length} arquivo(s) fora do tipo ` +
        'caíram — baixe a base: npm run typecheck:full -- --update',
    );
  }
}

main();
