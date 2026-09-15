/**
 * Objetos de página do e2e — TUDO passa pela tela.
 *
 * Nenhum helper daqui chama endpoint para "adiantar" um passo: o ponto da
 * bateria é justamente que o formulário, o combobox e o gate de gravação
 * participem. Onde a UI não oferece caminho, o cenário FALHA em vez de
 * contornar por API — um contorno esconderia exatamente o defeito procurado.
 */
import type { Page, Locator } from 'playwright';

export const BASE = process.env.QA_WEB ?? 'http://localhost:5174';
export const API = process.env.QA_API ?? 'http://localhost:3031';

export const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Senha dos usuários do banco de teste (clone descartável). */
export const QA_PASS = process.env.QA_PASS ?? 'Teste@2026';

export async function login(page: Page, email: string, pass = QA_PASS) {
  await page.goto(`${BASE}/autenticacao/entrar`, { waitUntil: 'networkidle' });
  await page.locator('input[type="text"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(pass);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(u => !u.pathname.includes('autenticacao'), { timeout: 40000 });
  await pause(page, 1500);
  await dismissModals(page);
}

/**
 * Fecha o que estiver por cima da tela no primeiro acesso de um usuário.
 *
 * O aviso de novidades ("Chegaram as novas Tabelas…") é modal e intercepta
 * QUALQUER clique — sem fechá-lo, um usuário que nunca entrou no sistema vê a
 * bateria inteira falhar por "botão não encontrado", e a falha não é do botão.
 */
export async function dismissModals(page: Page) {
  for (let i = 0; i < 3; i++) {
    const dlg = page.locator('[role="dialog"]');
    if (!(await dlg.count())) return;
    const naoMostrar = dlg.getByRole('button', { name: /N.o mostrar novamente/i }).first();
    if (await naoMostrar.count()) { await naoMostrar.click(); await pause(page, 900); continue; }
    const fechar = dlg.getByRole('button', { name: /^(Close|Fechar)$/i }).first();
    if (await fechar.count()) { await fechar.click(); await pause(page, 900); continue; }
    await page.keyboard.press('Escape');
    await pause(page, 800);
  }
}

export async function comboOptions(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="option"],[cmdk-item]')].map(e =>
      (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
    ),
  );
}

export async function openCombo(page: Page, triggerText: string | RegExp) {
  const t = page.locator('[role="combobox"]').filter({ hasText: triggerText }).first();
  await t.scrollIntoViewIfNeeded();
  await t.click();
  await pause(page, 450);
}

export async function pickCombo(
  page: Page,
  triggerText: string | RegExp,
  search: string | null,
  option: RegExp,
) {
  await openCombo(page, triggerText);
  if (search) {
    await page.locator('input[placeholder*="esquisar" i], input[placeholder*="igite" i]').last().fill(search);
    await pause(page, 1100);
  }
  const opt = page.getByRole('option', { name: option }).first();
  if (await opt.count()) {
    await opt.click();
    await pause(page, 350);
    return;
  }
  throw new Error(`opção ${option} ausente; havia: ${JSON.stringify((await comboOptions(page)).slice(0, 25))}`);
}

/** Texto do bloco visível que contém uma âncora — para ler totais da tela. */
export async function blockText(page: Page, anchor: string, maxLen = 1200): Promise<string> {
  return page.evaluate(
    ([a, max]: [string, number]) => {
      const nodes = [...document.querySelectorAll('div,section,aside')] as HTMLElement[];
      const hits = nodes.filter(d => {
        const t = d.innerText || '';
        return t.includes(a) && t.length < max;
      });
      if (!hits.length) return '';
      // o menor bloco que ainda contém a âncora é o mais específico
      hits.sort((x, y) => (x.innerText || '').length - (y.innerText || '').length);
      return hits[0].innerText || '';
    },
    [anchor, maxLen] as [string, number],
  );
}

