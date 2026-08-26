# Rodada 2 de análise manual — 21/08/2026 (correções do dono sobre a UI)

> O dono usou a interface e corrigiu o plano em cima dos quadros. Cada regra
> abaixo é nível 1 (ditada). Este documento é o "o que eu faria" ANTES de
> mexer no motor — o motor é depois posto contra ele.

## As regras ditadas nesta rodada

- **R2-1 · Papel TK por orientação.** Peça de papel VERTICAL usa bobina de
  **100 cm**; peça HORIZONTAL usa bobina de **50 cm**. Contar e desenhar
  separado (dois itens de material, larguras reais no quadro).
- **R2-2 · O papel fica até o fim — e o quadro tem de mostrar.** Depois do
  empapelamento, TODOS os passos seguintes mostram o papel. A cobertura de
  cada cor pintada também fica visível (hachura) até a remoção.
- **R2-3 · O passo de cobrir mostra O QUE cobre e diz do corte.** Entre
  "pintar sessão N" e "pintar sessão N+1" o quadro desenha a máscara
  entrando sobre as formas recém-pintadas, com o corte à mão destacado onde
  há fronteira.
- **R2-4 · Calendário por REGRA, nunca por horas.** A maioria dos trabalhos:
  **1 dia** (sem pintura geral) ou **2 dias** (com pintura geral: dia 1 =
  lavagem→secagem→desengraxe→empapelamento→demão de fundo, cura; dia 2 = a
  logomarca INTEIRA). **Aerografia tem dia PRÓPRIO** — não se faz nada junto
  dela. Exceções tipo 2 amigos: 3+ dias (geral | aerografia | logomarca…).
  As horas estimadas (taxas chute) NÃO quebram o dia.
- **R2-5 · Mosaico reto = corte fácil, tudo no mesmo dia.** "Todas aquelas
  formas geométricas são fáceis de cortar à mão, já que são retas" — só se
  mascara as partes em contato, cobre e pinta a próxima cor. 137 = 2 dias.
- **R2-6 · Ciclo de readesivo: rota padrão SEM verniz (R2).** Pinta → seca →
  reaplica adesivo → pinta, no MESMO dia. Verniz intermediário + cura (+1
  dia) é a alternativa editável — e é a rota natural quando a base é
  DEGRADÊ/aerografia (2 amigos: texto sobre o banner envernizado, doutrina
  2.6).
- **R2-7 · Folha saliente separa.** Adesivo cujo conteúdo segue um padrão de
  altura e tem UMA parte que sobe/desce muito (o "F" alto do Frutícula, o
  rabo do "g"): a folha se divide — o corpo numa folha na bobina adequada e
  a saliência em folha própria, para economizar filme. O ELEMENTO continua
  um só; quem divide é a FOLHA.
- **R2-8 · Gigante e simples = STENCIL.** Elemento muito grande e fácil de
  cortar (script de letra ~1 m do 2 amigos) não é vinil: é stencil/espovo,
  com o traçado tranquilo/horizontal marcado em **fita amarela** e os
  trechos muito verticais em **fita branca cortada**.
- **R2-9 · Degradê pinta a JANELA inteira do adesivo.** A parte interna do
  adesivo não é pintada "com perfeição" peça a peça — a rampa é passada na
  janela inteira e o vinil mascara. Um passo de degradê POR ADESIVO/JANELA,
  custo de tinta pela ÁREA DA JANELA (G7), nunca esfumado componente a
  componente.
- **R2-10 · Tudo clicável na UI.** Técnica por elemento (adesivo ↔ stencil
  via corte ↔ stencil via fita amarela ↔ fita ↔ aerografia) e TINTA por
  família (cor do sistema + preço) trocáveis em um clique, com recálculo.

## O que eu faria, layout a layout (esperado da próxima rodada do motor)

### 100 FRONTEIRAS — 1 dia
Plotagem/depilação · aplicação A1+A2 · empapelamento (papel V em bobina 100,
H em bobina 50) · sessões do aninhamento com cobre+corte (4,0 m no total) ·
remoção · verniz · inspeção. **n_dias = 1.**

### 137 PESCADOS — 2 dias
**Dia 1**: lavagem → secagem → desengraxe → empapelamento estrutural → demão
cinza (2 demãos) → cura. **Dia 2**: plotagem, aplicação, empapelamento;
sessões do mosaico (formas retas — mascara só o contato, cobre, pinta a
próxima); bandeira pela rota R2 (pinta o azul → seca → reaplica → branco) no
mesmo dia; remoção, verniz, inspeção. **n_dias = 2.**

### A&P FOODS — 2 dias
Dia 1 = preparo + roxo. Dia 2 = adesivos, branco (3 demãos), ouro, corte de
0,35 m no f×P, onda em FITA, aninhados por R2 no mesmo dia, verniz.
**n_dias = 2.**

### AKTL / ACM / AAN / ADRI / BURES (campo chapa) — 1 dia cada
Arte inteira num dia; ACM com as ~12 sessões e ~66 m de corte SÃO um dia
(retas, corte fácil). **n_dias = 1.**

### 2 AMIGOS — 4 dias
Dia 1 = preparo + demão grafite. Dia 2 = AEROGRAFIA dos morangos (dia
próprio; coberta ao final com fita nas bordas + papel no centro). Dia 3 =
banner (degradê pela janela) + script gigante como STENCIL (fita amarela no
topo, fita branca nos trechos verticais) + demais; verniz do banner. Dia 4 =
texto "2 amigos" sobre o banner envernizado (ciclo com verniz — doutrina
2.6). **n_dias ≥ 3.**

### mar e rio — 3 dias
Dia 1 preparo + azul. Dia 2 aerografia do polvo (dia próprio). Dia 3
logomarca (nuvem branca, teal, textos, ondas em fita). **n_dias = 3.**
