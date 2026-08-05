"""Publica o relatório do motor como página única e autocontida."""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path

CSS = """
:root{
  --ground:#F2F3F4;--panel:#FFF;--line:#D6D9DC;--soft:#E6E9EB;
  --ink:#16191C;--ink2:#4A5257;--ink3:#79828A;
  --cut:#C8102E;--ok:#1F7A4D;--warn:#B8860B;
  --shadow:0 1px 2px rgba(20,25,30,.06),0 8px 20px rgba(20,25,30,.05);
}
@media (prefers-color-scheme:dark){:root{
  --ground:#111417;--panel:#181C20;--line:#2A3037;--soft:#22272C;
  --ink:#EAEDEF;--ink2:#A8B1B8;--ink3:#6F7982;
  --cut:#FF5C6E;--ok:#42B883;--warn:#F0C540;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 20px rgba(0,0,0,.3);}}
:root[data-theme="dark"]{
  --ground:#111417;--panel:#181C20;--line:#2A3037;--soft:#22272C;
  --ink:#EAEDEF;--ink2:#A8B1B8;--ink3:#6F7982;
  --cut:#FF5C6E;--ok:#42B883;--warn:#F0C540;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 20px rgba(0,0,0,.3);}
:root[data-theme="light"]{
  --ground:#F2F3F4;--panel:#FFF;--line:#D6D9DC;--soft:#E6E9EB;
  --ink:#16191C;--ink2:#4A5257;--ink3:#79828A;
  --cut:#C8102E;--ok:#1F7A4D;--warn:#B8860B;
  --shadow:0 1px 2px rgba(20,25,30,.06),0 8px 20px rgba(20,25,30,.05);}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:40px 24px 96px}
header{border-bottom:2px solid var(--ink);padding-bottom:22px}
.eyebrow{font:600 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;
  text-transform:uppercase;color:var(--cut);margin:0 0 12px}
h1{font-size:clamp(28px,4.2vw,42px);line-height:1.08;margin:0 0 10px;
  letter-spacing:-.02em;text-wrap:balance}
.sub{color:var(--ink2);margin:0;font:14px/1.5 ui-monospace,Menlo,monospace}
h2{font-size:22px;margin:44px 0 6px;letter-spacing:-.01em}
h2+.note{margin:0 0 18px;color:var(--ink2);font-size:15px;max-width:64ch}
.hero{margin:22px 0 0;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.hero img{width:100%;display:block}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:20px 0 0}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 16px}
.stat .k{font:600 11px/1 ui-monospace,monospace;letter-spacing:.1em;
  text-transform:uppercase;color:var(--ink3)}
.stat .v{font:700 24px/1.2 ui-monospace,monospace;font-variant-numeric:tabular-nums;
  margin-top:8px;letter-spacing:-.02em}
.stat .v small{font-size:13px;font-weight:500;color:var(--ink3)}
table{width:100%;border-collapse:collapse;margin-top:14px;font-size:14px}
.scroll{overflow-x:auto}
th{text-align:left;font:600 11px/1 ui-monospace,monospace;letter-spacing:.1em;
  text-transform:uppercase;color:var(--ink3);padding:0 14px 10px 0;white-space:nowrap}
td{padding:10px 14px 10px 0;border-top:1px solid var(--soft);
  font-variant-numeric:tabular-nums;white-space:nowrap}
.sw{display:inline-block;width:12px;height:12px;border-radius:2px;
  border:1px solid rgba(128,128,128,.4);vertical-align:-1px;margin-right:7px}
.tag{display:inline-block;font:600 11px/1 ui-monospace,monospace;letter-spacing:.06em;
  padding:5px 8px;border-radius:4px;border:1px solid var(--line);color:var(--ink2)}
.tag.ok{color:var(--ok);border-color:currentColor}
.tag.warn{color:var(--warn);border-color:currentColor}
.tag.cut{color:var(--cut);border-color:currentColor}
.step{background:var(--panel);border:1px solid var(--line);border-radius:10px;
  box-shadow:var(--shadow);margin-bottom:16px;overflow:hidden;border-left:4px solid var(--line)}
.step[data-t="PINTURA"]{border-left-color:var(--ok)}
.step[data-t="MASCARA"],.step[data-t="ADESIVO"]{border-left-color:var(--cut)}
.step[data-t="FITA"]{border-left-color:#E8B00A}
.step[data-t="PREPARO"]{border-left-color:#8A6D3B}
.step[data-t="VERNIZ"]{border-left-color:var(--warn)}
.step-h{display:flex;gap:14px;align-items:baseline;padding:15px 20px;flex-wrap:wrap}
.step-n{font:700 13px/1 ui-monospace,monospace;color:var(--ink3);letter-spacing:.08em}
.step-t{font-weight:650;font-size:17px}
.step-d{padding:0 20px 14px;color:var(--ink2);font-size:14px;max-width:70ch}
.step img{width:100%;display:block;border-top:1px solid var(--soft)}
.flag{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--cut);
  border-radius:10px;padding:18px 20px;margin-bottom:14px}
.flag h3{margin:0 0 8px;font-size:16px}
.flag p{margin:0 0 10px;color:var(--ink2);font-size:14.5px;max-width:70ch}
.flag p:last-child{margin-bottom:0}
code{font:13px ui-monospace,Menlo,monospace;background:var(--soft);
  padding:2px 5px;border-radius:3px}
"""


