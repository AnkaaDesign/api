/**
 * O COTADOR COM A FRENTE (P11b): a quarta face não rouba o nome da traseira.
 *
 * Frente e traseira têm quase a mesma proporção (≈ 240 × 240 cm), e o cotador
 * casa retângulo com medida pela PROPORÇÃO. Numa disputa aberta, a traseira
 * desenhada — a única face de trás em quase todo arquivo de hoje — sairia com o
 * nome e a medida da frente sempre que a frente cadastrada estivesse mais perto
 * do desenho do que a própria traseira. Por isso a frente só disputa o
 * retângulo que SOBROU depois de motorista, sapo e traseira.
 *
 * PDFs vetoriais sintéticos (retângulos em 1:10), gerados aqui; o serviço roda
 * como na API, com o Prisma dublado — o que se prova é o motor.
 *
 *   npx ts-node -r tsconfig-paths/register --transpile-only tests/layout-dimensions-front.test.ts
 */
import { createWriteStream, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LayoutDimensionsService } from '../src/modules/production/layout-dimensions/layout-dimensions.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

let failures = 0;
let passes = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** cm reais → pt no papel, em 1:10. */
const pt = (cm: number) => (cm / 10) * 28.346;

/** Um baú: duas laterais 790 × 252, a traseira 240 × 233 e, opcional, a frente 236 × 240. */
function mkPdf(path: string, withFront: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [2500, 2400], margin: 0 });
    const out = createWriteStream(path);
    out.on('finish', () => resolve());
    out.on('error', reject);
    doc.pipe(out);
    doc.lineWidth(1).strokeColor('#000');
    doc.rect(100, 100, pt(790), pt(252)).stroke();
    doc.rect(100, 900, pt(790), pt(252)).stroke();
    doc.rect(100, 1700, pt(240), pt(233)).stroke();
    if (withFront) doc.rect(1200, 1700, pt(236), pt(240)).stroke();
    doc.end();
  });
}

/** `790x252` → a medida como o banco guarda (metro). */
const face = (raw: string) => {
  const [w, h] = raw.split('x').map(Number);
  return { height: h / 100, sections: [{ width: w / 100, isDoor: false, doorHeight: null }] };
};

async function plan(pdf: string, measures: { left: string; right: string; back: string; front?: string }) {
  const prisma: any = {
    file: {
      findUnique: async () => ({ path: pdf, mimetype: 'application/pdf', filename: 'baú.pdf' }),
    },
    implement: {
      findUnique: async () => ({
        leftSideMeasure: face(measures.left),
        rightSideMeasure: face(measures.right),
        backSideMeasure: face(measures.back),
        frontSideMeasure: measures.front ? face(measures.front) : null,
      }),
    },
  };
  const service = new LayoutDimensionsService(prisma);
  return service.dimensions('file', { implementId: 'implement' });
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'cotador-frente-'));
  const tres = join(dir, 'tres-faces.pdf');
  const quatro = join(dir, 'quatro-faces.pdf');
  await mkPdf(tres, false);
  await mkPdf(quatro, true);
  const sides = (dto: any) => dto.faces.map((f: any) => `${f.side} ${Math.round(f.widthCm)}×${Math.round(f.heightCm)}`);

  console.log('\nSem frente cadastrada — como antes do P11b');
  {
    const dto = await plan(tres, { left: '790x252', right: '790x252', back: '240x233' });
    check(
      'três faces, nos lados de sempre',
      JSON.stringify(sides(dto)) === JSON.stringify(['MOTORISTA 790×252', 'SAPO 790×252', 'TRASEIRA 240×233']),
      JSON.stringify(sides(dto)),
    );
    check('nenhum aviso de contagem', !dto.warnings.some((w: string) => /faces reconhecidas|frente/i.test(w)), JSON.stringify(dto.warnings));
  }

  console.log('\nFrente cadastrada, arquivo SEM a frente (o arquivo de hoje)');
  {
    const dto = await plan(tres, { left: '790x252', right: '790x252', back: '240x233', front: '236x240' });
    check(
      'a traseira desenhada continua TRASEIRA; nenhuma FRENTE inventada',
      JSON.stringify(sides(dto)) === JSON.stringify(['MOTORISTA 790×252', 'SAPO 790×252', 'TRASEIRA 240×233']),
      JSON.stringify(sides(dto)),
    );
    check(
      'o aviso diz o que aconteceu (a frente não está no desenho), não "3 de 4"',
      dto.warnings.includes('A frente tem medida no implemento, mas não está desenhada no arquivo.') &&
        !dto.warnings.some((w: string) => /de 4 faces/.test(w)),
      JSON.stringify(dto.warnings),
    );
  }

  console.log('\nA disputa que a passada única perdia: a frente cadastrada é IGUAL ao desenho da traseira');
  {
    // traseira cadastrada 250 × 233 (4% fora do desenho), frente 240 × 233 (exata)
    const dto = await plan(tres, { left: '790x252', right: '790x252', back: '250x233', front: '240x233' });
    const traseira = dto.faces.find((f: any) => f.side === 'TRASEIRA');
    check(
      'o retângulo de trás fica com a TRASEIRA (e o erro de proporção aparece nela)',
      !!traseira && !dto.faces.some((f: any) => f.side === 'FRENTE') && traseira.aspectErrorPct > 3,
      JSON.stringify(sides(dto)),
    );
  }

  console.log('\nArquivo COM a frente desenhada');
  {
    const dto = await plan(quatro, { left: '790x252', right: '790x252', back: '240x233', front: '236x240' });
    check(
      'as quatro faces, cada uma com a sua medida',
      JSON.stringify(sides(dto)) ===
        JSON.stringify(['MOTORISTA 790×252', 'SAPO 790×252', 'TRASEIRA 240×233', 'FRENTE 236×240']),
      JSON.stringify(sides(dto)),
    );
  }
}

main()
  .then(() => {
    console.log(
      failures === 0
        ? `\n✅ cotador com a frente: ${passes} verificações passaram.\n`
        : `\n❌ ${failures} verificação(ões) falharam (${passes} passaram).\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ O teste estourou:', err?.stack ?? err);
    process.exit(1);
  });
