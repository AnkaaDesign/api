"""Gera a folha de calibração como página única e autocontida.

As imagens entram como data URI porque a política do Artifact bloqueia qualquer
requisição externa. A marcação fica em localStorage e o resumo é copiável, para
o dono devolver a linha de corte numa mensagem só.
"""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path

CSS = """
:root{
  --ground:#F2F3F4; --panel:#FFFFFF; --line:#D6D9DC; --line-soft:#E6E9EB;
  --ink:#16191C; --ink-2:#4A5257; --ink-3:#79828A;
  --cut:#C8102E; --keep:#1F7A4D; --tape:#E8B00A;
  --shadow:0 1px 2px rgba(20,25,30,.06),0 8px 20px rgba(20,25,30,.05);
}
@media (prefers-color-scheme:dark){
  :root{
    --ground:#111417; --panel:#181C20; --line:#2A3037; --line-soft:#22272C;
    --ink:#EAEDEF; --ink-2:#A8B1B8; --ink-3:#6F7982;
    --cut:#FF5C6E; --keep:#42B883; --tape:#F0C540;
    --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 20px rgba(0,0,0,.3);
  }
}
:root[data-theme="dark"]{
  --ground:#111417; --panel:#181C20; --line:#2A3037; --line-soft:#22272C;
  --ink:#EAEDEF; --ink-2:#A8B1B8; --ink-3:#6F7982;
  --cut:#FF5C6E; --keep:#42B883; --tape:#F0C540;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 20px rgba(0,0,0,.3);
}
:root[data-theme="light"]{
  --ground:#F2F3F4; --panel:#FFFFFF; --line:#D6D9DC; --line-soft:#E6E9EB;
  --ink:#16191C; --ink-2:#4A5257; --ink-3:#79828A;
  --cut:#C8102E; --keep:#1F7A4D; --tape:#E8B00A;
  --shadow:0 1px 2px rgba(20,25,30,.06),0 8px 20px rgba(20,25,30,.05);
}
*{box-sizing:border-box}
body{
  margin:0;background:var(--ground);color:var(--ink);
  font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1000px;margin:0 auto;padding:40px 24px 96px}
header{border-bottom:2px solid var(--ink);padding-bottom:20px;margin-bottom:8px}
.eyebrow{
  font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
  letter-spacing:.14em;text-transform:uppercase;color:var(--cut);margin:0 0 12px
}
h1{font-size:clamp(28px,4.2vw,42px);line-height:1.1;margin:0 0 14px;
   letter-spacing:-.02em;text-wrap:balance}
.lede{max-width:62ch;color:var(--ink-2);margin:0}
.lede strong{color:var(--ink)}

.tally{
  position:sticky;top:0;z-index:20;background:var(--ground);
  border-bottom:1px solid var(--line);padding:14px 0;margin-bottom:28px;
  display:flex;gap:16px;align-items:center;flex-wrap:wrap
}
.tally b{font:600 13px/1 ui-monospace,monospace;letter-spacing:.04em}
.tally .sp{flex:1}
button{
  font:600 13px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;
  border:1px solid var(--line);background:var(--panel);color:var(--ink);
  padding:9px 14px;border-radius:6px
}
button:hover{border-color:var(--ink-3)}
button:focus-visible{outline:2px solid var(--cut);outline-offset:2px}

.ramp{display:flex;gap:2px;margin:0 0 32px;height:8px}
.ramp i{flex:1;background:var(--line);border-radius:1px}
.ramp i.on{background:var(--cut)}

.card{
  background:var(--panel);border:1px solid var(--line);border-radius:10px;
  box-shadow:var(--shadow);margin-bottom:20px;overflow:hidden;
  border-left:4px solid var(--line)
}
.card[data-mark="corto"]{border-left-color:var(--keep)}
.card[data-mark="nao"]{border-left-color:var(--cut)}
.card-top{
  display:flex;gap:18px;align-items:baseline;padding:16px 20px;
  border-bottom:1px solid var(--line-soft);flex-wrap:wrap
}
.rank{font:700 13px/1 ui-monospace,monospace;color:var(--ink-3);
      letter-spacing:.08em}
.stroke{font:700 26px/1 ui-monospace,monospace;font-variant-numeric:tabular-nums;
        letter-spacing:-.02em}
.stroke span{font-size:14px;font-weight:500;color:var(--ink-3);margin-left:3px}
.art{color:var(--ink-2);font-size:14px}
.figs{display:grid;grid-template-columns:1.4fr 1fr;gap:0}
@media (max-width:720px){.figs{grid-template-columns:1fr}}
figure{margin:0;padding:18px 20px;min-width:0}
figure+figure{border-left:1px solid var(--line-soft)}
@media (max-width:720px){figure+figure{border-left:0;border-top:1px solid var(--line-soft)}}
figcaption{
  font:600 11px/1 ui-monospace,monospace;letter-spacing:.12em;
  text-transform:uppercase;color:var(--ink-3);margin-bottom:10px
}
figure img{width:100%;height:auto;display:block;border:1px solid var(--line-soft);
           border-radius:4px;background:#fff}
.meta{
  display:flex;gap:22px;flex-wrap:wrap;padding:0 20px 16px;
  font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
  font-variant-numeric:tabular-nums;color:var(--ink-2)
}
.meta b{color:var(--ink);font-weight:600}
.swatch{display:inline-block;width:11px;height:11px;border-radius:2px;
        border:1px solid rgba(128,128,128,.4);vertical-align:-1px;margin-right:5px}
.marks{display:flex;gap:10px;padding:0 20px 18px}
.marks button{flex:1;max-width:190px}
.marks button[aria-pressed="true"]{color:#fff;border-color:transparent}
.marks .yes[aria-pressed="true"]{background:var(--keep)}
.marks .no[aria-pressed="true"]{background:var(--cut)}
.out{
  background:var(--panel);border:1px solid var(--line);border-radius:10px;
  padding:20px;margin-top:32px
}
.out h2{margin:0 0 10px;font-size:18px}
.out p{margin:0 0 14px;color:var(--ink-2);font-size:14px;max-width:62ch}
textarea{
  width:100%;min-height:110px;background:var(--ground);color:var(--ink);
  border:1px solid var(--line);border-radius:6px;padding:12px;
  font:13px/1.6 ui-monospace,monospace;resize:vertical
}
@media (prefers-reduced-motion:no-preference){
  .card{transition:border-left-color .15s ease}
}
"""

