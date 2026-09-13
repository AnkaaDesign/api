/**
 * A ESTRUTURA DO DOSSIÊ — identificação, numeração e navegação.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O dossiê de um orçamento de quatro veículos é o orçamento (quatro folhas), as
 * fotos, quatro boletos e quatro notas: passa de quinze páginas. Elas eram
 * concatenadas sem nada que dissesse de que dossiê são, em que componente o
 * leitor está, ou quantas folhas existem — uma folha solta não provava nada e a
 * falta de uma página no meio era indetectável.
 *
 * O carimbo vai SÓ nas folhas que este servidor desenhou. Boleto e NFS-e são
 * documentos de TERCEIROS (decisão 2 do montador): escrever no pé deles seria
 * alterar documento alheio dentro do nosso invólucro, e a margem inferior de um
 * boleto não é nossa para usar. Eles aparecem nos MARCADORES, que não tocam no
 * conteúdo da página.
 *
 * Este arquivo exercita os DOIS passos contra um PDF de verdade — montar o
 * container, carimbar, montar o outline e reler os bytes —, porque `tsc` limpo
 * não prova nada sobre o que saiu no papel: o texto vira string HEXADECIMAL
 * dentro de um stream comprimido, e o outline é um dicionário montado à mão.
 *
 *   npm run test:dossier-structure
 */

import { PDFDocument, PDFName, PDFDict, StandardFonts, rgb } from 'pdf-lib';
import { inflateSync } from 'zlib';
import { DossierAssemblerService } from '../src/modules/common/signature/dossier/dossier-assembler.service';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * O texto desenhado, por página.
 *
 * Duas camadas entre o texto e o arquivo: o content stream é gravado COMPRIMIDO
 * (Flate) e, dentro dele, o pdf-lib escreve o texto como string HEXADECIMAL
 * (`<50E167696E61> Tj`), não como literal. Procurar "Página" no arquivo cru acha
 * zero com o carimbo funcionando — foi assim que o primeiro detector mentiu.
 */
function drawnTextPerPage(pdf: Uint8Array): string[] {
  const raw = Buffer.from(pdf);
  const flat = raw.toString('latin1');
  const texts: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) {
    const start = m.index + m[0].length;
    const end = flat.indexOf('endstream', start);
    if (end < 0) continue;
    let content: string;
    try {
      content = inflateSync(raw.subarray(start, end)).toString('latin1');
    } catch {
      continue;
    }
    const decoded = (content.match(/<([0-9A-Fa-f]+)>/g) ?? [])
      .map(h => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
      .join(' ');
    if (decoded.trim()) texts.push(decoded);
  }
  return texts;
}

/** Uma "página de terceiro": conteúdo já desenhado, que o carimbo não pode tocar. */
async function pdfWithPages(count: number, marker: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`${marker} ${i + 1}`, { x: 60, y: 400, size: 12, font, color: rgb(0, 0, 0) });
  }
  return doc.save({ useObjectStreams: false });
}

