/**
 * O DOSSIÊ DE UM ORÇAMENTO ASSINADO — trilha legível e bloco em branco fora.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O orçamento nº 0984 foi assinado eletronicamente e o dossiê saía sem nenhum
 * sinal disso: o documento assinado ia só como ANEXO (`/EmbeddedFiles`), que
 * quase nenhum visualizador exibe — menos ainda o do celular —, e a página do
 * layout imprimia três traços em branco com os nomes dos signatários embaixo,
 * para assinar à mão. Quem abria o PDF via um orçamento NÃO assinado.
 *
 * Duas coisas passaram a valer, e as duas são invisíveis para o `tsc`:
 *
 *  1. `hideSignatureBlock` troca os traços em branco por um aviso — e SÓ os
 *     traços: a folha continua existindo e a arte continua nela. O caminho
 *     fundido (orçamento e assinaturas na mesma folha) é escolhido por MEDIDA,
 *     não por configuração, então a bandeira tem de valer nos dois.
 *
 *  2. A trilha consolidada é montada pelo dossiê, em PDFKit, com o hash do
 *     arquivo SELADO (nunca um recalculado depois do carimbo de página) e o CPF
 *     mascarado na convenção do repositório.
 *
 * Aqui não há banco: o HTML é uma string e a trilha é conferida relendo os
 * bytes do PDF — o texto do PDFKit vira hexadecimal dentro de um array de
 * kerning (`[<54> 80 <72696c6861>] TJ`), ele próprio dentro de um stream
 * comprimido, e procurá-lo no arquivo cru acha zero com tudo funcionando.
 *
 *   npm run test:dossier-signed-trail
 */

import { inflateSync } from 'zlib';
import { PDFDocument } from 'pdf-lib';
import { buildQuoteHtml } from '../src/modules/common/signature/document/quote-html.builder';
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

// =============================================================================
// 1. O BLOCO DE ASSINATURAS EM BRANCO
// =============================================================================

const htmlFixture = (hideSignatureBlock: boolean) => ({
  budgetNumber: 984,
  issuedAt: new Date('2026-09-01T12:00:00Z'),
  expiresAt: new Date('2026-10-01T12:00:00Z'),
  corporateName: 'DICASA TRANSPORTES LTDA',
  customerDocumentFormatted: '12.345.678/0001-99',
  contactName: 'Beatriz Araujo',
  vehicles: [
    {
      taskId: 'task-1',
      serialNumber: '4821',
      plate: 'ABB8468',
      chassisNumber: null,
      orderNumber: null,
      categoryLabel: 'SEMI_TRAILER_2_AXLES',
      implementLabel: 'BAU',
    },
  ],
  services: [{ description: 'Pintura completa do implemento', amount: 4850, observation: null }],
  subtotal: 4850,
  total: 4850,
  discountLabel: null,
  discountPercent: null,
  discountReference: null,
  discountAmount: null,
  deliveryDays: 20,
  simultaneousTasks: 1,
  paymentText: 'À vista.',
  guaranteeText: '2 anos.',
  // Uma arte de 1x1 px: o que importa é o elemento existir na folha.
  layoutImages: [
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ],
  logoDataUri: null,
  fontDataUri: null,
  signers: [
    { id: 's1', name: 'Beatriz Araujo', subtitle: 'DICASA', side: 'CUSTOMER' as const },
    { id: 's2', name: 'Kennedy Campos', subtitle: 'Diretor — Ankaa', side: 'ANKAA' as const },
    { id: 's3', name: 'Sergio Rodrigues', subtitle: 'DICASA', side: 'CUSTOMER' as const },
  ],
  acceptanceClause: 'ACEITAÇÃO DO MEIO ELETRÔNICO.',
  verificationCode: '',
  verificationUrl: '',
  hideSignatureBlock,
});

console.log('\nO bloco em branco sai do dossiê assinado — e só dele');

