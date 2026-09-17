/**
 * FASE 3 — ASSINATURA: RECORTES, ENTREGA E CERIMÔNIA.
 *
 * A pergunta é "cada responsável recebeu o PDF que a função dele pede, e só
 * ele?". Responder isso exige as três pontas: o que o SERVIDOR congelou
 * (EnvelopeDocument.sections), o que SAIU (e-mails no Mailpit) e o que está
 * DENTRO do arquivo (pdftotext no PDF congelado). Conferir só uma delas deixa
 * passar o caso em que a seção certa foi congelada e o arquivo errado enviado.
 */
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { prisma, mailPurge, mailFor, mailBody, waitMail, sentinelaCalls, sentinelaReset, serialBase } from './helpers/env';
import { check, phase, scenario, report, info, money, near, shoot } from './helpers/harness';
import { login, createQuote, BASE, pause } from './helpers/ui';

/**
 * A faixa de séries desta corrida. `QA_SERIAL_BASE` a fixa — é o que permite
 * rodar esta fase ao lado das outras sem disputar número de série.
 */
const SERIAL = serialBase(3);
const PRECO_VEICULO = 2500;

interface Contato {
  nome: string;
  email: string;
  cpf: string;
  /** seções esperadas no recorte dele */
  sections: string[] | null; // null = não assina
  /** o recorte mostra valores? governa a redação da declaração `reviewed` */
  veValores: boolean;
}

const CONTATOS: Contato[] = [
  { nome: 'QA Ana Comercial', email: 'ana.qa@ankaa.test', cpf: '44016701597',
    sections: ['VEHICLE', 'SERVICES', 'PRICING', 'DELIVERY', 'PAYMENT', 'GUARANTEE', 'LAYOUT'], veValores: true },
  { nome: 'QA Bruno Financeiro', email: 'bruno.qa@ankaa.test', cpf: '82147281000',
    sections: ['VEHICLE', 'SERVICES', 'PRICING', 'DELIVERY', 'PAYMENT', 'GUARANTEE'], veValores: true },
  { nome: 'QA Carla Marketing', email: 'carla.qa@ankaa.test', cpf: '05138755226',
    sections: ['VEHICLE', 'LAYOUT'], veValores: false },
  { nome: 'QA Elis Frota', email: 'elis.qa@ankaa.test', cpf: '', sections: null, veValores: false },
];

const pdfText = (p: string): string => {
  try {
    return execFileSync('pdftotext', ['-layout', p, '-'], { encoding: 'utf8', maxBuffer: 20e6 });
  } catch {
    return '';
  }
};

/** A parte escondida de "an***a@ankaa.test" a partir do e-mail verdadeiro. */
function parteOculta(mascara: string, real: string): string {
  const [mLocal] = mascara.split('@');
  const [rLocal] = real.split('@');
  const pre = mLocal.slice(0, mLocal.indexOf('*'));
  const pos = mLocal.slice(mLocal.lastIndexOf('*') + 1);
  return rLocal.slice(pre.length, rLocal.length - pos.length);
}