export async function stepTitles(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="form-step-"]')].map(e =>
      (e.textContent || '').trim().replace(/\s+/g, ' '),
    ),
  );
}

export async function next(page: Page) {
  await page.getByRole('button', { name: /^Pr.ximo$/ }).click();
  await pause(page, 1600);
}

export async function prev(page: Page) {
  await page.getByRole('button', { name: /^Anterior$/ }).click();
  await pause(page, 1400);
}

export interface QuoteSpec {
  name: string;
  customer: RegExp;
  customerSearch: string;
  category?: RegExp;
  /** "8101 8104" = intervalo (4 veículos); "8101" = um só. */
  serials: string;
  orderNumber?: string;
  responsibles?: string[];
  /** clientes adicionais em "Faturar Para" */
  extraBillingCustomers?: { search: string; option: RegExp }[];
  /** `customer` só existe quando o orçamento tem 2+ clientes de faturamento:
   *  cada serviço declara para quem é faturado. */
  services: { search: string; option: RegExp; amount: string; customer?: RegExp }[];
  discount?: { type: RegExp; value: string };
  /** por cliente, na ordem dos passos "Cliente N" */
  billing?: ('JOINT' | 'PER_TASK')[];
  paymentCondition?: RegExp;
  /** Caminho de uma imagem para "Layout Aprovados" — é o que dá conteúdo à seção LAYOUT. */
  layoutFile?: string;
}

export interface CreateResult {
  url: string;
  /** O que a tela de SERVIÇOS mostrou de subtotal/desconto/total. */
  servicesText: string;
  /** O que o RESUMO mostrou antes de gravar — é a tela que o comercial confere. */
  reviewText: string;
}

