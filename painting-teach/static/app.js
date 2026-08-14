/* Estação de marcação — SPA sem dependência nenhuma.
 *
 * Regra de ouro: esta página NÃO calcula nada. Tudo que ela mostra vem do
 * `plan.json` gerado pelo motor + `plan.py`. Se um número está errado aqui, ele
 * está errado no motor — que é exatamente o que se quer descobrir.
 */

const VERBOS = {
  escala: ['MEDIDA ERRADA', 'SUBSTRATO ERRADO', 'SISTEMA ERRADO', 'FUNDO ERRADO',
           'NÃO É ESTA FACE'],
  elemento: ['FUNDIR COM…', 'SEPARAR', 'NÃO É ELEMENTO', 'É FAIXA', 'NÃO É FAIXA',
             'É AEROGRAFIA', 'ROTA ERRADA', 'TRAÇO ERRADO', 'CORES ERRADAS',
             'CAIXA ERRADA'],
  descartados: ['ISTO É ELEMENTO', 'DESCARTE CERTO', 'FALTOU DESCARTAR'],
  sessoes: ['VÃO JUNTAS', 'NÃO PODEM JUNTAS', 'ORDEM ERRADA', 'FALTA SESSÃO'],
  passo: ['PASSO NÃO EXISTE', 'FALTA PASSO ANTES', 'FALTA PASSO DEPOIS',
          'ORDEM ERRADA', 'TEMPO IRREAL', 'MATERIAL ERRADO', 'DESCRIÇÃO ERRADA',
          'IMAGEM NÃO BATE'],
  calculo: ['VALOR ERRADO', 'FÓRMULA ERRADA', 'PARÂMETRO ERRADO', 'NÃO SE COBRA ISSO',
            'FALTA MATERIAL'],
  totais: ['TEMPO TOTAL ERRADO', 'FALTA ETAPA', 'SOBRA ETAPA'],
  geral: []
};

const ROTA_TAG = {
  FITA_AMARELA: ['ok', 'fita amarela'],
  FITA_BRANCA: ['warn', 'fita branca + corte'],
  ADESIVO_SOBRE_CHAPA: ['ok', 'adesivo sobre chapa'],
  ADESIVO_SOBRE_GERAL: ['ok', 'adesivo sobre pintura geral'],
  AEROGRAFIA: ['warn', 'aerografia'],
  ADESIVO_SOBRE_VERNIZ: ['cut', 'adesivo sobre verniz'],
  CORTE_MANUAL: ['warn', 'corte manual']
};

const FONTE_TAG = { DONO: 'ok', MEDIDO: 'ok', SEED: 'info', ESTIMADO: 'warn', INVENTADO: 'cut' };

const S = { indice: null, arte: null, slug: null, aba: 'arte', filtro: '', ordem: null };
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const el = (tag, cls, txt) => { const n = document.createElement(tag);
  if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const num = (v, casas = 2) => (v == null ? '—' :
  Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }));

/* ------------------------------------------------------------- carga ---- */

async function inicio() {
  S.indice = await (await fetch('/api/index')).json();
  $('#sub-run').textContent =
    `${S.indice.engineVersion} · ${S.indice.completaram}/${S.indice.total} artes · ` +
    `escala ${S.indice.referencia} · ${S.indice.geradoEm.replace('T', ' ')}`;
  renderLista();
  atualizaProgresso();

  $('#busca').addEventListener('input', (e) => { S.filtro = e.target.value; renderLista(); });
  document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.aba').forEach((x) => x.classList.toggle('is-on', x === b));
    S.aba = b.dataset.aba;
    if (S.aba === 'painel') renderPainel();
    else if (S.aba === 'params') renderParams();
    else if (S.arte) renderArte(); else $('#conteudo').innerHTML =
      '<div class="vazio">Escolha uma arte na lista.</div>';
  }));

  const inicial = location.hash.slice(1);
  const alvo = S.indice.artes.find((a) => a.slug === inicial && a.ok)
            || S.indice.artes.find((a) => a.ok);
  if (alvo) abrir(alvo.slug);
}

