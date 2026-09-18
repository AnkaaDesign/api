/**
 * A FOLHA NÃO SE DESPERDIÇA, E O PÉ DELA NÃO SE SOBREPÕE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * OS TRÊS DEFEITOS QUE ESTE ARQUIVO IMPEDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Medidos no dossiê do orçamento nº 0984 — quinze páginas, das quais quatro
 * eram repetição e duas estavam 85% em branco.
 *
 * 1. A CLÁUSULA DE ACEITAÇÃO PULAVA DE FOLHA SOZINHA. `buildAuditPages` tinha
 *    guardas tudo-ou-nada (`if (doc.y > 660) doc.addPage()`): passando do
 *    limiar, o bloco INTEIRO ia para uma folha nova, mesmo com cem pontos
 *    livres logo abaixo do log. Texto corrido não precisa disso — o PDFKit
 *    pagina parágrafo sozinho —, e o que sobrava era uma folha com oito linhas.
 *
 * 2. O CARIMBO DO DOSSIÊ CAÍA EM CIMA DO RODAPÉ DO ASSINADO. O montador do
 *    documento escreve a faixa de verificação a 12pt da borda; o dossiê
 *    carimbava "Página N de M" a 5mm = 14,17pt. Duas linhas a 2,17pt uma da
 *    outra saem ilegíveis, e foi o que o cliente recebeu.
 *
 *    ⚠️ Este é o MESMO defeito que `quote-renderer.service.ts` já tinha
 *    corrigido uma vez (orçamento nº 0594), por outro caminho. Por isso existe
 *    uma verificação, e não só um comentário.
 *
 * 3. A TRILHA CONGELADA ENTRAVA DUAS VEZES. O dossiê copiava o artefato selado
 *    INTEIRO — corpo mais a trilha que o `finalize` fundiu a ele — e ainda
 *    fechava com a trilha consolidada. Num envelope de dois recortes, o mesmo
 *    log de 31 eventos saía três vezes, com hashes idênticos.
 *
 * Nada aqui toca banco nem navegador: os três exercícios são PDF contra PDF, e
 * é o que os faz caber num pre-push.
 *
 *   npm run test:dossier-paginacao
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { inflateSync } from 'zlib';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DossierAssemblerService } from '../src/modules/common/signature/dossier/dossier-assembler.service';
import { QuoteAssemblerService } from '../src/modules/common/signature/document/quote-assembler.service';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Uma linha desenhada: o texto e a linha de base onde ele pousou. */
interface DrawnLine {
  text: string;
  y: number;
}

/**
 * O texto desenhado COM A ALTURA, um grupo por content stream.
 *
 * Sem a altura não dá para provar nada sobre sobreposição nem sobre folha
 * desperdiçada — as duas perguntas são geométricas, e um detector que só lê
 * strings responde "o texto está lá" para um rodapé impresso por cima de outro.
 *
 * Quatro camadas entre o texto e o arquivo, e as quatro mentem para quem
 * procura ingenuamente:
 *
 *  · uns streams são gravados COMPRIMIDOS (Flate) e outros não — o pdf-lib
 *    preserva o filtro do que COPIOU e escreve CRU o que desenhou depois, então
 *    um detector que só inflate perde exatamente o carimbo que veio verificar;
 *  · o texto é HEXADECIMAL, nunca literal — `<50E167696E61> Tj` no pdf-lib,
 *    `[<54> 80 <72696c6861>] TJ` no PDFKit, que intercala o kerning;
 *  · o PDFKit desenha sob uma CTM invertida (`1 0 0 -1 0 841.89 cm`) aplicada
 *    DUAS vezes — no stream e em cada bloco de texto —, de modo que as duas se
 *    anulam e o `y` do `Tm` já é a altura final em pontos PDF;
 *  · UM STREAM NÃO É UMA PÁGINA. No PDFKit é (um por folha), e por isso a
 *    trilha se lê assim. No pdf-lib, desenhar sobre uma página copiada
 *    ACRESCENTA um segundo stream a ela — daí o `getPageCount()` continuar
 *    sendo a única autoridade sobre quantas folhas existem.
 */