/** Preenche o assistente inteiro e grava. */
export async function createQuote(page: Page, s: QuoteSpec): Promise<CreateResult> {
  await page.goto(`${BASE}/financeiro/orcamento/cadastrar`, { waitUntil: 'networkidle' });
  await pause(page, 2000);

  // ── 1. Tarefa ───────────────────────────────────────────────────────────
  await page.getByPlaceholder('Ex: Pintura completa do caminhão').fill(s.name);
  await pickCombo(page, 'Selecione um cliente', s.customerSearch, s.customer);
  if (s.category) await pickCombo(page, 'Selecione a categoria', null, s.category);
  const serial = page.getByPlaceholder(/Digite um n.mero/i);
  await serial.fill(s.serials);
  await serial.press('Enter');
  await pause(page, 900);
  if (s.orderNumber) {
    // "Ex: 12345" também é o placeholder do chassi; o pedido é o campo rotulado.
    await page.getByRole('textbox', { name: /N.*do Pedido/i }).first().fill(s.orderNumber);
  }

  if (s.responsibles?.length) {
    await page.getByRole('button', { name: /^Respons/ }).click();
    await pause(page, 1000);
    // "Adicionar Responsável" NÃO grava: ele acrescenta uma LINHA VAZIA. A
    // primeira linha já vem pronta, então o botão só é usado a partir do
    // segundo. Preencher sempre a PRIMEIRA linha trocaria um responsável pelo
    // outro e a tarefa terminaria com um só.
    for (let i = 0; i < s.responsibles.length; i++) {
      if (i > 0) {
        await page.getByRole('button', { name: /Adicionar Respons/i }).first().click();
        await pause(page, 900);
      }
      const r = s.responsibles[i];
      const vazio = page.locator('[role="combobox"]').filter({ hasText: 'Selecione ou cadastre novo' }).last();
      await vazio.scrollIntoViewIfNeeded();
      await vazio.click();
      await pause(page, 500);
      await page.locator('input[placeholder*="esquisar" i], input[placeholder*="igite" i]').last().fill(r);
      await pause(page, 1200);
      const opt = page.getByRole('option', { name: new RegExp(r, 'i') }).first();
      if (!(await opt.count())) throw new Error(`responsável ${r} não achado: ${JSON.stringify(await comboOptions(page))}`);
      await opt.click();
      await pause(page, 700);
    }
  }
  await next(page);

  // ── 2. Informações (prazos e "Faturar Para") ────────────────────────────
  for (const extra of s.extraBillingCustomers ?? []) {
    await pickCombo(page, /selecionado/, extra.search, extra.option);
    await page.keyboard.press('Escape');
    await pause(page, 600);
  }
  if (s.layoutFile) {
    // Sem layout anexado a seção LAYOUT nasce vazia, e um recorte "com layout"
    // fica indistinguível de um sem — que é justamente o que se quer provar.
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles(s.layoutFile);
    await pause(page, 6000);
  }
  await next(page);

  // ── 3. Serviços ─────────────────────────────────────────────────────────
  for (let i = 0; i < s.services.length; i++) {
    if (i > 0) {
      await page.getByRole('button', { name: /Adicionar Servi/i }).click();
      await pause(page, 700);
    }
    const svc = s.services[i];
    const trigger = page.locator('[role="combobox"]').filter({ hasText: 'Selecione ou digite' }).last();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await pause(page, 450);
    await page.locator('input[placeholder*="esquisar" i], input[placeholder*="igite" i]').last().fill(svc.search);
    await pause(page, 900);
    const opt = page.getByRole('option', { name: svc.option }).first();
    if (await opt.count()) await opt.click();
    else await page.locator('[role="option"]').first().click();
    await pause(page, 400);
    const amounts = page.getByPlaceholder('R$ 0,00');
    await amounts.nth(i).fill(svc.amount);
    await pause(page, 500);
    if (svc.customer) {
      // Com dois clientes cada serviço declara para QUEM é faturado. Sem isso o
      // resumo fecha em R$ 0,00 e o assistente recusa gravar — corretamente.
      const alvo = page.locator('[role="combobox"]').filter({ hasText: /^Cliente$/ }).last();
      await alvo.evaluate((el: HTMLElement) => { el.scrollIntoView({ block: 'center' }); el.click(); });
      await pause(page, 900);
      const o = page.getByRole('option', { name: svc.customer }).first();
      if (!(await o.count())) throw new Error(`cliente do serviço não achado: ${JSON.stringify(await comboOptions(page))}`);
      await o.click();
      await pause(page, 600);
    }
  }
  if (s.discount) {
    await pickCombo(page, /^Nenhum$/, null, s.discount.type);
    await page.getByPlaceholder(/R\$ 0,00/).last().fill(s.discount.value);
    await pause(page, 500);
  }
  const servicesText = await blockText(page, 'TOTAL', 900);
  await next(page);

  // ── 4..N. Um passo por cliente de faturamento ───────────────────────────
  //
  // Quantos são, o PRÓPRIO STEPPER diz: um passo "Cliente N" por cliente de
  // faturamento. Detectar o passo pelo texto "Faturamento e Pagamento" parecia
  // equivalente e não é — o RESUMO repete esse título, e o laço então tratava a
  // revisão como mais um passo de cliente e mexia no seletor errado.
  // Conta pelos PASSOS, não pelos botões: o passo ATUAL não é um botão, então
  // no primeiro cliente o `getByRole('button')` via só o "Cliente 2" e o laço
  // rodava uma vez só — o assistente parava no segundo cliente e "Salvar" nunca
  // aparecia.
  const nClientes = (await stepTitles(page)).filter(t => /Cliente \d+/.test(t)).length;
  for (let i = 0; i < Math.max(1, nClientes); i++) {
    if ((await page.getByText(/Faturamento e Pagamento/i).count()) === 0) {
      throw new Error(`esperava o passo do cliente ${i + 1} e não achei "Faturamento e Pagamento"`);
    }
    if (s.billing?.[i] === 'PER_TASK') {
      await pickCombo(page, /Fatura .nica para os/, null, /Uma fatura por ve.culo/i);
    }
    if (s.paymentCondition) await setPaymentCondition(page, s.paymentCondition);
    await next(page);
  }

  // ── Resumo → gravar ─────────────────────────────────────────────────────
  const reviewText = await page.evaluate(() => {
    const m = document.querySelector('main') as HTMLElement | null;
    return (m?.innerText ?? '').replace(/\n{2,}/g, '\n');
  });
  const submit = page.getByRole('button', { name: /^(Salvar|Cadastrar|Finalizar|Criar)/ }).last();
  await submit.scrollIntoViewIfNeeded();
  await submit.click();
  await page.waitForURL(u => !u.pathname.includes('cadastrar'), { timeout: 60000 });
  await pause(page, 2500);
  return { url: page.url(), servicesText, reviewText };
}