function atualizaProgresso() {
  const artes = S.indice.artes.filter((a) => a.ok);
  const revisadas = artes.filter((a) => a.status_marcacao === 'REVISADA').length;
  const total = S.indice.artes.reduce((s, a) => s + (a.marcacoes || 0), 0);
  $('#progresso').textContent =
    `${revisadas}/${artes.length} artes revisadas · ${total} observações`;
}

function renderLista() {
  const caixa = $('#lista-itens');
  caixa.innerHTML = '';
  const filtro = S.filtro.toLowerCase();
  S.indice.artes
    .filter((a) => !filtro || a.arte.toLowerCase().includes(filtro))
    .forEach((a) => {
      const b = el('button', 'item' + (a.slug === S.slug ? ' is-on' : '') +
                              (a.ok ? '' : ' falhou') +
                              (a.status_marcacao === 'REVISADA' ? ' revisada' : ''));
      const n = el('span', 'nome', a.arte.replace(/\.png$/i, ''));
      if (a.marcacoes) { const c = el('span', 'n', a.marcacoes); n.prepend(c); }
      b.append(n);
      b.append(el('span', 'meta', a.ok
        ? `${a.elementos} el · ${a.passos} passos · ${num(a.minutos / 60, 1)} h · ${a.fundo === 'GENERAL_PAINT' ? 'geral' : 'chapa'}`
        : 'não completou o pipeline'));
      if (a.ok) b.addEventListener('click', () => abrir(a.slug));
      caixa.append(b);
    });
}

async function abrir(slug) {
  S.slug = slug;
  location.hash = slug;
  S.aba = 'arte';
  document.querySelectorAll('.aba').forEach((x) => x.classList.toggle('is-on', x.dataset.aba === 'arte'));
  S.arte = await (await fetch(`/api/art/${slug}`)).json();
  renderLista();
  renderArte();
  $('#conteudo').scrollTop = 0;
}

/* ---------------------------------------------------------- marcação ---- */

const pendentes = new Map();

function obsDe(alvo) {
  return S.arte.marcas.observacoes[alvo] ||
    { verbos: [], texto: '', escopo: 'SO_ESTA_ARTE', condicao: '', confianca: 'CERTO' };
}

