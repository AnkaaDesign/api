/**
 * Amostras visuais das LACUNAS DE CADASTRO TARDIO no orçamento.
 *
 *   npx tsx scripts/test-late-slots.ts             # escreve em ./tmp/lacunas
 *   OUT=/algum/lugar npx tsx scripts/test-late-slots.ts
 *
 * Gera pares "emissão → carimbado" a partir dos MESMOS bytes congelados, que é
 * a coisa que o recurso existe para permitir: o dado que chega semanas depois
 * (chassi, placa) entra no lugar reservado para ele, sem re-render e sem nova
 * assinatura.
 *
 * Confere, além do visual: que a lacuna foi medida (`lateSlots`), que ela some
 * quando o cadastro já está completo, e que o carimbo respeita valor já impresso.
 */
import { QuoteRendererService } from '../src/modules/common/signature/document/quote-renderer.service';
import { QuoteAssemblerService } from '../src/modules/common/signature/document/quote-assembler.service';
import type { AssemblerSigner } from '../src/modules/common/signature/document/quote-assembler.service';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const OUT = process.env.OUT || join(process.cwd(), 'tmp', 'lacunas');

const SIGNERS = [
  {
    id: 'sig-ankaa',
    name: 'Sergio Rodrigues',
    subtitle: 'Diretor Comercial — Ankaa Design',
    side: 'ANKAA' as const,
  },
  {
    id: 'sig-c1',
    name: 'Gabriela Silva de Medeiros Nunes',
    subtitle: 'Sócia-administradora — G J DE MEDEIROS TRANSPORTES',
    side: 'CUSTOMER' as const,
  },
];

/** Os mesmos signatários, já assinados — é o que o montador precisa para selar. */
const SIGNED: AssemblerSigner[] = SIGNERS.map(s => ({
  id: s.id,
  name: s.name,
  cargo: s.side === 'ANKAA' ? 'Diretor Comercial' : 'Sócia-administradora',
  companyLabel: s.side === 'ANKAA' ? 'Ankaa Design' : 'G J DE MEDEIROS TRANSPORTES',
  cpf: s.side === 'ANKAA' ? '11122233344' : '55566677788',
  phone: '43999887766',
  signedAt: new Date('2026-08-20T14:32:00Z'),
  status: 'SIGNED',
  authMethodLabel: 'Código de uso único por e-mail',
  ipAddress: '187.19.44.201',
  side: s.side,
}));

function services(count: number) {
  return Array.from({ length: count }, (_, i) =>
    i === 0
      ? {
          description: 'Pintura geral do implemento',
          amount: 8400,
          observation: 'Branco Ártico, esquema de dois componentes',
        }
      : i === 1
        ? {
            description: 'Adesivagem das laterais',
            amount: 3200,
            observation: 'Conforme layout aprovado',
          }
        : {
            description: `Serviço complementar — etapa ${i + 1}`,
            amount: 640 + i * 55,
            observation: i % 3 === 0 ? 'Observação técnica da etapa' : null,
          },
  );
}

interface Vehicle {
  serialNumber: string | null;
  plate: string | null;
  chassisNumber: string | null;
}

function baseInput(vehicle: Vehicle, serviceCount: number) {
  return {
    budgetNumber: 905,
    issuedAt: new Date('2026-08-14T12:00:00Z'),
    expiresAt: new Date('2026-09-13T12:00:00Z'),
    corporateName: 'G J DE MEDEIROS TRANSPORTES LTDA',
    customerDocumentFormatted: '41.284.907/0001-63',
    contactName: 'Gabriela Silva de Medeiros Nunes',
    serialNumber: vehicle.serialNumber,
    plate: vehicle.plate,
    chassisNumber: vehicle.chassisNumber,
    truckCategoryLabel: 'TOCO',
    truckImplementLabel: 'REFRIGERATED',
    services: services(serviceCount),
    subtotal: 0,
    total: 0,
    discountLabel: null,
    discountPercent: null,
    discountReference: null,
    discountAmount: 0,
    deliveryDays: 25,
    simultaneousTasks: 2,
    paymentText:
      'Fica acertado o pagamento em 2 (duas) parcelas iguais, a primeira com entrada de 5 dias a partir da finalização do serviço e a segunda 30 dias depois.',
    guaranteeText:
      'A Garantia para o serviço de pintura é de 5 anos desde que sejam atendidas as condições de uso e cuidado do implemento.',
    layoutImages: [] as string[],
    signers: SIGNERS,
    acceptanceClause:
      'ACEITAÇÃO DO MEIO ELETRÔNICO. As partes reconhecem e aceitam, para todos os fins do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001, a assinatura eletrônica deste orçamento.',
    verificationCode: 'A7K9-2FMQ-XR4T',
    verificationUrl: 'https://ankaadesign.com.br/v/A7K9-2FMQ-XR4T',
  };
}