async function main() {
  // Os dois métodos só falam com pdf-lib: nenhum serviço injetado é tocado, e
  // um montador sem dependências basta. Isto roda sem banco e sem navegador —
  // que é o que o faz caber num pre-push.
  const assembler = new DossierAssemblerService(
    null as never, null as never, null as never, null as never, null as never,
    null as never, null as never, null as never, null as never, null as never,
  );
  const stamp = (c: any, n: number, p: any) =>
    (assembler as any).stampDossierPages(c, n, p) as Promise<void>;
  const outline = (c: any, p: any) => (assembler as any).addOutline(c, p) as void;

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nUm dossiê de quatro componentes: o que é nosso leva carimbo');
  // ═══════════════════════════════════════════════════════════════════════════
  const container = await PDFDocument.create();
  const parts = [
    { kind: 'ORCAMENTO', label: 'Orçamento nº 0976', pages: 4, ours: true },
    { kind: 'FOTOS', label: 'Dossiê fotográfico', pages: 2, ours: true },
    { kind: 'BOLETO', label: 'Boleto 1/4', pages: 1, ours: false },
    { kind: 'NFSE', label: 'NFS-e 12345', pages: 1, ours: false },
  ];
  const placed: Array<{ component: any; firstPage: number; ours: boolean }> = [];
  for (const part of parts) {
    const firstPage = container.getPageCount();
    const src = await PDFDocument.load(await pdfWithPages(part.pages, part.kind));
    const copied = await container.copyPages(src, src.getPageIndices());
    copied.forEach(p => container.addPage(p));
    placed.push({
      component: { kind: part.kind, label: part.label, pages: part.pages },
      firstPage,
      ours: part.ours,
    });
  }

  const total = container.getPageCount();
  check('o dossiê tem oito páginas', total === 8, String(total));

  await stamp(container, 976, placed);
  outline(container, placed);
  const bytes = await container.save({ useObjectStreams: false });
  const texts = drawnTextPerPage(bytes);

  const stamped = texts.filter(t => /gina \d+ de \d+/.test(t));
  check(
    'seis folhas nossas levam o carimbo (orçamento + fotos)',
    stamped.length === 6,
    String(stamped.length),
  );
  check(
    'a contagem é a do DOSSIÊ inteiro, não a do componente',
    stamped.every(t => t.includes('de 8')),
    stamped[0],
  );
  check(
    'o carimbo nomeia o componente',
    stamped.some(t => t.includes('Or')) && stamped.some(t => t.includes('fotogr')),
  );
  check('o carimbo cita o nº do orçamento', stamped.every(t => t.includes('0976')), stamped[0]);

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nA folha de terceiro fica intacta');
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Boleto e NFS-e são documentos de outra pessoa. Que eles apareçam no dossiê
  // não nos dá licença de escrever neles.
  const thirdParty = texts.filter(t => /BOLETO|NFSE/.test(t));
  check('as duas folhas de terceiro continuam lá', thirdParty.length === 2, String(thirdParty.length));
  check(
    'e NENHUMA delas foi carimbada',
    thirdParty.every(t => !/gina \d+ de \d+/.test(t)),
    JSON.stringify(thirdParty),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nOs marcadores dão a navegação que a capa não dá');
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // A decisão 4 do montador recusou a CAPA, e com razão: o que o cliente recebe
  // é orçamento, fotos, nota e boleto, não um sumário administrativo. Marcador é
  // invisível até ser usado, não custa uma folha, e é como se navega vinte
  // páginas num leitor de celular.
  const reread = await PDFDocument.load(bytes);
  const outlinesRef = reread.catalog.get(PDFName.of('Outlines'));
  check('o catálogo aponta para /Outlines', !!outlinesRef);
  const outlines = outlinesRef ? reread.context.lookup(outlinesRef, PDFDict) : null;
  check(
    'há um marcador por componente',
    Number(outlines?.get(PDFName.of('Count'))?.toString() ?? 0) === 4,
    outlines?.get(PDFName.of('Count'))?.toString(),
  );
  check('a lista encadeada tem começo e fim', !!outlines?.get(PDFName.of('First')) && !!outlines?.get(PDFName.of('Last')));

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nUm dossiê de uma folha não leva numeração nem marcador');
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // "Página 1 de 1" é ruído, e um componente só não tem o que navegar.
  const single = await PDFDocument.create();
  const src = await PDFDocument.load(await pdfWithPages(1, 'ORCAMENTO'));
  const copied = await single.copyPages(src, src.getPageIndices());
  copied.forEach(p => single.addPage(p));
  const solo = [{ component: { kind: 'ORCAMENTO', label: 'Orçamento', pages: 1 }, firstPage: 0, ours: true }];
  await stamp(single, 976, solo);
  outline(single, solo);
  const singleBytes = await single.save({ useObjectStreams: false });
  check(
    'sem numeração',
    !drawnTextPerPage(singleBytes).some(t => /gina \d+ de \d+/.test(t)),
  );
  check(
    'sem marcadores',
    !(await PDFDocument.load(singleBytes)).catalog.get(PDFName.of('Outlines')),
  );
}

main()
  .then(() => {
    console.log(
      failures === 0
        ? '\n✅ Estrutura do dossiê: todas as verificações passaram.\n'
        : `\n❌ ${failures} verificação(ões) falharam.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ O teste estourou:', err?.message ?? err);
    process.exit(1);
  });