function agenda(alvo, obs, bloco) {
  S.arte.marcas.observacoes[alvo] = obs;
  bloco.classList.toggle('tem', !!(obs.texto.trim() || obs.verbos.length));
  clearTimeout(pendentes.get(alvo));
  const aviso = $('.salvo', bloco);
  aviso.textContent = '…';
  pendentes.set(alvo, setTimeout(async () => {
    const r = await fetch(`/api/marks/${S.slug}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ observacoes: { [alvo]: obs }, arte: S.arte.arte,
                             engineVersion: S.arte.engine.version })
    });
    const d = await r.json();
    aviso.textContent = 'salvo';
    setTimeout(() => { if (aviso.textContent === 'salvo') aviso.textContent = ''; }, 2500);
    const item = S.indice.artes.find((a) => a.slug === S.slug);
    if (item) { item.marcacoes = d.observacoes; renderLista(); atualizaProgresso(); }
  }, 600));
}

function blocoMarca(alvo, tipo) {
  const frag = $('#tpl-marca').content.cloneNode(true);
  const bloco = frag.firstElementChild;
  const obs = obsDe(alvo);
  bloco.classList.toggle('tem', !!(obs.texto.trim() || obs.verbos.length));

  const caixaVerbos = $('.verbos', bloco);
  (VERBOS[tipo] || []).forEach((v) => {
    const b = el('button', 'verbo' + (obs.verbos.includes(v) ? ' is-on' : ''), v);
    b.addEventListener('click', () => {
      const i = obs.verbos.indexOf(v);
      if (i >= 0) obs.verbos.splice(i, 1); else obs.verbos.push(v);
      b.classList.toggle('is-on');
      agenda(alvo, obs, bloco);
    });
    caixaVerbos.append(b);
  });
  if (!(VERBOS[tipo] || []).length) caixaVerbos.remove();

  const ta = $('textarea', bloco);
  ta.value = obs.texto || '';
  ta.addEventListener('input', () => { obs.texto = ta.value; agenda(alvo, obs, bloco); });

  const escopo = $('.escopo', bloco);
  const condWrap = $('.cond-wrap', bloco);
  const cond = $('.condicao', bloco);
  escopo.value = obs.escopo || 'SO_ESTA_ARTE';
  cond.value = obs.condicao || '';
  condWrap.hidden = escopo.value !== 'SEMPRE_QUE';
  escopo.addEventListener('change', () => {
    obs.escopo = escopo.value;
    condWrap.hidden = escopo.value !== 'SEMPRE_QUE';
    agenda(alvo, obs, bloco);
  });
  cond.addEventListener('input', () => { obs.condicao = cond.value; agenda(alvo, obs, bloco); });

  $$('.conf', bloco).forEach((b) => {
    b.classList.toggle('is-on', (obs.confianca || 'CERTO') === b.dataset.conf);
    b.addEventListener('click', () => {
      obs.confianca = b.dataset.conf;
      $$('.conf', bloco).forEach((x) => x.classList.toggle('is-on', x === b));
      agenda(alvo, obs, bloco);
    });
  });
  return bloco;
}
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/* ------------------------------------------------------------- a arte --- */

function renderArte() {
  const a = S.arte;
  const c = $('#conteudo');
  c.innerHTML = '';
  const w = el('div', 'wrap');
  c.append(w);

  w.append(el('h1', null, a.arte.replace(/\.png$/i, '')));
  const sub = el('p', 'sub-linha');
  sub.textContent = `${num(a.escala.comprimento_cm, 0)} × ${num(a.escala.altura_cm, 0)} cm · ` +
    `${num(a.escala.area_m2)} m² · substrato ${a.substrato.toLowerCase()} · ` +
    `sistema ${a.sistema.toLowerCase()} · fundo ${a.fundo.mode.replace(/_/g, ' ').toLowerCase()} ` +
    `${(a.fundo.coveragePct * 100).toFixed(0)}%`;
  w.append(sub);

  const hero = el('div', 'hero');
  const link = el('a'); link.href = `/arte/${encodeURIComponent(a.arte)}`;
  link.target = '_blank'; link.title = 'abrir a arte original em tamanho cheio';
  const himg = el('img'); himg.src = `/img/${a.slug}/img/original.jpg`; himg.loading = 'lazy';
  link.append(himg); hero.append(link); w.append(hero);

  // ---- números do plano
  const stats = el('div', 'stats');
  [['elementos', a.totais.elementos], ['passos', a.totais.passos],
   ['sessões de pintura', a.sessoes.length],
   ['tempo', `${num(a.totais.horas, 1)}<small> h</small>`],
   ['mão de obra', `${num(a.totais.mao_de_obra_brl)}<small> R$</small>`],
   ['adesivo', `${num(a.totais.area_adesivo_m2)}<small> m²</small>`],
   ['desenho pintado', `${num(a.totais.area_pintada_m2)}<small> m²</small>`],
   ['cores na paleta', a.paleta.length]].forEach(([k, v]) => {
    const s = el('div', 'stat'); s.append(el('div', 'k', k));
    const val = el('div', 'v'); val.innerHTML = v; s.append(val); stats.append(s);
  });
  w.append(stats);

  if (a.alertas.length) {
    const box = el('p', 'nota');
    a.alertas.forEach((al) => {
      const t = el('span', `tag ${al.severity === 'WARNING' ? 'warn' : 'info'}`, al.code);
      t.title = al.message; t.style.margin = '0 6px 6px 0'; box.append(t);
    });
    w.append(el('h2', null, 'Alertas do motor'), box);
  }

  // ---- premissas
  w.append(el('h2', null, 'Escala e premissas'));
  const nota = el('p', 'nota');
  nota.innerHTML = `A imagem não traz medida: a escala vem de <b>${a.escala.referencia}</b>, ` +
    `o que dá ${num(a.escala.px_por_cm_original, 2)} px/cm no original. ` +
    `Substrato e sistema de pintura foram assumidos (<b>${a.substrato.toLowerCase()}</b>, ` +
    `<b>${a.sistema.toLowerCase()}</b>) — nada na imagem os informa. ` +
    `Se qualquer uma dessas três premissas estiver errada, todo o resto desta página está.`;
  w.append(nota, blocoMarca('escala', 'escala'));

  // ---- elementos
  w.append(secaoElementos(a));

  // ---- sessões
  w.append(secaoSessoes(a));

  // ---- passos
  const h = el('h2', null, 'Passo a passo da produção');
  h.append(el('span', 'conta', `${a.passos.length} passos · ${num(a.totais.horas, 1)} h`));
  w.append(h);
  w.append(Object.assign(el('p', 'nota'), { textContent:
    'Cinza = mascarado · cor = entrando agora · kraft = empapelado · azul = verniz. ' +
    'Cada passo mostra a conta que o gerou: quantidade, fórmula, parâmetro e de onde ' +
    'o parâmetro veio.' }));
  a.passos.forEach((p) => w.append(cardPasso(p)));

  // ---- totais
  w.append(el('h2', null, 'Fechamento'));
  w.append(tabelaTotais(a));
  w.append(blocoMarca('totais', 'totais'));

  w.append(el('h2', null, 'Qualquer outra coisa'));
  w.append(Object.assign(el('p', 'nota'), { textContent:
    'O que não coube em nenhum passo: o que a produção faz e não está aqui, o que ' +
    'está aqui e a produção não faz.' }));
  w.append(blocoMarca('geral', 'geral'));

  const det = el('details', 'crua');
  det.append(el('summary', null, 'plano cru (JSON)'));
  det.append(Object.assign(el('pre'), { textContent: JSON.stringify(a, null, 1) }));
  w.append(det);

  // ---- navegação
  const nav = el('div', 'rodape-nav');
  const artes = S.indice.artes.filter((x) => x.ok);
  const i = artes.findIndex((x) => x.slug === S.slug);
  const ant = el('button', 'btn', i > 0 ? `← ${artes[i - 1].arte}` : '');
  if (i > 0) ant.addEventListener('click', () => abrir(artes[i - 1].slug)); else ant.hidden = true;
  const rev = el('button', 'btn',
    S.arte.marcas.status === 'REVISADA' ? '✓ revisada' : 'marcar como revisada');
  rev.addEventListener('click', async () => {
    const novo = S.arte.marcas.status === 'REVISADA' ? 'PENDENTE' : 'REVISADA';
    S.arte.marcas.status = novo;
    await fetch(`/api/marks/${S.slug}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: novo, arte: S.arte.arte }) });
    rev.textContent = novo === 'REVISADA' ? '✓ revisada' : 'marcar como revisada';
    const item = S.indice.artes.find((x) => x.slug === S.slug);
    if (item) { item.status_marcacao = novo; renderLista(); atualizaProgresso(); }
  });
  const prox = el('button', 'btn', i < artes.length - 1 ? `${artes[i + 1].arte} →` : '');
  if (i < artes.length - 1) prox.addEventListener('click', () => abrir(artes[i + 1].slug));
  else prox.hidden = true;
  nav.append(ant, rev, prox);
  c.append(nav);
}