async function main() {
  const browser: Browser = await chromium.launch({ headless: true });
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1500, height: 2000 }, locale: 'pt-BR' });
  const page: Page = await ctx.newPage();
  page.on('response', r => {
    if (r.status() >= 500 && r.url().includes(':3031')) console.log(`   [HTTP ${r.status()}] ${r.url().slice(0, 120)}`);
  });

  phase(`FASE 3 — assinatura e recortes (séries ${SERIAL}/${SERIAL + 1})`);
  // ⚠️ SÓ LIMPA QUANDO RODA SOZINHA. Zerar o gravador é o certo em série (sem
  // isto a fase herda as chamadas da anterior e a asserção "nada foi emitido
  // aqui" acusa o que outra fase emitiu) e é destrutivo em PARALELO: apagaria as
  // chamadas que os outros workers ainda vão conferir.
  if (!process.env.QA_SHARD) {
    await mailPurge();
    await sentinelaReset();
  }
  await login(page, 'qa.admin@ankaa.test');

  let quoteId = '';
  let budgetNumber = 0;
  let taskId = '';

  await scenario('S0 · orçamento com quatro responsáveis de funções diferentes', page, async () => {
    const res = await createQuote(page, {
      name: `QA Assin ${SERIAL}`,
      customer: /QA Alfa/, customerSearch: 'QA Alfa', category: /^Truck$/,
      serials: `${SERIAL} ${SERIAL + 1}`,
      orderNumber: '778899',
      responsibles: CONTATOS.map(c => c.nome),
      services: [{ search: 'Logomarca', option: /./, amount: String(PRECO_VEICULO * 100) }],
      layoutFile: path.join(__dirname, 'fixtures', 'layout-qa.png'),
    });
    taskId = res.url.split('/').pop()!;
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { quoteId: true } });
    quoteId = t!.quoteId!;
    const q = await prisma.taskQuote.findUnique({ where: { id: quoteId }, select: { budgetNumber: true, total: true } });
    budgetNumber = q!.budgetNumber!;
    info(`orçamento nº ${budgetNumber} · contrato ${money(Number(q!.total))}`);
    check('S0: o contrato é 2 × R$ 2.500,00', near(Number(q!.total), PRECO_VEICULO * 2), money(Number(q!.total)));
  });

  await scenario('S1 · o diálogo diz, ANTES de enviar, quem recebe o quê', page, async () => {
    await page.goto(`${BASE}/financeiro/orcamento/detalhes/${taskId}`, { waitUntil: 'networkidle' });
    await pause(page, 3500);
    for (let i = 0; i < 6; i++) {
      const n = page.getByRole('button', { name: /^Pr.ximo$/ });
      if (!(await n.count())) break;
      await n.first().click();
      await pause(page, 2000);
    }
    await page.getByRole('button', { name: /Enviar para assinatura/ }).click();
    await pause(page, 3000);
    const texto = await page.locator('[role="dialog"]').innerText();
    check('S1: anuncia TRÊS documentos', /3 documentos ser.o gerados/i.test(texto), texto.slice(0, 200));
    check('S1: Gestor de Frota aparece como "não assina"', /QA Elis Frota[\s\S]{0,60}n.o assina/i.test(texto));
    check('S1: Comercial "recebe tudo"', /QA Ana Comercial[\s\S]{0,60}recebe tudo/i.test(texto));
    check('S1: Financeiro NÃO recebe Layout',
      /QA Bruno Financeiro[\s\S]{0,200}?Garantias/i.test(texto) && !/Financeiro ·[^\n]*Layout/i.test(texto),
      texto.match(/QA Bruno Financeiro[\s\S]{0,180}/)?.[0]);
    check('S1: Marketing recebe SÓ Layout', /QA Carla Marketing[\s\S]{0,40}Marketing · Layout/i.test(texto));
    check('S1: avisa que a contra-assinatura da Ankaa recebe o documento completo',
      /contra-assinatura[\s\S]{0,200}documento completo/i.test(texto));
    await shoot(page, 's1-dialogo');
    await page.getByRole('button', { name: /Enviar por E-mail/ }).click();
    await pause(page, 10000);
  });

  await scenario('S2 · o que o SERVIDOR congelou', page, async () => {
    const env = await prisma.signatureEnvelope.findFirst({
      where: { quoteId },
      include: {
        documents: { select: { id: true, sections: true, variantKey: true, isFull: true, originalFileId: true, originalSha256: true } },
        signers: { include: { responsible: { select: { name: true, email: true } } } },
      },
    });
    if (!check('S2: a coleta existe', !!env)) return;
    check('S2: exatamente 3 recortes', env!.documents.length === 3, JSON.stringify(env!.documents.map(d => d.variantKey)));
    check('S2: os 3 têm hashes DIFERENTES',
      new Set(env!.documents.map(d => d.originalSha256)).size === 3,
      JSON.stringify(env!.documents.map(d => d.originalSha256.slice(0, 10))));

    for (const c of CONTATOS) {
      const s = env!.signers.find(x => x.responsible?.email === c.email);
      if (c.sections === null) {
        check(`S2: ${c.nome} (sem seção) NÃO virou signatário`, !s, s ? 'virou' : '');
        continue;
      }
      if (!check(`S2: ${c.nome} é signatário`, !!s)) continue;
      const doc = env!.documents.find(d => d.id === s!.documentId);
      check(`S2: recorte de ${c.nome} = ${c.sections.join('+')}`,
        JSON.stringify(doc?.sections ?? []) === JSON.stringify(c.sections),
        JSON.stringify(doc?.sections));
    }

    // A contra-assinatura interna divide o documento COMPLETO com quem recebe tudo.
    const interno = env!.signers.find(s => s.authMethod === 'INTERNAL_SESSION');
    const ana = env!.signers.find(s => s.responsible?.email === 'ana.qa@ankaa.test');
    check('S2: a Ankaa assina em sessão autenticada (INTERNAL_SESSION)', !!interno);
    check('S2: e compartilha o documento COMPLETO com quem recebe tudo (dedup por recorte)',
      !!interno && interno.documentId === ana?.documentId,
      `interno=${interno?.documentId?.slice(0, 8)} ana=${ana?.documentId?.slice(0, 8)}`);

    // ── O QUE ESTÁ DENTRO DO ARQUIVO ────────────────────────────────────────
    for (const c of CONTATOS.filter(x => x.sections)) {
      const s = env!.signers.find(x => x.responsible?.email === c.email)!;
      const doc = env!.documents.find(d => d.id === s.documentId)!;
      const file = await prisma.file.findUnique({ where: { id: doc.originalFileId }, select: { path: true } });
      const p = file?.path ?? '';
      const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
      if (!fs.existsSync(abs)) { check(`S2: PDF de ${c.nome} existe no disco`, false, abs); continue; }
      const txt = pdfText(abs);
      const temPreco = /TOTAL POR VE|Subtotal|Valor Unit|R\$\s?2\.500,00/i.test(txt);
      const temLayout = /LAYOUT/i.test(txt);
      const temVeiculo = new RegExp(String(SERIAL)).test(txt);
      check(`S2: PDF de ${c.nome} identifica o veículo (nunca é recortado)`, temVeiculo);
      check(`S2: PDF de ${c.nome} ${c.veValores ? 'TEM' : 'NÃO tem'} valores`, temPreco === c.veValores,
        `temPreco=${temPreco}`);
      const esperaLayout = c.sections!.includes('LAYOUT');
      check(`S2: PDF de ${c.nome} ${esperaLayout ? 'TEM' : 'NÃO tem'} a seção de layout`,
        temLayout === esperaLayout, `temLayout=${temLayout}`);
    }
  });

  await scenario('S3 · o que SAIU: um convite pessoal por signatário, nenhum para quem não assina', page, async () => {
    const todos = await Promise.all(CONTATOS.map(async c => ({ c, ms: await mailFor(c.email) })));
    for (const { c, ms } of todos) {
      const convites = ms.filter(m => /assinatura eletr/i.test(m.Subject));
      if (c.sections === null) {
        check(`S3: ${c.nome} NÃO recebeu convite`, convites.length === 0, `recebeu ${convites.length}`);
      } else {
        check(`S3: ${c.nome} recebeu exatamente 1 convite`, convites.length === 1, `recebeu ${convites.length}`);
      }
    }
    // Links pessoais: nenhum token repetido entre signatários.
    const links: string[] = [];
    for (const c of CONTATOS.filter(x => x.sections)) {
      const ms = (await mailFor(c.email)).filter(m => /assinatura eletr/i.test(m.Subject));
      const b = await mailBody(ms[0].ID);
      const l = (b.html.match(/https?:\/\/[^"'<\s]*\/cliente\/assinar\/[^"'<\s]+/g) ?? [])[0] ?? '';
      links.push(l);
    }
    check('S3: cada link é pessoal (tokens distintos)', new Set(links).size === links.length && links.every(Boolean),
      JSON.stringify(links.map(l => l.slice(-12))));
  });

  // ── A CERIMÔNIA, UM SIGNATÁRIO POR VEZ ────────────────────────────────────
  for (const c of CONTATOS.filter(x => x.sections)) {
    await scenario(`S4 · ${c.nome} assina`, page, async () => {
      const ms = (await mailFor(c.email)).filter(m => /assinatura eletr/i.test(m.Subject));
      const b = await mailBody(ms[0].ID);
      const link = (b.html.match(/https?:\/\/[^"'<\s]*\/cliente\/assinar\/[^"'<\s]+/g) ?? [])[0];
      const p = await ctx.newPage();
      await p.goto(link, { waitUntil: 'networkidle' });
      await pause(p, 4000);

      await p.getByRole('button', { name: /Enviar c.digo/ }).first().click();
      await pause(p, 2500);
      const dlg = p.locator('[role="dialog"]');
      const textoDlg = await dlg.innerText();
      const mascara = (textoDlg.match(/[\w.]*\*+[\w.]*@[\w.]+/) ?? [''])[0];
      await dlg.locator('input').nth(0).fill(c.cpf.slice(3, 9));
      if ((await dlg.locator('input').count()) > 1) {
        await dlg.locator('input').nth(1).fill(parteOculta(mascara, c.email));
      }
      await pause(p, 400);
      await dlg.getByRole('button', { name: /Enviar c.digo/ }).click();
      await pause(p, 6000);

      const otpMail = await waitMail(c.email, /C.digo de assinatura/i, 30000);
      if (!check(`S4 ${c.nome}: o código de uso único chegou por e-mail`, !!otpMail)) { await p.close(); return; }
      const code = ((otpMail!.text || otpMail!.html.replace(/<[^>]+>/g, ' ')).match(/\b\d{6}\b/) ?? [''])[0];
      check(`S4 ${c.nome}: o código tem 6 dígitos`, /^\d{6}$/.test(code), code);

      // A DECLARAÇÃO SEGUE O RECORTE: quem não vê preço não declara o valor.
      const corpo = await p.evaluate(() => document.body.innerText);
      const declaraValor = /revisei integralmente este or.amento[^.]*no valor total/i.test(corpo);
      check(
        `S4 ${c.nome}: a declaração ${c.veValores ? 'CITA' : 'NÃO cita'} o valor total`,
        declaraValor === c.veValores,
        declaraValor ? 'cita' : 'não cita',
      );
      if (!c.veValores) {
        check(`S4 ${c.nome}: e o valor do contrato não vaza na tela dele`,
          !/R\$\s?5\.000,00/.test(corpo), 'apareceu R$ 5.000,00');
      }

      // ⚠️ O desafio de identidade pede os 6 dígitos do MEIO do CPF — e a mesma
      // tela os imprime no painel de identificação. Registrado como verificação.
      const meio = c.cpf.slice(3, 9);
      const mostraMeio = new RegExp(`${meio.slice(0, 3)}\\.${meio.slice(3)}`).test(corpo);
      check(`S4 ${c.nome}: os 6 dígitos pedidos NÃO estão impressos na mesma tela`,
        !mostraMeio, mostraMeio ? `a tela mostra ***.${meio.slice(0,3)}.${meio.slice(3)}-** e o desafio pede ${meio}` : '');

      const aceite = p.locator('[role="checkbox"], input[type="checkbox"]').last();
      if (await aceite.count()) { await aceite.click(); await pause(p, 400); }
      const otpInput = p.locator('input').filter({ hasNot: p.locator('[type="checkbox"]') }).last();
      await otpInput.fill(code);
      await pause(p, 600);
      await p.getByRole('button', { name: /Assinar or.amento/ }).click();
      await pause(p, 9000);

      const s = await prisma.envelopeSigner.findFirst({
        where: { envelope: { quoteId }, responsible: { email: c.email } },
        select: { status: true, signedAt: true },
      });
      check(`S4 ${c.nome}: ficou SIGNED no banco`, s?.status === 'SIGNED', `status=${s?.status}`);
      await shoot(p, `s4-${c.email.split('@')[0]}`);
      await p.close();
    });
  }

  await scenario('S5 · contra-assinatura da Ankaa e fim da coleta', page, async () => {
    const irAoPainel = async (p: Page) => {
      await p.goto(`${BASE}/financeiro/orcamento/detalhes/${taskId}`, { waitUntil: 'networkidle' });
      await pause(p, 4000);
      for (let i = 0; i < 6; i++) {
        const n = p.getByRole('button', { name: /^Pr.ximo$/ });
        if (!(await n.count())) break;
        await n.first().click();
        await pause(p, 2000);
      }
      const t = await p.evaluate(() => ((document.querySelector('main') as HTMLElement)?.innerText ?? ''));
      const i = t.indexOf('Assinatura eletr');
      return i < 0 ? '' : t.slice(i, i + 2200);
    };

    const painel = await irAoPainel(page);
    check('S5: o painel lista os 3 documentos e quem assinou cada um',
      /Documento completo[\s\S]*Layout[\s\S]*Lista de servi.os/.test(painel), painel.slice(0, 300));
    check('S5: o orçamento está SIGNED (clientes assinaram, falta a Ankaa)',
      (await prisma.taskQuote.findUnique({ where: { id: quoteId }, select: { status: true } }))?.status === 'SIGNED');

    // Um ADMIN qualquer NÃO contra-assina: quem assina é o signatário designado.
    let status403 = 0;
    page.on('response', r => { if (r.url().includes('/contra-assinar') && r.status() === 403) status403++; });
    await page.getByRole('button', { name: /^Contra-assinar$/ }).click();
    await pause(page, 4000);
    check('S5: ADMIN que não é o signatário designado é RECUSADO (403)', status403 > 0,
      'a rota aceitou quem não devia');

    // Agora o designado, pela tela, com a sessão dele.
    const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 2000 }, locale: 'pt-BR' });
    const p2 = await ctx2.newPage();
    await login(p2, 'sergio_ankaa@hotmail.com');
    await irAoPainel(p2);
    const botao = p2.getByRole('button', { name: /^Contra-assinar$/ }).first();
    if (!check('S5: o designado vê o botão de contra-assinar', (await botao.count()) > 0)) { await ctx2.close(); return; }
    await botao.click();
    await pause(p2, 3000);
    const dlg = p2.locator('[role="dialog"]');
    if (await dlg.count()) {
      const conf = dlg.getByRole('button', { name: /Contra-assinar|Assinar|Confirmar/i }).last();
      if (await conf.count()) { await conf.click(); }
    }
    await pause(p2, 12000);
    await shoot(p2, 's5-contra-assinado');
    await ctx2.close();

    const env = await prisma.signatureEnvelope.findFirst({ where: { quoteId }, select: { status: true, completedAt: true } });
    const q = await prisma.taskQuote.findUnique({ where: { id: quoteId }, select: { status: true } });
    check('S5: o envelope concluiu', env?.status === 'COMPLETED', `status=${env?.status}`);
    check('S5: o orçamento ficou APROVADO', q?.status === 'APPROVED', `status=${q?.status}`);

    const docs = await prisma.envelopeDocument.findMany({
      where: { envelope: { quoteId } },
      select: { variantKey: true, finalSha256: true, sealedAt: true },
    });
    check('S5: os 3 recortes foram SELADOS', docs.every(d => !!d.sealedAt && !!d.finalSha256),
      JSON.stringify(docs.map(d => ({ v: d.variantKey.slice(0, 18), selado: !!d.sealedAt }))));
  });

  await scenario('S6 · nada saiu da máquina', page, async () => {
    const calls = await sentinelaCalls();
    const escapes = calls.filter(c => c.integration === 'ESCAPE');
    check('S6: nenhuma chamada a caminho não mapeado (vazamento)', escapes.length === 0,
      JSON.stringify(escapes.slice(0, 5).map(e => e.path)));
    // ⚠️ SOBRE ESTE ORÇAMENTO, não sobre a sentinela inteira. Ela é UMA para
    // todos os workers: em paralelo, "nada foi emitido aqui" acusaria o que o
    // vizinho emitiu. A série do veículo é a âncora que atravessa processos —
    // ela aparece na discriminação da nota e no informativo do boleto.
    const meus = calls.filter(c => {
      if (c.integration !== 'elotech' && c.integration !== 'sicredi') return false;
      const texto = JSON.stringify(c.body ?? {});
      return texto.includes(String(SERIAL)) || texto.includes(String(SERIAL + 1));
    });
    check('S6: nenhuma NFS-e ou boleto foi emitido para os veículos desta fase',
      meus.length === 0,
      `${meus.length} de ${calls.length}: ${JSON.stringify(meus.slice(0, 3).map(c => c.path))}`);
  });

  console.log(`\nORÇAMENTO DA FASE 3: nº ${budgetNumber} (taskId ${taskId})`);
  await browser.close();
  await prisma.$disconnect();
  process.exit(report() > 0 ? 1 : 0);
}

main();