JS = """
// Chave por rodada: os números mudam de elemento entre gerações, e
// reaproveitar a chave aplicaria as marcas antigas nos cartões errados.
const KEY='ankaa-calib-corte-r3';
const state=JSON.parse(localStorage.getItem(KEY)||'{}');

function paint(){
  let yes=0,no=0;
  document.querySelectorAll('.card').forEach(card=>{
    const n=card.dataset.n, m=state[n];
    card.dataset.mark=m||'';
    card.querySelectorAll('.marks button').forEach(b=>
      b.setAttribute('aria-pressed', String(b.dataset.v===m)));
    document.querySelector(`.ramp i[data-n="${n}"]`)
            .classList.toggle('on', m==='nao');
    if(m==='corto') yes++; else if(m==='nao') no++;
  });
  document.getElementById('t-yes').textContent=yes;
  document.getElementById('t-no').textContent=no;
  render();
}

function render(){
  const marked=DATA.filter(d=>state[d.n]);
  if(!marked.length){ document.getElementById('out').value=''; return; }
  const nao=marked.filter(d=>state[d.n]==='nao').map(d=>d.menor_traco_mm);
  const sim=marked.filter(d=>state[d.n]==='corto').map(d=>d.menor_traco_mm);
  const lines=marked.map(d=>
    `#${String(d.n).padStart(2,'0')}  ${state[d.n]==='corto'?'CORTO    ':'NAO CORTO'}  `+
    `${String(d.menor_traco_mm).padStart(6)} mm  ${d.arte}`);
  let head='';
  if(nao.length && sim.length){
    head=`limiar entre ${Math.max(...nao)} mm (maior "nao corto") e `+
         `${Math.min(...sim)} mm (menor "corto")\\n\\n`;
  }
  document.getElementById('out').value=head+lines.join('\\n');
}

document.addEventListener('click',e=>{
  const b=e.target.closest('.marks button'); if(!b) return;
  const n=b.closest('.card').dataset.n;
  state[n] = state[n]===b.dataset.v ? undefined : b.dataset.v;
  if(!state[n]) delete state[n];
  localStorage.setItem(KEY,JSON.stringify(state));
  paint();
});

document.getElementById('reset').addEventListener('click',()=>{
  Object.keys(state).forEach(k=>delete state[k]);
  localStorage.removeItem(KEY); paint();
});
document.getElementById('copy').addEventListener('click',async()=>{
  const t=document.getElementById('out');
  if(!t.value) return;
  await navigator.clipboard.writeText(t.value);
  const b=document.getElementById('copy');
  b.textContent='Copiado'; setTimeout(()=>b.textContent='Copiar resultado',1400);
});
paint();
"""