function secaoElementos(a) {
  const frag = document.createDocumentFragment();
  const h = el('h2', null, 'Elementos');
  h.append(el('span', 'conta', `${a.elementos.length} · o motor decompõe por cor, ` +
                               `a produção por elemento`));
  frag.append(h);
  frag.append(Object.assign(el('p', 'nota'), { innerHTML:
    'Sem o Qwen nesta máquina, o agrupamento é <b>determinístico</b>: contenção, ' +
    'contato, distância entre as formas relativa à altura, e alinhamento de linha de base. ' +
    'Cada elemento mostra <b>por que</b> as regiões vieram juntas — é sobre isso que a ' +
    'correção pega.' }));

  a.elementos.forEach((e) => {
    const card = el('div', 'el');
    const head = el('div', 'el-h');
    head.append(el('span', 'nome', e.nome));
    head.append(el('span', 'tag', e.tipo.toLowerCase()));
    const [cls, txt] = ROTA_TAG[e.rota] || ['', e.rota];
    head.append(el('span', `tag ${cls}`, txt));
    e.cores.forEach((c) => {
      const s = el('span', 'sw'); s.style.background = c; s.title = c; head.append(s);
    });
    if (e.degrade) head.append(el('span', 'tag', 'degradê'));
    card.append(head);
    card.append(Object.assign(el('p', 'nota'), { textContent: e.motivo, style: 'margin:8px 0 0' }));

    const g = el('div', 'el-grid');
    [['área do desenho', `${num(e.area_m2)} m²`],
     ['caixa do adesivo', `${num(e.area_adesivo_m2)} m²`],
     ['largura × altura', `${num(e.largura_cm, 0)} × ${num(e.altura_cm, 0)} cm`],
     ['menor traço', `${num(e.menor_traco_mm, 1)} mm`],
     ['traçado', `${num(e.verticalidade_deg, 0)}°`],
     ['toca tinta', e.toca_tinta ? `sim · ${num(e.fronteira_tt_m)} m` : 'não'],
     ['ilhas (depilação)', e.ilhas],
     ['regiões', e.regioes.length]].forEach(([k, v]) => {
      const d = el('div'); d.append(el('span', 'k', k)); d.append(document.createTextNode(v));
      g.append(d);
    });
    card.append(g);

    const porque = el('div', 'porque');
    porque.append(el('b', null, 'por que estas regiões vieram juntas'));
    const ul = el('ul');
    if (!e.evidencias.length) ul.append(el('li', null, 'região única — nada foi agrupado'));
    const contagem = {};
    e.evidencias.forEach((ev) => { contagem[ev.regra] = (contagem[ev.regra] || 0) + 1; });
    Object.entries(contagem).forEach(([regra, n]) => {
      const ex = e.evidencias.find((ev) => ev.regra === regra);
      ul.append(el('li', null, `${regra.toLowerCase().replace(/_/g, ' ')} × ${n} — ${ex.texto}`));
    });
    porque.append(ul);
    const trilha = el('div', 'porque');
    trilha.append(el('b', null, 'como a rota foi decidida'));
    const ol = el('ul');
    (e.trilha || []).forEach((t) => ol.append(el('li', null, t)));
    trilha.append(ol);
    card.append(porque, trilha);
    card.append(blocoMarca(`elemento:${e.id}`, 'elemento'));
    frag.append(card);
  });

  if (a.descartados.length) {
    const h2 = el('h2', null, 'O que o motor jogou fora');
    h2.append(el('span', 'conta', `${a.descartados.length} grupo(s) · ` +
      `${num(a.descartados.reduce((s, d) => s + d.area_m2, 0), 3)} m²`));
    frag.append(h2);
    frag.append(Object.assign(el('p', 'nota'), { textContent:
      'Descartes viram elementos que não existem, ou escondem elementos que existem. ' +
      'Se algum destes for peça de verdade, marque aqui.' }));
    const tab = el('div', 'scroll');
    const t = el('table');
    t.innerHTML = '<tr><th>id</th><th>tipo</th><th>cor</th><th>área</th><th>caixa</th>' +
                  '<th>por que saiu</th></tr>';
    a.descartados.forEach((d) => {
      const tr = el('tr');
      tr.innerHTML = `<td>${d.regioes.join(', ')}</td><td>${d.tipo.toLowerCase()}</td>` +
        `<td>${d.tons.map((c) => `<span class="sw" style="background:${c}"></span>`).join('')}</td>` +
        `<td class="num">${num(d.area_m2, 3)} m²</td>` +
        `<td class="num">${num(d.largura_cm, 0)}×${num(d.altura_cm, 0)} cm</td>` +
        `<td>${d.motivo_descarte || ''}</td>`;
      t.append(tr);
    });
    tab.append(t); frag.append(tab);
    frag.append(blocoMarca('descartados', 'descartados'));
  }
  return frag;
}