// ═══════════════════════════════════════════════════════════════════════════
// DETALHE DO ORÇAMENTO — é onde os LOTES existem (os veículos já nasceram).
// ═══════════════════════════════════════════════════════════════════════════

export async function openQuoteDetail(page: Page, taskId: string) {
  await page.goto(`${BASE}/financeiro/orcamento/detalhes/${taskId}`, { waitUntil: 'networkidle' });
  await pause(page, 3500);
}

export async function gotoCustomerStep(page: Page, n = 1) {
  await page.getByRole('button', { name: new RegExp(`Cliente ${n}`) }).click();
  await pause(page, 2500);
}

/**
 * O compositor de lotes: uma linha por veículo, cada uma com um seletor "Lote N".
 *
 * As linhas RE-RENDERIZAM a cada mudança (a lista é reordenada pelo lote), então
 * nada aqui guarda referência de elemento entre dois cliques: cada atribuição
 * relê a ordem, age pelo índice e CONFERE — e tenta de novo se não pegou.
 */
export async function readLots(page: Page): Promise<{ serial: string; lot: string }[]> {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('div.divide-y > div')];
    const out: { serial: string; lot: string }[] = [];
    for (const r of rows) {
      const t = ((r as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
      // A linha pode trazer o nº do pedido no meio: "98790 Pedido PEDF3 Lote 1".
      const m = t.match(/^(\S+)\s+(?:.*\s)?(Lote \d+)$/);
      if (m) out.push({ serial: m[1], lot: m[2] });
    }
    return out;
  });
}

async function assignLot(page: Page, serial: string, lot: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await readLots(page);
    const idx = rows.findIndex(r => r.serial === serial);
    if (idx < 0) throw new Error(`veículo ${serial} não está no compositor: ${JSON.stringify(rows)}`);
    if (rows[idx].lot === `Lote ${lot}`) return;
    const combo = page.locator('div.divide-y > div [role="combobox"]').nth(idx);
    await combo.scrollIntoViewIfNeeded();
    await combo.click();
    await pause(page, 500);
    const opt = page.getByRole('option', { name: new RegExp(`^Lote ${lot}$`) }).first();
    if (!(await opt.count())) {
      const opts = await comboOptions(page);
      await page.keyboard.press('Escape');
      throw new Error(`"Lote ${lot}" não é opção para ${serial}; havia ${JSON.stringify(opts)}`);
    }
    await opt.click();
    await pause(page, 700);
    const after = await readLots(page);
    if (after.find(r => r.serial === serial)?.lot === `Lote ${lot}`) return;
  }
  throw new Error(`não consegui pôr ${serial} no Lote ${lot} (a tela desfaz a escolha)`);
}

/** Quantos lotes o compositor mostra agora. */
async function lotCount(page: Page): Promise<number> {
  const rows = await readLots(page);
  return new Set(rows.map(r => r.lot)).size;
}

