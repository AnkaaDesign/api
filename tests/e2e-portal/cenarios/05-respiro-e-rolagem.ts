/**
 * OS DOIS MODOS DE ALTURA DO PORTAL — e por que um teste precisa cobrá-los.
 *
 * O dono reportou "scroll duplo" em Cobranças. A medição não achou dois
 * scrollers (`window.scrollY` não se move; só o `<main>` rola), mas achou o
 * defeito que produz a sensação: o contêiner centrado era `h-full`, isto é,
 * tinha EXATAMENTE a altura do `<main>` — e numa tela de CARDS o conteúdo passa
 * dele (medido: invólucro 942px, conteúdo 2985px). A margem de baixo era
 * pintada aos 942, no MEIO da rolagem, e quem rolasse até o fim via a última
 * linha colada na borda da janela, sem respiro nenhum.
 *
 * ⛔ E O CONSERTO NÃO PODE SER "deixa crescer sempre". As telas de LISTA
 * precisam do contrário: um pai de altura DEFINIDA, para a tabela se limitar e
 * rolar por dentro, com o rodapé de paginação sempre à vista. As duas exigências
 * são mutuamente exclusivas, então a `ResponsibleLayout` escolhe por rota
 * (`ROTAS_COM_TETO`).
 *
 * ⚠️ É UMA LISTA À MÃO, e listas à mão apodrecem. Este arquivo é o que cobra:
 * tela de lista nova que não entre em `ROTAS_COM_TETO` passa a rolar a página
 * inteira em vez da tabela — e ninguém repara, porque nada quebra.
 *
 * ⚠️ E NÃO É "quem usa `DataTablePage`": Cobranças usa e FLUI (ela desenha
 * cartões com tabelas dentro, não uma tabela que se limita).
 */
import { prisma, CONTATOS, WEB } from '../helpers/env';
import { abreNavegador, novaAba } from '../helpers/navegador';
import { sessaoDoPortal } from '../helpers/ui';
import { check, phase, report, info } from '../../e2e-ui/helpers/harness';

/** O respiro mínimo esperado no fim de uma tela que flui (o `py-6` = 24px). */
const RESPIRO_MINIMO = 16;

const TELAS: Array<{ rota: string; nome: string; modo: 'teto' | 'flui' }> = [
  { rota: 'orcamentos', nome: 'Orçamentos (lista)', modo: 'teto' },
  { rota: 'veiculos', nome: 'Veículos (lista)', modo: 'teto' },
  { rota: 'pedidos', nome: 'Pedidos (lista)', modo: 'teto' },
  { rota: 'cobrancas', nome: 'Cobranças (cartões)', modo: 'flui' },
  { rota: 'assinaturas', nome: 'Assinaturas', modo: 'flui' },
  { rota: '', nome: 'Início', modo: 'flui' },
];

async function main() {
  const browser = await abreNavegador();
  const page = await novaAba(browser, 1500, 900);

  phase('ALTURA E RESPIRO — as telas que têm teto e as que fluem');

  await sessaoDoPortal(page, CONTATOS.vendedor.fone, CONTATOS.vendedor.nome);

  // ⚠️ JANELA CURTA DE PROPÓSITO. A 1035px quase tudo CABE, e caber é
  // indistinguível de ter teto — foi assim que a primeira medição classificou
  // o Início como "preenche". A 620px a diferença aparece.
  await page.setViewportSize({ width: 1500, height: 620 });

  for (const tela of TELAS) {
    await page.goto(`${WEB}/cliente/painel${tela.rota ? '/' + tela.rota : ''}`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(2800);

    const m = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      const wrap = main.querySelector(':scope > div') as HTMLElement;
      main.scrollTop = main.scrollHeight;
      const cr = main.getBoundingClientRect();
      // O elemento visível que termina mais embaixo AGORA (rolado até o fim).
      let fundo = -1e9;
      wrap.querySelectorAll('*').forEach(el => {
        const b = el.getBoundingClientRect();
        if (!b.height) return;
        if (b.bottom <= cr.bottom + 1 && b.bottom > cr.top) fundo = Math.max(fundo, b.bottom);
      });
      const doc = document.scrollingElement!;
      const antes = window.scrollY;
      window.scrollTo(0, 400);
      const documentoRola = window.scrollY > antes;
      window.scrollTo(0, antes);
      return {
        mainClient: main.clientHeight,
        mainScroll: main.scrollHeight,
        wrapAltura: Math.round(wrap.getBoundingClientRect().height),
        classes: wrap.className,
        respiro: Math.round(cr.bottom - fundo),
        documentoRola,
        docScrollH: doc.scrollHeight,
      };
    });

    const transborda = m.mainScroll > m.mainClient + 4;
    info(`${tela.nome}: main ${m.mainClient}→${m.mainScroll}, invólucro ${m.wrapAltura}px`);

    if (tela.modo === 'teto') {
      check(
        `${tela.nome}: tem TETO — a tabela se limita, o main NÃO rola`,
        !transborda,
        `main ${m.mainClient}→${m.mainScroll}`,
      );
      check(
        `${tela.nome}: e o invólucro é h-full`,
        /\bh-full\b/.test(m.classes),
        m.classes,
      );
    } else {
      check(
        `${tela.nome}: o invólucro CRESCE com o conteúdo`,
        m.wrapAltura >= m.mainScroll - 4,
        `invólucro ${m.wrapAltura} × conteúdo rolável ${m.mainScroll}`,
      );
      // ⛔ A asserção que nasceu do print do dono.
      if (transborda) {
        check(
          `${tela.nome}: ⛔ há RESPIRO no fim da rolagem (não termina colado)`,
          m.respiro >= RESPIRO_MINIMO,
          `${m.respiro}px (mínimo ${RESPIRO_MINIMO})`,
        );
      } else {
        info(`${tela.nome}: coube na janela — nada a rolar, respiro não se aplica`);
      }
    }

    // ⛔ UM SCROLLER, SEMPRE. O `<main>` é quem rola; a PÁGINA nunca.
    check(
      `${tela.nome}: a página em si NÃO rola (um scroller só)`,
      !m.documentoRola,
      `scrollHeight do documento = ${m.docScrollH}`,
    );
  }

  await browser.close();
  await prisma.$disconnect();
  return report();
}

main().then(n => process.exit(n > 0 ? 1 : 0));
