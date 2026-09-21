/**
 * O NAVEGADOR DA BATERIA.
 *
 * Usa o Chromium DO SISTEMA (`/usr/bin/chromium`) e não o do Playwright: esta
 * máquina não tem os binários baixados em `~/.cache/ms-playwright`, e um
 * `playwright install` no meio de uma corrida é rede que a bateria não deveria
 * precisar. O `executablePath` é sobrescrevível por `PORTAL_CHROMIUM`.
 *
 * `PORTAL_HEADED=1` abre janela — serve para assistir a um cenário que falhou.
 */
import { chromium, type Browser, type Page } from 'playwright';

export const CHROMIUM = process.env.PORTAL_CHROMIUM ?? '/usr/bin/chromium';

export async function abreNavegador(): Promise<Browser> {
  return chromium.launch({
    headless: process.env.PORTAL_HEADED !== '1',
    executablePath: CHROMIUM,
    slowMo: process.env.PORTAL_HEADED === '1' ? 120 : 0,
  });
}

/**
 * Uma aba limpa.
 *
 * ⚠️ Contexto NOVO por ator, sempre. Funcionário e responsável guardam token em
 * chaves DIFERENTES do mesmo `localStorage` (`token` e `ankaa_cliente_token`),
 * e reaproveitar o contexto entre os dois faz um cenário entrar com a sessão do
 * anterior sem que nada falhe — o teste passa provando a coisa errada.
 */
export async function novaAba(browser: Browser, largura = 1600, altura = 1200): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: largura, height: altura },
    locale: 'pt-BR',
  });
  return ctx.newPage();
}
