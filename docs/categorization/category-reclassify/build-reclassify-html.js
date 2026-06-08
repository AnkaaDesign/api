/* Builds a self-contained item-reclassification review page from the 8
 * classified-batch-*.json files + merged-taxonomy.json. Output: item-reclassify.html
 * Run: node "Working Files/category-reclassify/build-reclassify-html.js"
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const tax = JSON.parse(fs.readFileSync(path.join(DIR, 'merged-taxonomy.json'), 'utf8'));

// Merge all batches, preserving order by batch then index.
let rows = [];
for (let i = 1; i <= 8; i++) {
  const f = path.join(DIR, `classified-batch-${i}.json`);
  if (!fs.existsSync(f)) { console.error('MISSING', f); process.exit(1); }
  rows = rows.concat(JSON.parse(fs.readFileSync(f, 'utf8')));
}

// Validate leaves against taxonomy; collect the canonical leaf set + top map.
const leafToTop = {};
for (const c of tax.categories) for (const l of c.leaves) leafToTop[l.leaf] = c.top;
const validLeaves = new Set(Object.keys(leafToTop));

// --- Apply taxonomy refinements onto the already-classified rows ---
const RENAME = {
  'Toners e bases de cor': 'Pigmento',
  'Tintas e bases prontas': 'Bases prontas / Tintas',
  'Linha vinílica de plotagem (tintas)': 'Linha Vinílica',
};
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
let nGeneric = 0, nPneu = 0, nElec = 0, nBase = 0;
for (const r of rows) {
  if (RENAME[r.leaf]) r.leaf = RENAME[r.leaf];
  if (r.leaf === 'Ferramentas elétricas e pneumáticas') {
    if (/pneumat/.test(norm(r.name + ' ' + (r.currentCategory || '')))) { r.leaf = 'Ferramentas pneumáticas'; nPneu++; }
    else { r.leaf = 'Ferramentas elétricas'; nElec++; }
  }
  if (r.confidence === 'baixa') { r.leaf = 'Genérico'; nGeneric++; }
  if (norm(r.currentCategory) === 'base') { r.leaf = 'Base'; nBase++; } // explicit legacy "Base" wins
}
console.log(`remap: generic=${nGeneric} pneu=${nPneu} elec=${nElec} base=${nBase}`);

let mismatches = 0;
for (const r of rows) {
  if (!validLeaves.has(r.leaf)) { mismatches++; r._stray = true; }
  else r.top = leafToTop[r.leaf]; // normalize top from taxonomy
}
console.log(`rows=${rows.length} mismatches=${mismatches}`);

// Dedup uniCode display only (keep all rows). Sort by top then name for review.
rows.sort((a, b) => (a.top || '').localeCompare(b.top || '', 'pt') || (a.name || '').localeCompare(b.name || '', 'pt'));

const DATA = JSON.stringify(rows);
const TAX = JSON.stringify(tax.categories);

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Reclassificação de Itens — Ankaa</title>
<style>
:root{--bg:#0f1115;--panel:#171a21;--panel2:#1d2129;--border:#2a2f3a;--txt:#e6e8ec;--mut:#8b93a1;--green:#16a34a;--amber:#d97706;--red:#dc2626;--accent:#22c55e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--border);padding:14px 20px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
h1{font-size:16px;margin:0;font-weight:600}
.sub{color:var(--mut);font-size:12px}
input,select,button{font:inherit;color:var(--txt);background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:8px 10px}
input[type=search]{min-width:240px}
button{cursor:pointer}button.primary{background:var(--accent);color:#06210f;border-color:var(--accent);font-weight:600}
.pill{padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}
.c-alta{background:#0c2a17;color:#4ade80}.c-media{background:#2a1f08;color:#fbbf24}.c-baixa{background:#2a0d0d;color:#f87171}
.wrap{padding:16px 20px}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:middle}
th{position:sticky;top:64px;background:var(--panel);color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em;z-index:4}
td.uc{font-family:ui-monospace,Menlo,monospace;color:var(--mut);white-space:nowrap}
td.nm{font-weight:500;min-width:240px}
select.cat{min-width:340px}
tr.stray select.cat{border-color:var(--red)}
tr:hover{background:#12151b}
.muted{color:var(--mut)}
.counts{display:flex;gap:10px;flex-wrap:wrap}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-left:auto}
#exportArea{width:100%;height:160px;margin-top:12px;display:none;font-family:ui-monospace,monospace;font-size:12px}
label.chk{display:inline-flex;gap:6px;align-items:center;color:var(--mut);font-size:13px}
.cur{font-size:11px;color:var(--mut)}
</style></head>
<body>
<header>
  <div><h1>Reclassificação de Itens</h1><div class="sub" id="stat"></div></div>
  <div class="toolbar">
    <input type="search" id="q" placeholder="Buscar por nome ou código…"/>
    <select id="fTop"><option value="">Todas as categorias</option></select>
    <label class="chk"><input type="checkbox" id="onlyLow"/> Só baixa/média confiança</label>
    <button id="exportBtn" class="primary">Exportar seleção</button>
  </div>
</header>
<div class="wrap">
  <div class="counts" id="counts"></div>
  <textarea id="exportArea" readonly></textarea>
  <table><thead><tr><th>Código</th><th>Nome</th><th>Confiança</th><th>Categoria (grupo › subcategoria)</th></tr></thead>
  <tbody id="tb"></tbody></table>
</div>
<script>
const DATA = ${DATA};
const TAX = ${TAX};
DATA.forEach((r,i)=>r._i=i);
const tops=[...new Set(TAX.map(c=>c.top))];

// build <select> innerHTML once (optgroups)
function buildOptions(sel){
  let h='';
  for(const c of TAX){h+='<optgroup label="'+c.top+'">';for(const l of c.leaves){h+='<option value="'+l.leaf.replace(/"/g,'&quot;')+'"'+(l.leaf===sel?' selected':'')+'>'+l.leaf+'</option>';}h+='</optgroup>';}
  return h;
}
const fTop=document.getElementById('fTop');tops.forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;fTop.appendChild(o);});

const tb=document.getElementById('tb');
function render(){
  const q=document.getElementById('q').value.trim().toLowerCase();
  const ft=fTop.value;const low=document.getElementById('onlyLow').checked;
  tb.innerHTML='';let shown=0;
  for(const r of DATA){
    if(ft&&r.top!==ft)continue;
    if(low&&r.confidence==='alta')continue;
    if(q&&!((r.name||'').toLowerCase().includes(q)||(r.uniCode||'').toLowerCase().includes(q)))continue;
    shown++;
    const tr=document.createElement('tr');if(r._stray)tr.className='stray';
    tr.innerHTML='<td class="uc">'+(r.uniCode||'—')+'</td>'+
      '<td class="nm">'+(r.name||'')+'<div class="cur">atual: '+(r.currentCategory||'—')+'</div></td>'+
      '<td><span class="pill c-'+r.confidence+'">'+r.confidence+'</span></td>'+
      '<td><select class="cat" data-i="'+r._i+'">'+buildOptions(r.leaf)+'</select></td>';
    tb.appendChild(tr);
  }
  document.getElementById('stat').textContent=DATA.length+' itens • mostrando '+shown;
  updateCounts();
}
tb.addEventListener('change',e=>{const s=e.target;if(s.matches('select.cat')){const i=+s.dataset.i;DATA[i].leaf=s.value;DATA[i].top=(TAX.find(c=>c.leaves.some(l=>l.leaf===s.value))||{}).top;DATA[i]._edited=true;s.closest('tr').classList.remove('stray');DATA[i]._stray=false;updateCounts();}});
function updateCounts(){
  const by={};for(const r of DATA){by[r.top]=(by[r.top]||0)+1;}
  const edited=DATA.filter(r=>r._edited).length;
  document.getElementById('counts').innerHTML=Object.entries(by).sort().map(([t,n])=>'<span class="pill" style="background:#1d2129;color:#cbd5e1">'+t+': '+n+'</span>').join('')+' <span class="pill" style="background:#0c2a17;color:#4ade80">editados: '+edited+'</span>';
}
['q','onlyLow'].forEach(id=>document.getElementById(id).addEventListener('input',render));
fTop.addEventListener('change',render);
document.getElementById('exportBtn').addEventListener('click',()=>{
  const out=DATA.map(r=>({id:r.id,uniCode:r.uniCode,name:r.name,top:r.top,leaf:r.leaf}));
  const json=JSON.stringify(out,null,2);
  const ta=document.getElementById('exportArea');ta.style.display='block';ta.value=json;ta.select();
  const blob=new Blob([json],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='reclassification.json';a.click();
});
render();
</script></body></html>`;

const out = path.join(DIR, 'item-reclassify.html');
fs.writeFileSync(out, html);
console.log('WROTE', out, '(', (html.length/1024).toFixed(0), 'KB )');