/** Compõe os lotes pela tela: [['9201','9202'],['9203','9204']]. */
export async function setLots(page: Page, groups: string[][]) {
  const trigger = page.locator('[role="combobox"]').filter({ hasText: /Fatura .nica para os|Uma fatura por ve.culo|Lotes —/ }).first();
  const atual = (await trigger.textContent())?.trim() ?? '';
  if (!/Lotes/.test(atual)) {
    await pickCombo(page, /Fatura .nica para os|Uma fatura por ve.culo/, null, /Lotes/);
    await pause(page, 1200);
  }
  // O compositor monta depois da troca de modo. Sem esperar por ele, a leitura
  // volta vazia e o erro sai como "veículo X não está no compositor" — que
  // descreve o sintoma e esconde a causa.
  for (let i = 0; i < 20 && (await readLots(page)).length === 0; i++) await pause(page, 500);
  if ((await readLots(page)).length === 0) {
    const visivel = await page.evaluate(() => ((document.querySelector('main') as HTMLElement)?.innerText ?? '').slice(-600));
    throw new Error(`o compositor de lotes não apareceu. Fim da tela: ${visivel.replace(/\n/g, ' | ')}`);
  }
  while ((await lotCount(page)) < groups.length) {
    const antes = await lotCount(page);
    await page.getByRole('button', { name: /Novo lote/ }).click();
    await pause(page, 700);
    // "Novo lote" sem veículo nenhum não conta como lote na leitura das linhas:
    // a contagem só sobe quando o primeiro veículo entra nele. Sai do laço pelo
    // número de grupos pedidos e deixa a atribuição resolver.
    if ((await lotCount(page)) === antes) break;
  }
  for (let g = 0; g < groups.length; g++) {
    for (const serial of groups[g]) await assignLot(page, serial, g + 1);
  }
}

/**
 * Grava o formulário de detalhe.
 *
 * O botão de gravar mora no passo RESUMO — nos passos do meio só há
 * "Anterior/Próximo". Ir ao resumo antes de salvar não é conveniência do teste:
 * é o caminho que o operador percorre.
 */