function secaoSessoes(a) {
  const frag = document.createDocumentFragment();
  const h = el('h2', null, 'Sessões de pintura');
  h.append(el('span', 'conta', `${a.sessoes.length} sessões para ${a.paleta.length} cores`));
  frag.append(h);
  frag.append(Object.assign(el('p', 'nota'), { textContent:
    'Cores que não se tocam entram na mesma demão — o número de sessões é o número ' +
    'cromático do grafo "cores que se encontram", não o número de cores. Menor área ' +
    'primeiro, porque é mais fácil de cobrir depois.' }));
  const tab = el('div', 'scroll'); const t = el('table');
  t.innerHTML = '<tr><th>sessão</th><th>cores</th><th>desenho</th><th>janela de pintura</th>' +
                '<th>cores vizinhas (não podem junto)</th></tr>';
  a.sessoes.forEach((s) => {
    const tr = el('tr');
    const viz = Object.entries(s.vizinhas)
      .map(([c, vs]) => vs.length ? `${c} ↔ ${vs.join(', ')}` : `${c} — nenhuma`)
      .join('<br>');
    tr.innerHTML = `<td class="num">${s.n}</td>` +
      `<td>${s.cores.map((c) => `<span class="sw" style="background:${c}"></span>${c}`).join(' ')}</td>` +
      `<td class="num">${num(s.area_m2)} m²</td><td class="num">${num(s.janela_m2)} m²</td>` +
      `<td class="formula">${viz}</td>`;
    t.append(tr);
  });
  tab.append(t); frag.append(tab);
  frag.append(blocoMarca('sessoes', 'sessoes'));
  return frag;
}