def uri(p: Path) -> str:
    mime = "image/jpeg" if p.suffix in (".jpg", ".jpeg") else "image/png"
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()


ROTA_TAG = {
    "FITA_AMARELA": ("ok", "fita amarela"),
    "FITA_BRANCA": ("warn", "fita branca + corte"),
    "ADESIVO_SOBRE_CHAPA": ("ok", "adesivo sobre chapa"),
    "ADESIVO_SOBRE_GERAL": ("ok", "adesivo sobre pintura geral"),
    "AEROGRAFIA": ("warn", "aerografia"),
    "ADESIVO_SOBRE_VERNIZ": ("cut", "adesivo sobre verniz"),
    "CORTE_MANUAL": ("warn", "corte manual"),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    root = Path(args.report)
    r = json.loads((root / "report.json").read_text())

    el_rows = ""
    for e in r["elementos"]:
        cls, txt = ROTA_TAG.get(e["rota"], ("", e["rota"]))
        sw = "".join(f"<span class='sw' style='background:{c}'></span>" for c in e["cores"])
        grad = " <span class='tag'>degradê</span>" if e["degrade"] else ""
        el_rows += (
            f"<tr><td><b>{e['tipo'].lower()}</b>{grad}</td>"
            f"<td>{sw}</td><td>{e['area_m2']} m²</td>"
            f"<td>{e['menor_traco_mm']} mm</td>"
            f"<td>{e['verticalidade_deg']}°</td>"
            f"<td>{'sim' if e['toca_tinta'] else 'não'}</td>"
            f"<td><span class='tag {cls}'>{txt}</span></td></tr>")

    steps = "".join(
        f"""<article class="step" data-t="{s['tipo']}">
  <div class="step-h"><span class="step-n">{s['n']:02d}</span>
    <span class="step-t">{s['titulo']}</span>
    <span class="tag">{s['tipo'].lower()}</span></div>
  <p class="step-d">{s['detalhe']}</p>
  <img src="{uri(root / s['img'])}" alt="Estado no passo {s['n']}">
</article>""" for s in r["passos"])

    fundidos = r.get("tons_fundidos", {})
    fund_html = ""
    if fundidos:
        itens = "".join(
            f"<li><span class='sw' style='background:{k}'></span><code>{k}</code>"
            f" &rarr; <span class='sw' style='background:{v}'></span><code>{v}</code></li>"
            for k, v in fundidos.items())
        fund_html = (
            "<div class='flag'><h3>Tons fundidos como uma tinta só</h3>"
            f"<ul style='margin:0;padding-left:20px;color:var(--ink2);font-size:14.5px'>{itens}</ul>"
            "<p style='margin-top:10px'>Encostados e a menos de ΔE 16 — é degradê "
            "de uma tinta, não duas tintas se encontrando. Sem isto o plano "
            "ganhava um ciclo de máscara por tom.</p></div>")

    alerts = "".join(f"<span class='tag warn' style='margin:0 6px 6px 0'>{a['code']}</span>"
                     for a in r["alertas"])

    fitas = [e for e in r["elementos"] if e["rota"].startswith("FITA")]
    fita_html = ""
    if fitas:
        linhas = "".join(
            f"<tr><td>{e['tipo'].lower()}</td><td>{e['verticalidade_deg']}°</td>"
            f"<td>{e['area_m2']} m²</td>"
            f"<td><span class='tag {'ok' if e['rota']=='FITA_AMARELA' else 'warn'}'>"
            f"{e['rota'].replace('_',' ').lower()}</span></td></tr>" for e in fitas)
        fita_html = f"""
<h2>Fita amarela ou fita branca?</h2>
<p class="note">Faixa quase nunca leva adesivo. A escolha entre as duas fitas
não é estética — muda se existe corte manual no orçamento.</p>
<div class="grid">
  <div class="stat"><div class="k">fita amarela</div>
    <div class="v" style="font-size:17px;line-height:1.45">flexível
      <small style="display:block;margin-top:6px">Acompanha curva. Delimita e a
      tinta entra: <b>zero corte</b>. É a rota barata.</small></div></div>
  <div class="stat"><div class="k">fita branca</div>
    <div class="v" style="font-size:17px;line-height:1.45">rígida e mais larga
      <small style="display:block;margin-top:6px">Não faz curva. Cobre mais de
      uma vez, mas <b>exige corte manual</b> para acertar o traçado.</small></div></div>
</div>
<p class="note" style="margin-top:18px">Duas condições decidem, e a segunda é do
traçado, não do material:</p>
<div class="scroll"><table>
<tr><th>substrato</th><th>traçado</th><th>fita</th></tr>
<tr><td>isoplastic ou lona</td><td>qualquer curva</td>
    <td><span class="tag ok">amarela</span></td></tr>
<tr><td>chapa e demais</td><td>até {int(55)}° da horizontal</td>
    <td><span class="tag ok">amarela</span></td></tr>
<tr><td>chapa e demais</td><td>acima de {int(55)}° — muito vertical</td>
    <td><span class="tag warn">branca + corte</span></td></tr>
</table></div>
<p class="note" style="margin-top:16px">Nesta peça:</p>
<div class="scroll"><table>
<tr><th>elemento</th><th>traçado</th><th>área</th><th>decisão</th></tr>
{linhas}</table></div>
"""

    html = f"""<title>Plano de pintura — {r['arte']}</title>
<style>{CSS}</style>
<div class="wrap">
<header>
  <p class="eyebrow">painting-engine + qwen3-vl &middot; v2</p>
  <h1>{r['arte'].replace('.png','')}</h1>
  <p class="sub">{r['comprimento_cm']:.0f} × {r['altura_cm']:.0f} cm &nbsp;·&nbsp;
  {r['area_m2']} m² &nbsp;·&nbsp; substrato {r['substrato'].lower()} &nbsp;·&nbsp;
  fundo {r['fundo']['mode'].replace('_',' ').lower()} {r['fundo']['coveragePct']*100:.0f}%</p>
  <div class="hero"><img src="{uri(root / 'img/original.jpg')}" alt="{r['arte']}"></div>
</header>

<h2>Elementos</h2>
<p class="note">O motor decompõe por <em>cor</em>; a produção decompõe por
<em>elemento</em>. O Qwen faz essa ponte — em especial reconhecendo a faixa,
que geometria nenhuma identifica e que tem rota própria.</p>
<div class="scroll"><table>
<tr><th>elemento</th><th>cores</th><th>área</th><th>traço mín.</th>
<th>traçado</th><th>toca tinta</th><th>rota</th></tr>
{el_rows}</table></div>

{fund_html}
{fita_html}

<h2>Plano de produção</h2>
<p class="note">Cinza = mascarado. Cor = entrando nesta sessão. Branco = chapa
exposta. {len(r['passos'])} passos.</p>
{steps}

<h2>Alertas do motor</h2>
<p class="note">{alerts}</p>
</div>
"""
    Path(args.out).write_text(html)
    print(f"{args.out}  ({len(html)/1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
