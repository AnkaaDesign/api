/**
 * Prova de fogo do cotador do lado do servidor.
 *
 * Roda `LayoutDimensionsService` exatamente como o Nest vai rodar — CommonJS,
 * import dinâmico do pdf.js (que só publica ESM), canvas nativo do
 * `@napi-rs/canvas` — contra um PDF de verdade. O Prisma é dublê: o que se
 * prova aqui é o caminho do MOTOR, não o banco.
 *
 * É o teste que pega o defeito mais traiçoeiro desta integração: se o import do
 * canvas falhar, `createPageInkTrimmer` devolve `undefined` e o agrupamento
 * volta a decidir pela moldura declarada da imagem — sem erro nenhum, só cota
 * ancorada no vazio. Por isso a saída imprime o recorte de tinta como um item
 * do relatório, e não como um detalhe.
 *
 * ```sh
 * cd api
 * npx ts-node -r tsconfig-paths/register --transpile-only \
 *   scripts/check-layout-dimensions.ts ~/layouts/ALGUM.pdf 790x252 790x252 240x233
 * ```
 *
 * As medidas vão em CENTÍMETRO, uma por face, na ordem em que elas aparecem na
 * página (de cima para baixo). Elas importam de verdade: o cotador casa cada
 * retângulo do desenho com uma medida pela PROPORÇÃO, e uma lateral de 790×252
 * confrontada com o desenho de um baú de 1514×280 simplesmente não casa —
 * a saída correta ali é "nenhuma face foi reconhecida", que é resposta e não
 * defeito.
 */

import { LayoutDimensionsService } from '../src/modules/production/layout-dimensions/layout-dimensions.service';

const pdf = process.argv[2];
if (!pdf) {
  console.error(
    'uso: check-layout-dimensions.ts <arquivo.pdf> [larguraXaltura em cm, uma por face]',
  );
  process.exit(1);
}

/** `790x252` → uma face de 7,90 m × 2,52 m, em metro como o banco guarda. */
function parseFace(raw: string): { height: number; sections: { width: number; isDoor: boolean; doorHeight: null }[] } | null {
  const m = /^(\d+(?:\.\d+)?)[xX](\d+(?:\.\d+)?)$/.exec(raw);
  if (!m) return null;
  return {
    height: Number(m[2]) / 100,
    sections: [{ width: Number(m[1]) / 100, isDoor: false, doorHeight: null }],
  };
}

const faces = process.argv.slice(3).map(parseFace).filter(f => f !== null);
if (process.argv.length > 3 && faces.length !== process.argv.length - 3) {
  console.error('medida inválida: use larguraXaltura em cm, por exemplo 790x252');
  process.exit(1);
}
// Sem medidas na linha de comando, vale um baú comum: 7,90 × 2,52 nas laterais
// e 2,40 × 2,33 na traseira.
const fallback = [parseFace('790x252')!, parseFace('790x252')!, parseFace('240x233')!];
const [left, right, back] = faces.length ? [...faces, null, null].slice(0, 3) : fallback;

const fakePrisma = {
  file: {
    findUnique: async () => ({
      path: pdf,
      mimetype: 'application/pdf',
      filename: pdf.split('/').pop(),
    }),
  },
  truck: {
    findUnique: async () => ({
      leftSideMeasure: left,
      rightSideMeasure: right,
      backSideMeasure: back,
    }),
  },
};

async function main(): Promise<void> {
  const service = new LayoutDimensionsService(fakePrisma as never);

  // Duas chamadas, e as duas contam. A PRIMEIRA carrega o pdf.js (que só
  // publica ESM e entra por import dinâmico) e sobe o canvas nativo — é o custo
  // do primeiro pedido depois de um deploy, e só dele. A SEGUNDA é o que a API
  // paga em regime, e é a que se compara com os 62 ms de mediana do acervo.
  const coldAt = Date.now();
  await service.dimensions('file-id', { truckId: 'truck-id' });
  const cold = Date.now() - coldAt;

  const startedAt = Date.now();
  const dto = await service.dimensions('file-id', { truckId: 'truck-id' });
  const ms = Date.now() - startedAt;
  const bytes = Buffer.byteLength(JSON.stringify(dto));

  console.log(`plano em ${ms} ms (1ª chamada ${cold} ms) · payload ${(bytes / 1024).toFixed(0)} KB`);
  console.log(
    `  página ${dto.pageWidthPt.toFixed(0)} × ${dto.pageHeightPt.toFixed(0)} pt · escala ${dto.detectedScale.source}`,
  );
  console.log(
    `  faces ${dto.faces.length} · itens ${dto.items.length} · cotas ${dto.dimensions.length} · avisos ${dto.warnings.length}`,
  );
  for (const f of dto.faces) {
    const own = dto.items.filter(i => i.faceIndex === f.index).length;
    console.log(
      `    ${f.side.padEnd(10)} ${f.widthCm.toFixed(0)}×${f.heightCm.toFixed(0)} cm` +
        ` · proporção ${f.aspectErrorPct.toFixed(2)}% · ${own} itens${f.unusable ? ` · ${f.unusable}` : ''}`,
    );
  }
  for (const w of dto.warnings) console.log(`    ⚠ ${w}`);

  const outline = Math.max(
    0,
    ...dto.items.map(i => (i.outlinePt ?? []).reduce((n, p) => n + p.length, 0)),
  );
  console.log(`  maior contorno enviado: ${outline} pontos (orçamento 3.000)`);

  const snapStart = Date.now();
  const snap = await service.snapSegments('file-id');
  console.log(
    `  /snap: ${snap.segments.length / 4} de ${snap.totalSegments} segmentos` +
      ` · ${(Buffer.byteLength(JSON.stringify(snap)) / 1024).toFixed(0)} KB` +
      ` em ${Date.now() - snapStart} ms`,
  );
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('FALHOU:', error?.message ?? error);
    process.exit(1);
  });