for (const part of ['signatures', 'fused'] as const) {
  const comBloco = buildQuoteHtml(htmlFixture(false) as any, part);
  const semBloco = buildQuoteHtml(htmlFixture(true) as any, part);

  check(
    `[${part}] o orçamento AVULSO mantém os traços para assinar à mão`,
    comBloco.includes('data-signature-slot="s1"') &&
      comBloco.includes('Sergio Rodrigues') &&
      !comBloco.includes('assinado eletronicamente'),
  );
  check(
    `[${part}] o dossiê do assinado NÃO imprime traço nenhum`,
    // As classes continuam existindo na FOLHA DE ESTILO — o que não pode
    // existir é uma caixa de assinatura marcada no corpo.
    !semBloco.includes('data-signature-slot') && !semBloco.includes('class="signature-box"'),
  );
  check(
    `[${part}] e diz por quê, em vez de calar`,
    semBloco.includes('assinado eletronicamente'),
  );
  check(
    `[${part}] a seção continua existindo — é ela que dá a folha e a medida`,
    semBloco.includes('signatures-section') && semBloco.includes('signatures-title'),
  );
}

{
  // A ARTE é o motivo de a folha sobreviver: "a página do layout" é esta.
  const semBloco = buildQuoteHtml(htmlFixture(true) as any, 'signatures');
  check(
    '[signatures] a arte continua na folha depois de o bloco sair',
    semBloco.includes('layout-image'),
  );
}

// =============================================================================
// 2. A TRILHA CONSOLIDADA
// =============================================================================

/**
 * O texto desenhado em TODAS as páginas, já descomprimido.
 *
 * DUAS camadas entre o texto e o arquivo, e o detector ingênuo mente nas duas:
 * o content stream é gravado comprimido (Flate) e, dentro dele, o PDFKit não
 * escreve literais — escreve um array de kerning com strings HEXADECIMAIS
 * (`[<54> 80 <72696c6861>] TJ`). Procurar "Trilha" no arquivo cru acha zero com
 * tudo funcionando. O hexa é WinAnsi, que para o nosso alfabeto é latin1.
 */
function drawnText(pdf: Buffer): string {
  const flat = pdf.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) {
    const start = m.index + m[0].length;
    const end = flat.indexOf('endstream', start);
    if (end < 0) continue;
    const raw = Buffer.from(flat.slice(start, end), 'latin1');
    let content = '';
    try {
      content = inflateSync(raw).toString('latin1');
    } catch {
      content = raw.toString('latin1');
    }
    for (const block of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      let line = '';
      for (const piece of block[1].matchAll(/<([0-9a-fA-F]*)>|\(((?:\\.|[^\\)])*)\)/g)) {
        line += piece[1] !== undefined
          ? Buffer.from(piece[1], 'hex').toString('latin1')
          : piece[2].replace(/\\([()\\])/g, '$1');
      }
      out.push(line);
    }
    for (const t of content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      out.push(t[1].replace(/\\([()\\])/g, '$1'));
    }
  }
  return out.join('\n');
}

const SEALED_SHA = 'a'.repeat(64);

const artifact = {
  isFull: true,
  sections: [] as string[],
  path: '/dev/null/orcamento-984-assinado.pdf',
  finalSha256: SEALED_SHA,
  sealedAt: new Date('2026-09-12T18:04:00Z'),
  padesLevel: 'B-LT',
  certSubject: 'ANKAA DESIGN LTDA',
  certCnpj: '12.345.678/0001-99',
  tsaGenTime: new Date('2026-09-12T18:04:03Z'),
  signers: [
    {
      declaredName: 'Beatriz Araujo',
      declaredCpf: '52998224725',
      declaredEmail: 'beatriz@dicasa.com.br',
      declaredPhone: '43984283228',
      informedCpf: '52998224725',
      informedCargo: 'Gerente financeira',
      orderGroup: 0,
      status: 'SIGNED',
      authMethod: 'EMAIL_OTP',
      signedAt: new Date('2026-09-12T17:41:00Z'),
      refusedAt: null,
      refusalReason: null,
      ipAddress: '189.28.44.10',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15',
    },
    {
      declaredName: 'Kennedy Campos',
      declaredCpf: null,
      declaredEmail: null,
      declaredPhone: null,
      informedCpf: null,
      informedCargo: null,
      orderGroup: 1,
      status: 'SIGNED',
      authMethod: 'INTERNAL_SESSION',
      signedAt: new Date('2026-09-12T18:03:00Z'),
      refusedAt: null,
      refusalReason: null,
      ipAddress: null,
      userAgent: null,
    },
  ],
};