function cardPasso(p) {
  const card = el('article', 'passo'); card.dataset.t = p.tipo;
  const h = el('div', 'passo-h');
  h.append(el('span', 'passo-n', String(p.n).padStart(2, '0')));
  h.append(el('span', 'passo-t', p.titulo));
  h.append(el('span', 'tag', p.tipo.toLowerCase()));
  if (p.rota) { const [cls, txt] = ROTA_TAG[p.rota] || ['', p.rota];
    h.append(el('span', `tag ${cls}`, txt)); }
  h.append(el('span', 'passo-min', `${num(p.minutos, 1)} min`));
  card.append(h);
  card.append(el('p', 'passo-d', p.detalhe));

  const img = el('img'); img.src = `/img/${S.slug}/${p.img}`; img.loading = 'lazy';
  img.alt = p.titulo; card.append(img);

  if (p.calculos.length) {
    const box = el('div', 'scroll'); const t = el('table');
    t.innerHTML = '<tr><th></th><th>o que</th><th>conta</th><th>qtd.</th><th>un.</th>' +
                  '<th>parâmetro</th><th>fonte</th></tr>';
    p.calculos.forEach((c, i) => {
      const alvo = `calculo:${p.n}:${i}`;
      const tem = !!S.arte.marcas.observacoes[alvo];
      const tr = el('tr'); if (tem) tr.classList.add('tem-marca');
      const flag = el('button', 'flag' + (tem ? ' is-on' : ''), '⚑');
      const tdF = el('td'); tdF.append(flag);
      tr.append(tdF);
      const tds = [
        `<b>${c.descricao}</b>`,
        `<span class="formula">${c.formula}</span>`,
        `<span class="num">${num(c.valor, c.un === 'min' ? 1 : 3)}</span>`,
        c.un,
        c.parametro ? `<span class="formula">${c.parametro_label || c.parametro}` +
                      `${c.parametro_valor ? ` = ${c.parametro_valor}` : ''}</span>` : '',
        `<span class="tag ${FONTE_TAG[c.fonte] || ''}">${(c.fonte || '').toLowerCase()}</span>`
      ];
      tds.forEach((html, k) => { const td = el('td'); if (k === 2) td.className = 'num';
        td.innerHTML = html; tr.append(td); });
      if (c.nota) { tr.lastElementChild.title = c.nota;
        tr.children[5].innerHTML += `<div class="formula" style="opacity:.8">${c.nota}</div>`; }
      t.append(tr);

      const linha = el('tr', 'linha-marca'); linha.hidden = !tem;
      const td = el('td'); td.colSpan = 7; td.append(blocoMarca(alvo, 'calculo'));
      linha.append(td); t.append(linha);
      flag.addEventListener('click', () => {
        linha.hidden = !linha.hidden; flag.classList.toggle('is-on', !linha.hidden);
      });
    });
    box.append(t); card.append(box);
  }
  card.append(blocoMarca(`passo:${p.n}`, 'passo'));
  return card;
}