function drawnLinesPerStream(pdf: Buffer): DrawnLine[][] {
  const flat = pdf.toString('latin1');
  const pages: DrawnLine[][] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) {
    const start = m.index + m[0].length;
    const end = flat.indexOf('endstream', start);
    if (end < 0) continue;
    const raw = pdf.subarray(start, end);
    let content: string;
    try {
      content = inflateSync(raw).toString('latin1');
    } catch {
      content = raw.toString('latin1'); // gravado sem filtro
    }
    if (!content.includes('BT')) continue; // não é um fluxo de conteúdo
    const lines: DrawnLine[] = [];
    // `Tm` fixa a matriz de texto; o `y` dela é a linha de base. O texto que
    // vem depois pertence a ela até o próximo `Tm`.
    const blocks = content.split(/1 0 0 1 /).slice(1);
    for (const block of blocks) {
      const head = /^([\d.-]+) ([\d.-]+) Tm/.exec(block);
      if (!head) continue;
      const y = Number(head[2]);
      const body = block.slice(0, block.indexOf('ET') >= 0 ? block.indexOf('ET') : undefined);
      const text = (body.match(/<([0-9A-Fa-f]+)>/g) ?? [])
        .map(h => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
        .join('');
      if (text.trim()) lines.push({ text, y });
    }
    if (lines.length) pages.push(lines);
  }
  return pages;
}

/** Todas as linhas do arquivo, sem agrupar — para quando a folha vem do `getPageCount()`. */
function drawnLines(pdf: Buffer): DrawnLine[] {
  return drawnLinesPerStream(pdf).flat();
}

/** Entrada mínima e realista para a trilha de um recorte assinado. */
function trailInput(eventCount: number, originalPdf: Buffer) {
  return {
    originalPdf,
    anchors: {} as never,
    // Dois signatários e um rótulo de recorte: exatamente a forma do envelope
    // nº 0984, que é onde a folha em branco apareceu.
    signers: [
      {
        id: 's1',
        name: 'Kennedy Campos',
        cargo: 'Comercial',
        companyLabel: '53.842.320 Kennedy de Campos Teixeira',
        cpf: '11516167961',
        phone: '5543999992403',
        signedAt: new Date('2026-09-18T11:18:48Z'),
        status: 'SIGNED',
        authMethodLabel: 'Codigo de uso unico via WhatsApp',
        ipAddress: '189.127.225.35',
        side: 'CUSTOMER' as const,
      },
      {
        id: 's2',
        name: 'Sergio Rodrigues',
        cargo: 'Diretor Comercial',
        companyLabel: 'Ankaa Design',
        cpf: '06856214995',
        phone: '5543999993228',
        signedAt: new Date('2026-09-18T11:19:29Z'),
        status: 'SIGNED',
        authMethodLabel: 'Sessao autenticada Ankaa',
        ipAddress: '189.127.225.35',
        side: 'ANKAA' as const,
      },
    ],
    events: Array.from({ length: eventCount }, (_, i) => ({
      sequence: i,
      occurredAt: new Date('2026-09-18T11:18:48Z'),
      description: 'Documento visualizado',
      ipAddress: '189.127.225.35',
      hash: (i % 16).toString(16).repeat(64),
    })),
    budgetNumber: 984,
    envelopeId: 'c5fcb57d-6b15-4fb3-abf5-29be8bb3e816',
    verificationCode: 'N99M-57NX-FHX0',
    verificationUrl: 'https://ankaadesign.com.br/v/N99M-57NX-FHX0',
    originalSha256: 'b'.repeat(64),
    chainTip: 'c'.repeat(64),
    variantLabel: 'Documento completo',
    acceptanceClause:
      'ACEITACAO DO MEIO ELETRONICO. As partes reconhecem e aceitam, para todos os fins do art. 10, ' +
      'paragrafo 2, da Medida Provisoria no 2.200-2/2001, a assinatura eletronica deste orcamento ' +
      'por meio da plataforma da CONTRATADA, mediante autenticacao do CONTRATANTE por codigo de uso ' +
      'unico enviado por WhatsApp ao numero de telefone celular cadastrado do signatario, ' +
      'autenticacao da CONTRATADA em sessao identificada de sua propria plataforma, e registro de ' +
      'trilha de auditoria, admitindo tal metodo como meio valido de comprovacao de autoria e ' +
      'integridade, com os mesmos efeitos da assinatura manuscrita.',
  };
}