def uri(path: Path) -> str:
    mime = "image/jpeg" if path.suffix in (".jpg", ".jpeg") else "image/png"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", required=True, help="diretório do calib_sheet.py")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    root = Path(args.sheet)
    items = json.loads((root / "manifest.json").read_text())

    ramp = "".join(f'<i data-n="{d["n"]}"></i>' for d in items)
    cards = []
    for d in items:
        # milhar em pt-BR. Formatar SÓ este campo — um replace(",", ".") na
        # carta inteira corromperia os nomes de arte ("3 IRMÃOS 8,40 lateral").
        area = f"{d['area_cm2']:,.0f}".replace(",", ".")
        cards.append(f"""
<article class="card" data-n="{d['n']}">
  <div class="card-top">
    <span class="rank">#{d['n']:02d}</span>
    <span class="stroke">{d['menor_traco_mm']}<span>mm de traço</span></span>
    <span class="art">{d['arte']} &middot; {d['comprimento_m']} m</span>
  </div>
  <div class="figs">
    <figure>
      <figcaption>Na arte</figcaption>
      <img src="{uri(root / d['contexto'])}" alt="Elemento {d['n']} na arte {d['arte']}">
    </figure>
    <figure>
      <figcaption>O que seria cortado</figcaption>
      <img src="{uri(root / d['silhueta'])}" alt="Silhueta do elemento {d['n']}">
    </figure>
  </div>
  <div class="meta">
    <span><span class="swatch" style="background:{d['cor']}"></span><b>{d['cor']}</b></span>
    <span>área <b>{area} cm²</b></span>
    <span>encosta em <span class="swatch" style="background:{d['sobre_cor']}"></span>
      <b>{d['sobre_cor']}</b></span>
    <span>vértices/m <b>{d['vertices_por_m']}</b></span>
    <span>compacidade <b>{d['compacidade']}</b></span>
    <span>sobre <b>{d['sobre'].lower()}</b></span>
  </div>
  <div class="marks">
    <button class="yes" data-v="corto" aria-pressed="false">Corto à mão</button>
    <button class="no" data-v="nao" aria-pressed="false">Não corto</button>
  </div>
</article>""")

    lo, hi = items[0]["menor_traco_mm"], items[-1]["menor_traco_mm"]
    html = f"""<title>Calibração de corte — Ankaa</title>
<style>{CSS}</style>
<div class="wrap">
<header>
  <p class="eyebrow">Motor de pintura &middot; calibração §7.5</p>
  <h1>Onde está a linha do “isso eu não corto”?</h1>
  <p class="lede">Rodada 3, e desta vez a pergunta é respondível. As anteriores
  estavam cheias de <strong>cor sobre chapa</strong> — e sobre chapa não se corta, o adesivo
  vai inteiro. Aqui todos os 20 elementos encostam em <strong>outra tinta</strong>, que é o
  único caso em que "corto ou não corto" decide alguma coisa.</p>
  <p class="lede" style="margin-top:12px">Faixa de <strong>{lo} a {hi} mm</strong>. Cada cartão
  diz contra qual cor o elemento encosta e traz <strong>vértices/m</strong> — perto de 1 é reto,
  dezenas é filigrana. O ACM mostrou que espessura não decide sozinha: triângulos finos,
  cor sobre cor, são cortados à mão porque são retos.</p>
</header>

<div class="tally">
  <b style="color:var(--keep)">corto <span id="t-yes">0</span></b>
  <b style="color:var(--cut)">não corto <span id="t-no">0</span></b>
  <span class="sp"></span>
  <button id="reset">Limpar</button>
</div>

<div class="ramp" aria-hidden="true">{ramp}</div>

{"".join(cards)}

<section class="out">
  <h2>Resultado</h2>
  <p>Cole isto de volta na conversa. Se você marcar dos dois lados, o limiar
  aparece na primeira linha.</p>
  <textarea id="out" readonly placeholder="Marque os elementos acima…"></textarea>
  <div style="margin-top:12px"><button id="copy">Copiar resultado</button></div>
</section>
</div>
<script>const DATA={json.dumps(items, ensure_ascii=False)};{JS}</script>
"""
    Path(args.out).write_text(html)
    print(f"{args.out}  ({len(html)/1e6:.1f} MB, {len(items)} elementos)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