function totals(input: ReturnType<typeof baseInput>) {
  const subtotal = input.services.reduce((acc, s) => acc + s.amount, 0);
  return { ...input, subtotal, total: subtotal };
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const renderer = new QuoteRendererService();
  const assembler = new QuoteAssemblerService();

  const scenarios: Array<{
    file: string;
    title: string;
    /** Cadastro na EMISSÃO — o que o documento congela. */
    atIssue: Vehicle;
    /** Cadastro HOJE — o que existe na hora de montar o artefato. */
    now?: Vehicle;
    services: number;
  }> = [
    {
      file: '1-emissao-chassi-pendente',
      title: 'Emissão: série e placa cadastradas, chassi ainda não',
      atIssue: { serialNumber: '39069', plate: 'TSZ2J53', chassisNumber: null },
      services: 6,
    },
    {
      file: '2-selado-chassi-carimbado',
      title: 'Selado semanas depois: o chassi entra na lacuna',
      atIssue: { serialNumber: '39069', plate: 'TSZ2J53', chassisNumber: null },
      now: { serialNumber: '39069', plate: 'TSZ2J53', chassisNumber: '953678TG3TR034023' },
      services: 6,
    },
    {
      file: '3-emissao-0km',
      title: 'Emissão de implemento 0 km: só o número de série existe',
      atIssue: { serialNumber: '39171', plate: null, chassisNumber: null },
      services: 14,
    },
    {
      file: '4-selado-placa-e-chassi',
      title: 'Selado: placa e chassi chegaram juntos',
      atIssue: { serialNumber: '39171', plate: null, chassisNumber: null },
      now: { serialNumber: '39171', plate: 'ABB8468', chassisNumber: '9BM45465489452156' },
      services: 14,
    },
    {
      file: '5-emissao-cadastro-completo',
      title: 'Controle: cadastro completo na emissão, nenhuma lacuna',
      atIssue: {
        serialNumber: '38290',
        plate: 'FCL1G44',
        chassisNumber: '93KP0Y1A8SE210977',
      },
      services: 6,
    },
  ];

  for (const scenario of scenarios) {
    const t0 = Date.now();
    const rendered = await renderer.render(totals(baseInput(scenario.atIssue, scenario.services)));

    // O ORIGINAL — os bytes que seriam congelados e hasheados no envio.
    const frozenSha = createHash('sha256').update(rendered.pdf).digest('hex');

    const pdf = scenario.now
      ? await assembler.stampSeals({
          originalPdf: rendered.pdf,
          anchors: rendered.anchors,
          signers: SIGNED,
          budgetNumber: 905,
          verificationCode: 'A7K9-2FMQ-XR4T',
          verificationUrl: 'https://ankaadesign.com.br/v/A7K9-2FMQ-XR4T',
          originalSha256: frozenSha,
          lateSlots: rendered.lateSlots,
          lateValues: {
            serialNumber: scenario.now.serialNumber,
            plate: scenario.now.plate,
            chassis: scenario.now.chassisNumber,
          },
        })
      : await assembler.stampPlainFooter(rendered.pdf, 905);

    const path = join(OUT, `${scenario.file}.pdf`);
    writeFileSync(path, pdf);

    const { PDFDocument } = await import('pdf-lib');
    const pageCount = (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();

    const slots = Object.entries(rendered.lateSlots)
      .map(
        ([k, s]) =>
          `${k}(${s.width.toFixed(0)}x${s.height.toFixed(0)}px @p${s.page} ${s.fontSizeCss.toFixed(1)}px)`,
      )
      .join(' ');
    console.log(
      `${scenario.file}\n` +
        `  ${scenario.title}\n` +
        `  lacunas: ${slots || '(nenhuma)'}\n` +
        `  páginas=${pageCount} ajustes=${rendered.fitIterations} ` +
        `bytes=${pdf.length} ms=${Date.now() - t0}\n` +
        `  -> ${path}`,
    );
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