export async function saveDetail(page: Page): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const nx = page.getByRole('button', { name: /^Pr.ximo$/ });
    if ((await nx.count()) === 0) break;
    await nx.first().click();
    await pause(page, 2200);
  }
  for (const re of [/^Salvar/, /^Atualizar/, /^Gravar/, /^Confirmar/]) {
    const b = page.getByRole('button', { name: re }).last();
    if (await b.count()) {
      const label = (await b.textContent())?.trim() ?? '';
      await b.scrollIntoViewIfNeeded();
      await b.click();
      await pause(page, 4000);
      return label;
    }
  }
  const all = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(Boolean),
  );
  throw new Error(`nenhum botão de gravar; botões visíveis: ${JSON.stringify(all.slice(0, 30))}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// FATURAMENTO — aprovação, NFS-e e boleto, tudo pela tela.
// ═══════════════════════════════════════════════════════════════════════════

export async function goToLastStep(page: Page) {
  for (let i = 0; i < 8; i++) {
    const n = page.getByRole('button', { name: /^Pr.ximo$/ });
    if (!(await n.count())) return;
    await n.first().click();
    await pause(page, 2000);
  }
}

/** Troca o status do orçamento pelo seletor do painel e grava. */
export async function setQuoteStatus(page: Page, option: RegExp) {
  // Todos os rótulos de TASK_QUOTE_STATUS: depois da primeira aprovação o
  // seletor passa a dizer "A Vencer", e um filtro com três rótulos não o achava
  // mais — a segunda fatia ficava sem aprovar por um detalhe de locator.
  const combo = page.locator('[role="combobox"]').filter({
    hasText: /Pendente|Assinado|Aguardando Reanálise|Or.amento Aprovado|Faturamento Aprovado|A Vencer|Vencido|Parcial|Liquidado|Cancelado/,
  }).first();
  await combo.scrollIntoViewIfNeeded();
  await combo.click();
  await pause(page, 700);
  const opt = page.getByRole('option', { name: option }).first();
  if (!(await opt.count())) {
    throw new Error(`status ${option} indisponível; havia ${JSON.stringify(await comboOptions(page))}`);
  }
  await opt.click();
  await pause(page, 1500);
  const salvar = page.getByRole('button', { name: /^Salvar$/ });
  if (await salvar.count()) {
    await salvar.first().click();
    await pause(page, 6000);
  }
  // Alguns caminhos pedem confirmação num diálogo.
  const dlg = page.locator('[role="dialog"], [role="alertdialog"]');
  if (await dlg.count()) {
    const ok = dlg.getByRole('button', { name: /Confirmar|Aprovar|Sim|Continuar/i }).last();
    if (await ok.count()) { await ok.click(); await pause(page, 8000); }
  }
}

export async function openBillingDetail(page: Page, taskId: string) {
  await page.goto(`${BASE}/financeiro/faturamento/detalhes/${taskId}`, { waitUntil: 'networkidle' });
  await pause(page, 4000);
}

/** Define a condição de pagamento no passo do cliente (é o último "Selecione..."). */
export async function setPaymentCondition(page: Page, option: RegExp) {
  // Pelo RÓTULO, não pela posição: "Situação Cadastral" também diz
  // "Selecione..." na mesma tela, e um `.last()` posicional escolhia ela — o
  // teste então "preenchia" a condição mexendo na situação cadastral, e a
  // aprovação seguia barrada sem dizer por quê.
  //
  // E ESPERA o rótulo aparecer: o bloco do cliente monta depois de uma consulta,
  // e agir cedo demais não achava nada. Antes isso devolvia `false` calado, que
  // é como um orçamento sem condição de pagamento chegou até a aprovação.
  const rotulo = page.getByText(/^Condição de Pagamento\s*\*?$/).first();
  await rotulo.waitFor({ state: 'attached', timeout: 20000 });
  const abriu = await page.evaluate(() => {
    const rot = [...document.querySelectorAll('label,span,div,p')].find(
      e => (e.textContent || '').trim().replace(/\s+/g, ' ').replace(/\s*\*$/, '') === 'Condição de Pagamento',
    );
    if (!rot) return false;
    for (const c of [...document.querySelectorAll('[role="combobox"]')]) {
      if (rot.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) {
        (c as HTMLElement).scrollIntoView({ block: 'center' });
        (c as HTMLElement).click();
        return true;
      }
    }
    return false;
  });
  if (!abriu) throw new Error('não achei o seletor de condição de pagamento na tela');
  await pause(page, 1200);
  if (process.env.QA_DEBUG) {
    const diag = await page.evaluate(() => ({
      listboxes: document.querySelectorAll('[role="listbox"]').length,
      options: [...document.querySelectorAll('[role="option"]')].map(e => (e.textContent || '').trim()).slice(0, 12),
      combos: [...document.querySelectorAll('[role="combobox"]')].map(e => `${(e.textContent || '').trim().slice(0, 28)}|${e.getAttribute('data-state')}|${(e as HTMLButtonElement).disabled}`),
    }));
    console.log('   [cond]', JSON.stringify(diag));
  }
  const opt = page.getByRole('option', { name: option }).first();
  if (!(await opt.count())) {
    throw new Error(`condição ${option} indisponível; havia ${JSON.stringify(await comboOptions(page))}`);
  }
  await opt.click();
  await pause(page, 1200);
  const conferido = await page.evaluate(() => {
    const rot = [...document.querySelectorAll('label,span,div,p')].find(
      e => (e.textContent || '').trim().replace(/\s+/g, ' ').replace(/\s*\*$/, '') === 'Condição de Pagamento',
    );
    const bloco = rot?.parentElement?.parentElement as HTMLElement | undefined;
    return (bloco?.innerText ?? '').replace(/\s+/g, ' ');
  });
  if (/Selecione\.\.\./.test(conferido)) {
    throw new Error(`a condição não ficou gravada na tela: "${conferido.slice(0, 120)}"`);
  }
  return true;
}