/** Uma folha de conteúdo qualquer, para os exercícios de cópia. */
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
  const quoteAssembler = new QuoteAssemblerService();
  const dossierAssembler = new DossierAssemblerService(
    null as never, null as never, null as never, null as never, null as never,
    null as never, null as never, null as never, null as never, null as never,
  );
  const stamp = (c: any, n: number, p: any) =>
    (dossierAssembler as any).stampDossierPages(c, n, p) as Promise<void>;
  const append = (c: any, b: Buffer, comp: any, max?: number) =>
    (dossierAssembler as any).appendPdf(c, b, comp, max) as Promise<number>;

  const blank = await PDFDocument.create();
  blank.addPage([595.28, 841.89]);
  const blankBytes = Buffer.from(await blank.save());

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nA cláusula de aceitação não gasta uma folha para nada');
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // A margem inferior de `buildAuditPages` é 40pt, então a caixa de texto vai
  // até `841,89 − 40 = 801,89`. "Sobrou espaço" é a distância entre a última
  // linha da folha anterior e esse piso.
  //
  // A regra que se verifica: a cláusula SÓ pode abrir folha nova quando o que
  // restava na anterior não comportava o título mais as primeiras linhas dela
  // (42pt). Varrendo o nº de eventos, uma das contagens cai exatamente na
  // janela em que o limiar antigo (660) errava — não se sabe qual, e é por isso
  // que se varre em vez de fixar um caso.
  const CONTENT_BOTTOM = 841.89 - 40;
  // 55 e não 42, e a diferença é honesta: a guarda do código mede o CURSOR
  // (`doc.y`, o topo da próxima linha) e aqui só se enxerga a LINHA DE BASE da
  // última linha impressa, que fica ~10pt acima do cursor. O que se afirma,
  // então, é "não sobrou meia folha", não "não sobrou um ponto" — e é o
  // suficiente: o defeito que isto persegue desperdiçava mais de cem pontos.
  const RESERVA_MEDIDA = 55;
  let piorDesperdicio = 0;
  let piorCaso = '';
  let violacoes = 0;
  let houveOrfa = false;

  for (let n = 4; n <= 40; n++) {
    const pdf = await quoteAssembler.buildAuditPages(trailInput(n, blankBytes) as never);
    const pages = drawnLinesPerStream(pdf);
    const idx = pages.findIndex(p => p.some(l => l.text.includes('Aceitacao do meio eletronico')));
    if (idx <= 0) continue; // cláusula na primeira folha: nada a desperdiçar

    const anterior = pages[idx - 1];
    const temEvento = pages[idx].some(l => /^\d{3} {2}\d{2}\/\d{2}\/\d{4}/.test(l.text));
    if (temEvento) continue; // a cláusula dividiu a folha com o log — é o certo

    houveOrfa = true;
    const ultimaLinha = Math.min(...anterior.map(l => l.y));
    const sobrou = CONTENT_BOTTOM - (841.89 - ultimaLinha);
    if (sobrou > piorDesperdicio) {
      piorDesperdicio = sobrou;
      piorCaso = `${n} eventos`;
    }
    if (sobrou > RESERVA_MEDIDA) violacoes++;
  }

  check(
    'nenhuma folha vira com espaço de sobra para a cláusula',
    violacoes === 0,
    `${violacoes} caso(s); pior sobra ${piorDesperdicio.toFixed(1)}pt em ${piorCaso}`,
  );
  check(
    'a varredura realmente encontrou casos de quebra (o teste não passou por vacuidade)',
    houveOrfa,
    'nenhuma contagem de eventos empurrou a cláusula para folha nova',
  );

  // O caso MEDIDO: 23 eventos, dois signatários, recorte rotulado — a forma
  // exata do envelope nº 0984, que saiu com uma folha 85% em branco.
  const pdf0984 = await quoteAssembler.buildAuditPages(trailInput(23, blankBytes) as never);
  const pages0984 = drawnLinesPerStream(pdf0984);
  const idx0984 = pages0984.findIndex(p =>
    p.some(l => l.text.includes('Aceitacao do meio eletronico')),
  );
  check(
    'na forma do orçamento nº 0984 a cláusula divide a folha com o log',
    idx0984 >= 0 &&
      pages0984[idx0984].some(l => /^\d{3} {2}\d{2}\/\d{2}\/\d{4}/.test(l.text)),
    `cláusula na folha ${idx0984 + 1} de ${pages0984.length}`,
  );
  check(
    'e o rodapé jurídico sai junto, sem terceira folha',
    pages0984.some(p => p.some(l => l.text.includes('CNPJ'))),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nO carimbo do dossiê não pousa sobre o rodapé do assinado');
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // A faixa de verificação é reproduzida aqui com a MESMA altura e o MESMO
  // corpo do montador (`quote-assembler.service.ts`: `y: 12`, `size: 6`). Se
  // alguém mudar um dos dois lados sem olhar o outro, é esta verificação que
  // avisa — não o `tsc`, que não sabe onde a tinta cai.
  const assinado = await PDFDocument.create();
  {
    const font = await assinado.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 2; i++) {
      const page = assinado.addPage([595.28, 841.89]);
      page.drawText(
        `Orcamento no 984 - Envelope N99M-57NX-FHX0 - SHA-256 5af39b8a... - pag. ${i + 1}/2`,
        { x: 90, y: 12, size: 6, font, color: rgb(0.45, 0.45, 0.45) },
      );
    }
  }
  const container = await PDFDocument.create();
  const copiadas = await container.copyPages(assinado, assinado.getPageIndices());
  copiadas.forEach(p => container.addPage(p));
  await stamp(container, 984, [
    {
      component: { kind: 'ORCAMENTO_ASSINADO', label: 'Orçamento assinado', pages: 2 },
      firstPage: 0,
      ours: true,
    },
  ]);
  const carimbado = Buffer.from(await container.save({ useObjectStreams: false }));
  const linhas = drawnLines(carimbado);

  check(
    'as duas folhas do assinado continuam lá',
    container.getPageCount() === 2,
    String(container.getPageCount()),
  );

  const faixa = linhas.find(l => l.text.includes('pag. 1/2'));
  const carimbo = linhas.find(l => /gina 1 de 2/.test(l.text));
  check('a faixa de verificação do documento continua impressa', !!faixa, faixa?.text);
  check('o carimbo do dossiê também', !!carimbo, carimbo?.text);
  check(
    'e eles NÃO se sobrepõem — o carimbo fica acima da faixa',
    !!faixa && !!carimbo && carimbo.y - faixa.y >= 6,
    faixa && carimbo
      ? `faixa y=${faixa.y}, carimbo y=${carimbo.y}, distância ${(carimbo.y - faixa.y).toFixed(2)}pt`
      : 'uma das duas não foi desenhada',
  );
  check(
    'o carimbo continua dentro da margem inferior de toda folha nossa (25mm = 70,9pt)',
    !!carimbo && carimbo.y < 70.9,
    carimbo ? `y=${carimbo.y}` : undefined,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nO recorte selado entra pelo CORPO, sem a trilha congelada');
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // O artefato final é `congelado + selos + trilha`: `stampSeals` desenha sobre
  // as páginas do congelado e não cria nenhuma, e a trilha vai no FIM. Logo o nº
  // de folhas do congelado é o corte — e é ele que `bodyPageCount` mede.
  const selado = await PDFDocument.create();
  {
    const corpo = await PDFDocument.load(await pdfWithPages(2, 'CORPO'));
    const trilha = await PDFDocument.load(await pdfWithPages(2, 'TRILHA-CONGELADA'));
    for (const src of [corpo, trilha]) {
      const cp = await selado.copyPages(src, src.getPageIndices());
      cp.forEach(p => selado.addPage(p));
    }
  }
  const seladoBytes = Buffer.from(await selado.save({ useObjectStreams: false }));

  const soCorpo = await PDFDocument.create();
  const comp: any = { kind: 'ORCAMENTO_ASSINADO', label: 'assinado', pages: 0, included: true };
  const copiou = await append(soCorpo, seladoBytes, comp, 2);
  const textoCorpo = drawnLines(Buffer.from(await soCorpo.save({ useObjectStreams: false })));
  check('copiou só as duas folhas do corpo', copiou === 2, String(copiou));
  check(
    'e a trilha congelada ficou de fora das páginas',
    !textoCorpo.some(l => l.text.includes('TRILHA-CONGELADA')),
    JSON.stringify(textoCorpo.map(l => l.text)),
  );
  check(
    'o corpo, esse, entrou inteiro',
    textoCorpo.filter(l => l.text.includes('CORPO')).length === 2,
  );

  // Sem corte, o arquivo inteiro — é o recuo para o envelope cujo congelado não
  // está mais em disco. Trilha repetida é feia; folha de documento faltando é
  // grave, e entre as duas se escolhe a feia.
  const inteiro = await PDFDocument.create();
  const todas = await append(inteiro, seladoBytes, { ...comp }, undefined);
  check('sem contagem conhecida, entra o artefato INTEIRO', todas === 4, String(todas));

  // Uma contagem maior que o arquivo não pode truncar nem estourar.
  const exagero = await PDFDocument.create();
  const tudo = await append(exagero, seladoBytes, { ...comp }, 99);
  check('uma contagem maior que o arquivo copia tudo, sem estourar', tudo === 4, String(tudo));

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nE a medida do corte sai do arquivo CONGELADO, sem coluna nova');
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Derivar em vez de gravar é o que faz isto valer para envelope JÁ selado: o
  // dossiê que o cliente rebaixa hoje é de um envelope antigo, e uma coluna
  // nova estaria nula justamente nele.
  const bodyPageCount = (art: any) =>
    (dossierAssembler as any).bodyPageCount(art) as Promise<number | undefined>;

  const congeladoPath = join(
    mkdtempSync(join(tmpdir(), 'dossie-')),
    'original.pdf',
  );
  writeFileSync(congeladoPath, Buffer.from(await pdfWithPages(2, 'CORPO')));

  check(
    'o congelado de duas folhas diz onde a trilha começa',
    (await bodyPageCount({ originalPath: congeladoPath })) === 2,
    String(await bodyPageCount({ originalPath: congeladoPath })),
  );
  check(
    'sem caminho gravado (envelope anterior ao recurso), não há corte',
    (await bodyPageCount({ originalPath: '' })) === undefined,
  );
  check(
    'arquivo fora do disco também não corta — a falta vira artefato inteiro',
    (await bodyPageCount({ originalPath: '/nao/existe/original.pdf' })) === undefined,
  );

  const lixo = join(mkdtempSync(join(tmpdir(), 'dossie-')), 'quebrado.pdf');
  writeFileSync(lixo, Buffer.from('nem de longe um PDF'));
  check(
    'e um arquivo ilegível não derruba a montagem',
    (await bodyPageCount({ originalPath: lixo })) === undefined,
  );
}

main()
  .then(() => {
    console.log(
      failures === 0
        ? '\n✅ Paginação do dossiê: todas as verificações passaram.\n'
        : `\n❌ ${failures} verificação(ões) falharam.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('\n❌ O teste estourou:', err?.stack ?? err?.message ?? err);
    process.exit(1);
  });