function tabelaTotais(a) {
  const box = el('div', 'scroll'); const t = el('table');
  const mat = {};
  a.passos.forEach((p) => p.calculos.filter((c) => c.kind === 'MATERIAL').forEach((c) => {
    const k = `${c.descricao}|${c.un}`;
    mat[k] = (mat[k] || 0) + c.valor;
  }));
  t.innerHTML = '<tr><th>o que</th><th>quanto</th><th>un.</th></tr>';
  const linhas = [['Tempo de mão de obra', a.totais.minutos, 'min'],
                  ['Tempo de mão de obra', a.totais.horas, 'h'],
                  ['Jornadas de 480 min', a.totais.dias, 'dia'],
                  ['Custo de mão de obra (R$ 21,30/h)', a.totais.mao_de_obra_brl, 'R$']];
  Object.entries(mat).forEach(([k, v]) => linhas.push([k.split('|')[0], v, k.split('|')[1]]));
  linhas.forEach(([k, v, u]) => {
    const tr = el('tr');
    tr.innerHTML = `<td>${k}</td><td class="num">${num(v, u === 'min' ? 1 : 2)}</td><td>${u}</td>`;
    t.append(tr);
  });
  box.append(t);
  const aviso = el('p', 'nota');
  aviso.innerHTML = '<b>Materiais não têm preço aqui.</b> O preço vem do estoque do ERP e ' +
    'esta máquina não fala com o banco de produção — então o app mostra a <i>quantidade</i>, ' +
    'que é o que o motor decide. O custo-hora de R$ 21,30 é o default do seed ' +
    '(média CLT ÷ 220 × 1,65).';
  const frag = document.createDocumentFragment();
  frag.append(box, aviso);
  return frag;
}

/* -------------------------------------------------------------- painel -- */

const COLUNAS = [
  ['arte', (a) => a.arte.replace(/\.png$/i, ''), 'txt'],
  ['m²', (a) => a.area_m2, 'num'],
  ['fundo', (a) => (a.fundo === 'GENERAL_PAINT' ? 'geral' : a.fundo === 'WHITE_PLATE' ? 'chapa' : a.fundo), 'txt'],
  ['cores', (a) => a.cores, 'num'],
  ['regiões', (a) => a.regioes, 'num'],
  ['T-T', (a) => a.fronteiras_tt, 'num'],
  ['elem.', (a) => a.elementos, 'num'],
  ['faixas', (a) => a.faixas, 'num'],
  ['aero', (a) => a.aerografias, 'num'],
  ['descart.', (a) => a.descartados, 'num'],
  ['sessões', (a) => a.sessoes, 'num'],
  ['passos', (a) => a.passos, 'num'],
  ['horas', (a) => a.minutos / 60, 'num'],
  ['rotas', (a) => (a.rotas || []).map((r) => (ROTA_TAG[r] || ['', r])[1]).join(', '), 'txt'],
  ['alertas', (a) => (a.alertas || []).length, 'num'],
  ['obs.', (a) => a.marcacoes || 0, 'num']
];

function renderPainel() {
  const c = $('#conteudo'); c.innerHTML = '';
  const w = el('div', 'painel');
  w.append(el('h1', null, 'Painel do lote'));
  w.append(Object.assign(el('p', 'nota'), { textContent:
    'O contraste só existe no lote: uma arte sozinha não diz se o parâmetro está solto ou ' +
    'apertado. Clique num cabeçalho para ordenar e ver quem são os extremos — os casos-limite ' +
    'vizinhos é que tornam a fronteira visível.' }));

  const ok = S.indice.artes.filter((a) => a.ok);
  const falhas = S.indice.artes.filter((a) => !a.ok);
  const box = el('div', 'scroll'); const t = el('table');
  const thead = el('tr');
  COLUNAS.forEach(([nome], i) => {
    const th = el('th', null, nome);
    th.addEventListener('click', () => {
      S.ordem = (S.ordem && S.ordem.i === i) ? { i, desc: !S.ordem.desc } : { i, desc: true };
      renderPainel();
    });
    if (S.ordem && S.ordem.i === i) th.textContent = nome + (S.ordem.desc ? ' ↓' : ' ↑');
    thead.append(th);
  });
  t.append(thead);

  const linhas = [...ok];
  if (S.ordem) {
    const f = COLUNAS[S.ordem.i][1];
    linhas.sort((x, y) => {
      const a = f(x), b = f(y);
      const cmp = typeof a === 'number' ? a - b : String(a).localeCompare(String(b));
      return S.ordem.desc ? -cmp : cmp;
    });
  }
  const maxH = Math.max(...ok.map((a) => a.minutos));
  linhas.forEach((a) => {
    const tr = el('tr');
    COLUNAS.forEach(([nome, f, tipo]) => {
      const td = el('td', tipo === 'num' ? 'num' : null);
      const v = f(a);
      if (nome === 'horas') {
        td.innerHTML = `${num(v, 1)} <span class="barra" style="display:inline-block;width:54px">` +
          `<i style="width:${(a.minutos / maxH * 100).toFixed(0)}%"></i></span>`;
      } else td.textContent = typeof v === 'number' ? num(v, Number.isInteger(v) ? 0 : 2) : v;
      tr.append(td);
    });
    tr.addEventListener('click', () => {
      document.querySelectorAll('.aba').forEach((x) => x.classList.toggle('is-on', x.dataset.aba === 'arte'));
      abrir(a.slug);
    });
    t.append(tr);
  });
  box.append(t); w.append(box);

  if (falhas.length) {
    w.append(el('h2', null, 'Não completaram o pipeline'));
    const t2 = el('table');
    t2.innerHTML = '<tr><th>arte</th><th>erro</th></tr>';
    falhas.forEach((a) => {
      const tr = el('tr');
      tr.innerHTML = `<td>${a.arte}</td><td class="formula">${a.erro || ''}</td>`;
      t2.append(tr);
    });
    w.append(t2);
  }
  c.append(w);
}

