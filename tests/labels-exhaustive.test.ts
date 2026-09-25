/**
 * G5 — TODO VALOR DE ENUM TEM RÓTULO EM CADA MAPA, E O CONTRATO EXPORTADO ESTÁ EM DIA.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * Um valor novo em `IMPLEMENT_CATEGORY` ou `IMPLEMENT_TYPE` (a porta do Fase B
 * acrescenta valores) que não ganhe rótulo em algum perfil sai CRU na nota
 * fiscal — "Toco NOVO_TIPO" na prefeitura, irreversível. O tipo
 * `Record<ENUM, string>` já recusa o mapa incompleto em compilação; isto
 * confere em RUNTIME (o `tsc` da api não vê `tests/` nem `scripts/`) e cobre o
 * que o tipo não cobre:
 *
 *   1. cada perfil de `document-labels.ts` rotula TODO valor dos dois enums,
 *      sem sobra e sem texto vazio;
 *   2. os mapas de tela `IMPLEMENT_CATEGORY_LABELS`/`IMPLEMENT_TYPE_LABELS` SÃO o
 *      perfil `screen` (não uma cópia que diverge);
 *   3. todo mapa `X_LABELS` de `enum-labels.ts` cujo enum `X` existe rotula
 *      todos os valores dele;
 *   4. nenhum arquivo de `src/` volta a declarar dicionário próprio de
 *      categoria/implemento (foi assim que nasceram os quatro de antes);
 *   5. `contracts/labels.json` e `contracts/enums.json` são exatamente o que
 *      `scripts/export-contracts.ts` gera hoje (contrato velho reprova).
 *
 * Rodar: `npx tsx tests/labels-exhaustive.test.ts` (sem banco).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { Logger } from '@nestjs/common';
import { IMPLEMENT_TYPE, IMPLEMENT_CATEGORY } from '../src/constants/enums';
import * as ENUMS from '../src/constants/enums';
import * as ENUM_LABELS from '../src/constants/enum-labels';
import {
  IMPLEMENT_TYPE_PROFILE_LABELS,
  LABEL_PROFILES,
  LABEL_PROFILE_READERS,
  CATEGORY_PROFILE_LABELS,
} from '../src/constants/document-labels';
import { buildContracts, CONTRACTS_DIR, serialize } from '../scripts/export-contracts';

Logger.overrideLogger(false);

const ROOT = join(__dirname, '..');
let ok = 0;
let fail = 0;
function check(nome: string, cond: boolean, detalhe = ''): void {
  if (cond) {
    ok++;
    console.log(`  ✓ ${nome}`);
  } else {
    fail++;
    console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

function lacunas(values: string[], map: Readonly<Record<string, string>>): string {
  const faltam = values.filter(v => typeof map[v] !== 'string' || map[v].trim() === '');
  const sobram = Object.keys(map).filter(k => !values.includes(k));
  return [
    faltam.length ? `faltam ${faltam.join(', ')}` : '',
    sobram.length ? `sobram ${sobram.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n1. Cada perfil rotula todo valor de categoria e de implemento');
const categorias = Object.values(IMPLEMENT_CATEGORY) as string[];
const implementos = Object.values(IMPLEMENT_TYPE) as string[];
check('há perfis', LABEL_PROFILES.length >= 5, String(LABEL_PROFILES.length));
for (const perfil of LABEL_PROFILES) {
  const cat = lacunas(categorias, CATEGORY_PROFILE_LABELS[perfil] ?? {});
  check(`IMPLEMENT_CATEGORY × ${perfil}`, cat === '', cat);
  const imp = lacunas(implementos, IMPLEMENT_TYPE_PROFILE_LABELS[perfil] ?? {});
  check(`IMPLEMENT_TYPE × ${perfil}`, imp === '', imp);
  check(`${perfil} diz quem o lê`, Boolean(LABEL_PROFILE_READERS[perfil]?.trim()));
}
check(
  'nenhum perfil sobrando nos mapas',
  Object.keys(CATEGORY_PROFILE_LABELS).every(p => (LABEL_PROFILES as readonly string[]).includes(p)) &&
    Object.keys(IMPLEMENT_TYPE_PROFILE_LABELS).every(p => (LABEL_PROFILES as readonly string[]).includes(p)),
);
check(
  'os perfis são congelados (ninguém reescreve a nota em runtime)',
  LABEL_PROFILES.every(
    p => Object.isFrozen(CATEGORY_PROFILE_LABELS[p]) && Object.isFrozen(IMPLEMENT_TYPE_PROFILE_LABELS[p]),
  ),
);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n2. Os mapas de tela SÃO o perfil screen');
check('IMPLEMENT_CATEGORY_LABELS', ENUM_LABELS.IMPLEMENT_CATEGORY_LABELS === CATEGORY_PROFILE_LABELS.screen);
check('IMPLEMENT_TYPE_LABELS', ENUM_LABELS.IMPLEMENT_TYPE_LABELS === IMPLEMENT_TYPE_PROFILE_LABELS.screen);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n3. Todo mapa X_LABELS rotula todo valor do enum X');
{
  let mapas = 0;
  const problemas: string[] = [];
  for (const [nome, mapa] of Object.entries(ENUM_LABELS)) {
    if (!nome.endsWith('_LABELS') || !mapa || typeof mapa !== 'object') continue;
    const en = (ENUMS as Record<string, unknown>)[nome.slice(0, -'_LABELS'.length)];
    if (!en || typeof en !== 'object') continue;
    // Só enum de TEXTO: o numérico tem o mapa reverso e é rotulado pelo número.
    const valores = Object.values(en as object);
    if (valores.length === 0 || !valores.every(v => typeof v === 'string')) continue;
    mapas++;
    const l = lacunas(valores, mapa as Record<string, string>);
    if (l) problemas.push(`${nome}: ${l}`);
  }
  check(`${mapas} mapas conferidos, nenhum com lacuna`, mapas > 100 && problemas.length === 0, problemas.join(' | '));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n4. Nenhum dicionário de categoria/implemento fora da fonte única');
{
  // Chave de valor de enum (crua ou `[ENUM.X]`) seguida de texto: é assim que
  // um dicionário à mão se parece. Só valores que não existem em outro enum,
  // para não pegar mapas alheios (TRUCK existe em vários contextos).
  const chave = new RegExp(
    String.raw`(\[(IMPLEMENT_CATEGORY|IMPLEMENT_TYPE)\.[A-Z_0-9]+\]|\b(INSULATED|FLATBED|CURTAIN_SIDE|DRY_CARGO|B_DOUBLE_FRONT|B_DOUBLE_REAR|SEMI_TRAILER_2_AXLES|THREE_QUARTER|BITRUCK)\b)\s*:\s*['"\x60]`,
  );
  const permitido = new Set(['src/constants/document-labels.ts']);
  const achados: string[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const full = join(dir, nome);
      if (statSync(full).isDirectory()) andar(full);
      else if (nome.endsWith('.ts')) {
        const rel = relative(ROOT, full);
        if (permitido.has(rel)) continue;
        readFileSync(full, 'utf8')
          .split('\n')
          .forEach((linha, i) => {
            if (chave.test(linha)) achados.push(`${rel}:${i + 1}`);
          });
      }
    }
  };
  andar(join(ROOT, 'src'));
  check('src/ sem dicionário à mão', achados.length === 0, achados.join(', '));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n5. O contrato versionado é o que a API gera hoje');
{
  const contratos = buildContracts();
  for (const [arquivo, conteudo] of [
    ['labels.json', serialize(contratos.labels)],
    ['enums.json', serialize(contratos.enums)],
  ] as const) {
    let versionado = '';
    try {
      versionado = readFileSync(join(CONTRACTS_DIR, arquivo), 'utf8');
    } catch {
      /* ausente = desatualizado */
    }
    check(
      `contracts/${arquivo} em dia`,
      versionado === conteudo,
      'rode: npx tsx scripts/export-contracts.ts (e copie para web/app com --out/--dart)',
    );
  }
  const enums = (contratos.enums as any).enums as Record<string, string[]>;
  check('o contrato traz IMPLEMENT_CATEGORY e IMPLEMENT_TYPE',
    JSON.stringify(enums.IMPLEMENT_CATEGORY) === JSON.stringify(categorias) &&
      JSON.stringify(enums.IMPLEMENT_TYPE) === JSON.stringify(implementos));
  const grafo = (contratos.enums as any).orcamento.transicoesManuais as Record<string, string[]>;
  check('o grafo do orçamento cobre todo status', Object.keys(grafo).length === enums.TASK_QUOTE_STATUS.length,
    Object.keys(grafo).join(', '));
  check('CANCELLED é terminal no grafo exportado', grafo.CANCELLED?.length === 0, JSON.stringify(grafo.CANCELLED));
  const multipart = (contratos.enums as any).multipart as Array<{ rota: string; naoResolvido?: string }>;
  check('toda rota multipart tem os campos resolvidos', multipart.every(m => !m.naoResolvido),
    multipart.filter(m => m.naoResolvido).map(m => m.rota).join(', '));
  check('POST /tasks aceita implementVinPlate', multipart.some(m => m.rota === 'POST /tasks' &&
    (m as any).campos?.some((c: any) => c.nome === 'implementVinPlate')));
}

console.log(`\n${ok} ok, ${fail} falha(s)`);
process.exit(fail > 0 ? 1 : 0);
