/**
 * OBJETOS DE PÁGINA DA BATERIA DO PORTAL.
 *
 * Regra herdada de `tests/e2e-ui/helpers/ui.ts` e que vale aqui igual: nenhum
 * auxiliar daqui chama endpoint para "adiantar" um passo. O ponto da bateria é
 * que o formulário, o combobox, o recorte por papel e o portão de gravação
 * participem. Onde a UI não oferece caminho, o cenário FALHA — um contorno por
 * API esconderia exatamente o beco que se procura.
 */
import fs from 'fs';
import path from 'path';
import type { Page } from 'playwright';
import { WEB, SENHA_INTERNA, ultimoCodigo } from './env';

export const pausa = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Fecha o que estiver por cima no primeiro acesso de um usuário. */
export async function fechaModais(page: Page) {
  for (let i = 0; i < 3; i++) {
    const dlg = page.locator('[role="dialog"]');
    if (!(await dlg.count())) return;
    const nao = dlg.getByRole('button', { name: /N.o mostrar novamente/i }).first();
    if (await nao.count()) {
      await nao.click();
      await pausa(page, 800);
      continue;
    }
    const fechar = dlg.getByRole('button', { name: /^(Close|Fechar)$/i }).first();
    if (await fechar.count()) {
      await fechar.click();
      await pausa(page, 800);
      continue;
    }
    await page.keyboard.press('Escape');
    await pausa(page, 700);
  }
}

// ── FUNCIONÁRIO ────────────────────────────────────────────────────────────

export async function entraFuncionario(page: Page, email: string, senha = SENHA_INTERNA) {
  await page.goto(`${WEB}/autenticacao/entrar`, { waitUntil: 'networkidle' });
  await pausa(page, 700);
  await page.locator('input[type="text"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(senha);
  await page.getByRole('button', { name: /^Entrar$/ }).click();
  await page.waitForURL(u => !u.pathname.includes('autenticacao'), { timeout: 40000 });
  await pausa(page, 1500);
  await fechaModais(page);
}

// ── RESPONSÁVEL ────────────────────────────────────────────────────────────

/**
 * Entra no portal com o código que a API escreveu no log.
 *
 * ⚠️ O campo do código é UM `input[maxlength=6]`, não seis caixinhas — e o
 * formulário auto-submete ao completar. Clicar num botão "Entrar" depois disso
 * é inofensivo, mas procurar por ele e FALHAR não é: por isso o clique é
 * condicional.
 */
export async function entraResponsavel(page: Page, contato: string, nome?: string) {
  await page.goto(`${WEB}/cliente/entrar`, { waitUntil: 'networkidle' });
  await pausa(page, 700);
  const campo = page.locator('input').first();
  await campo.click();
  await campo.fill(contato);
  await page.getByRole('button', { name: /Receber c.digo/i }).click();

  // ⚠️ O COOLDOWN, TRATADO AQUI E NÃO NO CENÁRIO.
  //
  // Pedir dois códigos para o mesmo contato em menos de 120 s devolve 400
  // "Aguarde N segundos para pedir um novo código"
  // (`responsible-auth-challenge.service.ts:61,157-164`) e a tela simplesmente
  // não avança. Sem este tratamento a falha aparece como "Timeout esperando
  // input[maxlength=6]" — uma mensagem que não diz NADA sobre cooldown e manda
  // quem for depurar procurar o defeito no seletor. Espera e tenta de novo,
  // uma vez.
  const caixaDoCodigo = page.locator('input[maxlength="6"]').first();
  try {
    await caixaDoCodigo.waitFor({ timeout: 8000 });
  } catch {
    const aviso = await texto(page, 'body');
    const espera = aviso.match(/Aguarde\s+(\d+)\s+segundos/i);
    if (!espera) {
      throw new Error(
        `a tela não avançou para o código e não disse por quê. Texto: ${aviso.slice(0, 200)}`,
      );
    }
    const segundos = Number(espera[1]);
    // eslint-disable-next-line no-console
    console.log(`  · cooldown de ${segundos}s em ${contato} — esperando`);
    await pausa(page, (segundos + 3) * 1000);
    // ⚠️ RECOMEÇA A TELA. Depois da recusa, o botão "Receber código" fica
    // DESABILITADO e assim permanece — a tela não reabilita sozinha quando o
    // cooldown vence, e reclicar o botão velho espera para sempre. Recarregar e
    // repreencher é o que um humano faria, e é o único caminho que funciona.
    await page.goto(`${WEB}/cliente/entrar`, { waitUntil: 'networkidle' });
    await pausa(page, 700);
    const denovo = page.locator('input').first();
    await denovo.click();
    await denovo.fill(contato);
    await page.getByRole('button', { name: /Receber c.digo/i }).click();
    await caixaDoCodigo.waitFor({ timeout: 20000 });
  }
  await pausa(page, 1200); // o log é escrito DEPOIS da resposta HTTP

  const codigo = ultimoCodigo(nome);
  const cx = page.locator('input[maxlength="6"]').first();
  await cx.click();
  await cx.fill(codigo);
  const btn = page.getByRole('button', { name: /Entrar|Confirmar|Validar|Acessar/i }).first();
  if ((await btn.count()) && (await btn.isEnabled())) await btn.click();
  await page.waitForURL(/\/cliente\/painel/, { timeout: 30000 });
  await pausa(page, 1500);
}

export async function saiResponsavel(page: Page) {
  const sair = page.getByRole('button', { name: /^Sair$/ }).first();
  if (await sair.count()) {
    await sair.click();
    await pausa(page, 2000);
  }
  await page.context().clearCookies();
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* contexto sem storage — nada a limpar */
    }
  });
}

// ── LEITURA DE TELA ────────────────────────────────────────────────────────