async function trilha() {
  console.log('\nA trilha consolidada é legível, e não inventa hash');

  // Sem nenhuma dependência: o construtor só guarda referências, e a trilha é
  // montada a partir do argumento — nada aqui toca o banco.
  const service = new DossierAssemblerService(
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );

  const pdf: Buffer = await (service as any).renderAuditTrail({
    budgetNumber: 984,
    envelopeId: '11111111-2222-3333-4444-555555555555',
    version: 1,
    verificationCode: 'ABC-123-XYZ',
    originalSha256: 'b'.repeat(64),
    artifacts: [artifact],
    events: [
      {
        sequence: 1,
        occurredAt: new Date('2026-09-10T12:00:00Z'),
        eventType: 'ENVELOPE_CREATED',
        actorLabel: 'Ankaa',
        ipAddress: null,
        hash: 'c'.repeat(64),
      },
      {
        sequence: 2,
        occurredAt: new Date('2026-09-12T17:41:00Z'),
        eventType: 'SIGNATURE_APPLIED',
        actorLabel: 'Beatriz Araujo',
        ipAddress: '189.28.44.10',
        hash: 'd'.repeat(64),
      },
    ],
    signedPagesIncluded: true,
  });

  const doc = await PDFDocument.load(pdf);
  check('é um PDF válido com pelo menos uma folha', doc.getPageCount() >= 1);

  const text = drawnText(pdf);

  check('nomeia o orçamento e o envelope', text.includes('984') && text.includes('ABC-123-XYZ'));
  check(
    'traz o hash do arquivo SELADO, não um recalculado depois',
    text.includes(SEALED_SHA),
    'o hash do selo tem de sair inteiro',
  );
  check('diz quem assinou', text.includes('Beatriz Araujo') && text.includes('Kennedy Campos'));
  check('e o papel de cada um', text.includes('Ankaa') && text.includes('cliente'));
  check(
    'o CPF sai MASCARADO na convenção do repositório (***.999.999-**)',
    text.includes('***.982.247-**') && !text.includes('529.982.247-25'),
  );
  check('o cargo informado no ato', text.includes('Gerente financeira'));
  check(
    'o canal do código de uso único',
    text.includes('e-mail') || text.includes('E-mail'),
  );
  check('o e-mail mascarado, nunca inteiro', !text.includes('beatriz@dicasa.com.br'));
  check('o IP de quem assinou', text.includes('189.28.44.10'));
  check('o navegador, truncado', text.includes('Navegador:'));
  check('o carimbo do tempo e o nível PAdES', text.includes('B-LT') && text.includes('Carimbo'));
  check(
    'o log encadeado, com descrição em português',
    text.includes('Assinatura aplicada') && text.includes('001') && text.includes('002'),
  );
  check('e o hash de cada elo', text.includes('c'.repeat(64)) && text.includes('d'.repeat(64)));
  check(
    'aponta para as páginas assinadas quando elas vão junto',
    text.includes('anteriores deste dossiê'),
  );

  // Sem as páginas seladas no maço, a frase MUDA: apontar para algo que não
  // está ali é pior que não apontar.
  const semPaginas: Buffer = await (service as any).renderAuditTrail({
    budgetNumber: 984,
    envelopeId: '11111111-2222-3333-4444-555555555555',
    version: 1,
    verificationCode: 'ABC-123-XYZ',
    originalSha256: 'b'.repeat(64),
    artifacts: [artifact],
    events: [],
    signedPagesIncluded: false,
  });
  const textoSem = drawnText(semPaginas);
  check(
    'e não aponta quando elas não vão',
    !textoSem.includes('anteriores deste dossiê') && textoSem.includes('servidor da Ankaa'),
  );
}

trilha()
  .then(() => {
    if (failures) {
      console.log(`\n❌ ${failures} verificação(ões) falharam.`);
      process.exit(1);
    }
    console.log('\n✅ Dossiê do orçamento assinado: todas as verificações passaram.');
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