/* ---------------------------------------------------------- parâmetros -- */

async function renderParams() {
  const p = await (await fetch('/api/params')).json();
  const c = $('#conteudo'); c.innerHTML = '';
  const w = el('div', 'painel');
  w.append(el('h1', null, 'Parâmetros que entram na conta'));
  w.append(Object.assign(el('p', 'nota'), { innerHTML:
    'Todo número desta lista está sendo usado nos planos. A coluna <b>fonte</b> é a que ' +
    'importa: <span class="tag ok">dono</span> foi dito por você, ' +
    '<span class="tag info">seed</span> está no ERP sem confirmação, ' +
    '<span class="tag warn">estimado</span> o próprio seed marca como chute, e ' +
    '<span class="tag cut">inventado</span> não tem origem nenhuma — fui eu que escolhi.' }));

  const secao = (titulo, obj, campos) => {
    w.append(el('h2', null, titulo));
    const box = el('div', 'scroll'); const t = el('table');
    t.innerHTML = '<tr><th>chave</th><th>o que é</th><th>valor</th><th>fonte</th><th>observação</th></tr>';
    Object.entries(obj).forEach(([k, v]) => {
      const tr = el('tr');
      tr.innerHTML = `<td class="formula">${k}</td><td>${v.label || ''}</td>` +
        `<td class="num">${v.valor != null ? num(v.valor, 2) : ''} ${v.un || ''}</td>` +
        `<td><span class="tag ${FONTE_TAG[v.fonte] || ''}">${(v.fonte || '').toLowerCase()}</span></td>` +
        `<td class="formula">${v.nota || ''}</td>`;
      t.append(tr);
    });
    box.append(t); w.append(box);
  };
  secao('Mão de obra (produtividade)', p.taxas);
  secao('Materiais', p.materiais);
  secao('Doutrina', p.doutrina);

  w.append(el('h2', null, 'Sistemas de pintura'));
  const box = el('div', 'scroll'); const t = el('table');
  t.innerHTML = '<tr><th>sistema</th><th>esquema de demãos</th><th>mistura</th>' +
                '<th>rendimento</th><th>lote mín.</th><th>cura</th></tr>';
  Object.entries(p.sistemas).forEach(([k, v]) => {
    const tr = el('tr');
    tr.innerHTML = `<td><b>${v.label}</b></td>` +
      `<td class="formula">${v.demaos.map((d) => `${d[2]}× ${d[1].toLowerCase()} (${d[0].toLowerCase()})`).join(' + ')}</td>` +
      `<td class="num">${v.mix.join(' : ')}</td><td class="num">${v.rendimento} m²/L</td>` +
      `<td class="num">${v.lote_min} L</td><td class="num">${v.cura_min} min</td>`;
    t.append(tr);
  });
  box.append(t); w.append(box);
  c.append(w);
}

inicio();