export async function texto(page: Page, seletor = 'main'): Promise<string> {
  return page.evaluate(s => {
    const el = document.querySelector(s) ?? document.body;
    return (el as HTMLElement).innerText.replace(/\n{3,}/g, '\n\n').trim();
  }, seletor);
}

/**
 * Todo valor em reais que a tela DESENHA, em ordem de aparição.
 *
 * Lê o texto renderizado de propósito, nunca o payload: a pergunta que a
 * bateria faz é "o cliente VÊ o preço?", e um payload correto com tela vazia
 * foi exatamente o defeito de 20/09 (`pricing.subtotal` chegava como string
 * `"74100"` e a guarda `typeof === "number"` apagava o número).
 */
export async function reaisNaTela(page: Page, seletor = 'main'): Promise<number[]> {
  const t = await texto(page, seletor);
  return [...t.matchAll(/R\$\s*([\d.]+,\d{2})/g)].map(m =>
    Number(m[1].replace(/\./g, '').replace(',', '.')),
  );
}

/** As opções visíveis de um combobox já aberto. */
export async function opcoes(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="option"],[cmdk-item]')].map(e =>
      (e.textContent || '').trim().replace(/\s+/g, ' '),
    ),
  );
}

export async function abreCombo(page: Page, rotulo: string | RegExp) {
  const c = page.locator('[role="combobox"]').filter({ hasText: rotulo }).first();
  await c.scrollIntoViewIfNeeded();
  await c.click();
  await pausa(page, 1200);
}

// ── A SESSÃO, PARA FALAR COM A API ─────────────────────────────────────────

/**
 * O token da sessão do portal, lido de onde o próprio cliente o guarda.
 *
 * Serve aos cenários que precisam perguntar à API o que a TELA não mostra — um
 * 403 do portão do pedido de compra, por exemplo, que a tela traduz em botão
 * desabilitado. A entrada continua sendo pela tela: o token é consequência de
 * um login de verdade, não um atalho para pular a cerimônia.
 */
export async function tokenDoPortal(page: Page): Promise<string> {
  const t = await page.evaluate(() => {
    try {
      return localStorage.getItem('ankaa_cliente_token');
    } catch {
      return null;
    }
  });
  if (!t) throw new Error('sem token de portal — o login não completou');
  return t;
}

export interface RespostaApi {
  status: number;
  body: any;
}

/** Uma chamada à API com a sessão do portal. */
export async function apiPortal(
  token: string,
  caminho: string,
  init: { method?: string; body?: any } = {},
): Promise<RespostaApi> {
  const { API } = await import('./env');
  const r = await fetch(`${API}${caminho}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  let body: any = null;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  return { status: r.status, body };
}

/**
 * ⚠️ O COOLDOWN DE 120 SEGUNDOS — a armadilha que derruba uma bateria inteira.
 *
 * `responsible-auth-challenge.service.ts:61,157-164` recusa um segundo pedido de
 * código para o MESMO contato dentro de 120 s, com 400 "Aguarde 120 segundos".
 * Uma bateria que faça login duas vezes com o mesmo contato — ou que seja
 * reexecutada logo em seguida — falha no segundo, e a falha aparece como
 * "Timeout esperando input[maxlength=6]", que não diz nada sobre cooldown.
 *
 * Por isso a sessão é ABERTA UMA VEZ por contato e reusada. Este cache é por
 * processo; entre corridas, espace-as ou use contatos diferentes.
 */
const sessoes = new Map<string, string>();

/**
 * E O CACHE TAMBÉM EM DISCO, entre corridas.
 *
 * O cooldown é de 120 s POR CONTATO e não conhece processos: rodar a bateria
 * duas vezes seguidas — que é exatamente o que se faz ao consertar um defeito e
 * remedir — faz a segunda esperar dois minutos em cada cenário. A sessão do
 * portal vale muito mais que isso (é um token opaco com expiração própria),
 * então guardá-la é reusar o que já é válido, não burlar o limite: o cooldown
 * protege o ENVIO de código, e aqui nenhum código novo é pedido.
 *
 * A sessão é conferida contra `GET /cliente/auth/eu` antes de ser reusada — um
 * token revogado no banco tem de cair aqui, e não três asserções adiante como
 * um 401 misterioso.
 */
const ARQUIVO_DE_SESSOES = path.join(__dirname, '..', 'artifacts', 'sessoes.json');

function sessoesDoDisco(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_DE_SESSOES, 'utf8'));
  } catch {
    return {};
  }
}

function gravaSessao(contato: string, token: string) {
  const todas = sessoesDoDisco();
  todas[contato] = token;
  fs.mkdirSync(path.dirname(ARQUIVO_DE_SESSOES), { recursive: true });
  fs.writeFileSync(ARQUIVO_DE_SESSOES, JSON.stringify(todas, null, 2));
}

async function aindaVale(token: string): Promise<boolean> {
  const r = await apiPortal(token, '/cliente/auth/eu');
  return r.status === 200;
}

export async function sessaoDoPortal(page: Page, contato: string, nome?: string): Promise<string> {
  if (!sessoes.has(contato)) {
    const doDisco = sessoesDoDisco()[contato];
    if (doDisco && (await aindaVale(doDisco))) sessoes.set(contato, doDisco);
  }
  const cacheado = sessoes.get(contato);
  if (cacheado) {
    await page.goto(`${WEB}/cliente/painel`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(t => localStorage.setItem('ankaa_cliente_token', t), cacheado);
    await page.reload({ waitUntil: 'networkidle' });
    await pausa(page, 1200);
    return cacheado;
  }
  await entraResponsavel(page, contato, nome);
  const token = await tokenDoPortal(page);
  sessoes.set(contato, token);
  gravaSessao(contato, token);
  return token;
}
