/**
 * G3 → G4 — lê o log do censo (`[CENSO] {…}`) e gera `contracts/queries/censo.json`,
 * a fixture com as formas que os clientes REALMENTE mandaram (inclusive o app
 * instalado e o `AnkaaAero`, que nenhum extrator de código enxerga).
 *
 * A consulta é remontada dos CAMINHOS (o censo não guarda valor): include/select
 * viram `true`, orderBy `'asc'`, e a folha de `where` ganha um valor sintético do
 * tipo do campo (ver `src/modules/common/census/census-fixture.ts`). A rota só
 * vira forma do G4 quando alguma fixture já mapeou rota → modelo + schema zod;
 * as outras saem em `semSchema`, para alguém registrar o schema no G4. Os corpos
 * (POST/PUT/PATCH) saem em `corpos`: o G4 não os lê, são a entrada do tradutor
 * do P11a.
 *
 * Uso (o log vem do servidor; este script não faz ssh):
 *   journalctl -u ankaa-api --since '14 days ago' -o cat > censo.log
 *   npx tsx scripts/census-to-fixture.ts censo.log            grava contracts/queries/censo.json
 *   npx tsx scripts/census-to-fixture.ts censo.log --resumo   só conta, não grava
 *   cat censo.log | npx tsx scripts/census-to-fixture.ts -    lê da entrada padrão
 *   … --saida <arquivo>                                       grava em outro lugar
 *
 * Depois de gravar: `npm run test:query-contract` (G4) julga cada forma — o que
 * reprovar ali é exatamente o que um cliente instalado manda e a API não aceita.
 */
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  buildCensusFixture,
  parseCensusLine,
  type RouteSchema,
} from '../src/modules/common/census/census-fixture';
import type { CensusShape } from '../src/modules/common/census/census-shape';

const ROOT = join(__dirname, '..');
const QUERIES_DIR = join(ROOT, 'contracts/queries');
const OUTPUT_NAME = 'censo.json';

/** rota → modelo + schema, das fixtures que já existem (menos negativas e o próprio censo). */
export function routeSchemasFromFixtures(dir = QUERIES_DIR): Map<string, RouteSchema> {
  const out = new Map<string, RouteSchema>();
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.json') || f === 'negativas.json' || f === OUTPUT_NAME) continue;
    const json = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
      formas?: { rota?: string; modelo?: string; schema?: string }[];
    };
    for (const forma of json.formas ?? []) {
      if (forma.rota && forma.modelo && forma.schema && !out.has(forma.rota)) {
        out.set(forma.rota, { modelo: forma.modelo, schema: forma.schema });
      }
    }
  }
  return out;
}

function main(): void {
  const args = process.argv.slice(2);
  const resumo = args.includes('--resumo');
  const saidaIdx = args.indexOf('--saida');
  const saida = saidaIdx >= 0 ? args[saidaIdx + 1] : join(QUERIES_DIR, OUTPUT_NAME);
  const posicionais = args.filter(
    (a, i) => !a.startsWith('--') && (saidaIdx < 0 || i !== saidaIdx + 1),
  );
  const entrada = posicionais[0];
  if (!entrada || posicionais.length > 1 || !saida) {
    console.error(
      'uso: npx tsx scripts/census-to-fixture.ts <log|-> [--resumo] [--saida <arquivo>]',
    );
    process.exit(2);
  }

  const texto = readFileSync(entrada === '-' ? 0 : entrada, 'utf8');
  const shapes: CensusShape[] = [];
  let ilegiveis = 0;
  for (const line of texto.split('\n')) {
    if (!line.includes('[CENSO]')) continue;
    const s = parseCensusLine(line);
    if (s) shapes.push(s);
    else ilegiveis++;
  }

  const fixture = buildCensusFixture(shapes, routeSchemasFromFixtures());
  console.log(
    `censo: ${shapes.length} linha(s) lida(s)${ilegiveis ? `, ${ilegiveis} ilegível(is)` : ''}; ` +
      `${fixture.formas.length} forma(s) de consulta para o G4, ${fixture.semSchema.length} sem schema, ` +
      `${fixture.corpos.length} corpo(s)${fixture.transbordou ? '; ⚠ algum processo passou do teto (balde (outros))' : ''}`,
  );
  for (const s of fixture.semSchema)
    console.log(`  sem schema: ${s.rota} ← ${s.clientes.join('; ')}`);
  if (resumo) return;
  writeFileSync(saida, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`gravado: ${saida}`);
}

if (require.main === module) main();
