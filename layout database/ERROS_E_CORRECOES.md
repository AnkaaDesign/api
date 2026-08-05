# Erros e correções

Registro do que deu errado, por que, e como foi corrigido. Existe porque um
padrão apareceu cedo e se repetiu: **a maior parte dos defeitos veio de
correções anteriores**. Sem esse registro e sem o teste de regressão
(`painting-vision/tests/test_casos.py`), o ciclo recomeça.

Fonte de cada correção:
- **dono** — apontou olhando o resultado
- **medido** — descoberto rodando e conferindo número
- **agente** — diagnóstico de subagente, com evidência

---

## 1. O padrão

| defeito | veio de |
|---|---|
| 3 azuis separados na BURES | artefato do seeder — e **minha fusão compensava o artefato** |
| fusão encadeando ΔE 39,6 | union-find transitivo **que eu escrevi para consertar o item acima** |
| logomarca partida em 3, texto virando fita | frase **que eu pus no prompt para consertar a BURES** |
| aerografia incapaz de tocar tinta | meu desvio de `groups["aero"]` antes do `owner` |
| papel do tagline sumindo / invadindo o telefone | eu alternava entre caixa e forma, **quando as duas eram necessárias** |

O denominador comum: **escolher entre duas representações quando ambas mandam
em coisas diferentes**. Caixa manda em onde o adesivo é aplicado, onde o papel
pousa, onde o verniz vai. Forma manda em onde a tinta entra e no que precisa
ficar exposto.

---

## 2. Correções do dono, em ordem

### 2.1 Adesivo nunca é produto final
As análises A–F tratavam impressão digital como solução final em 8 de 8 fatias.
**Adesivo é sempre só molde para pintura.** Invalidou as 66 análises e obrigou a
refazê-las. → `analysis_v2/`

### 2.2 Faltava medir tinta-tinta
Quantas cores não-brancas se tocam, por quantos cm, e quão curvilíneo. As
análises antigas **nunca mediram** — presumiam.

### 2.3 Ordem por menor cobertura
Pinta-se a cor de menor área primeiro, mascara-se, e a maior vem por cima.
As antigas ordenavam por luminosidade ("claro → escuro") ou punham a maior
primeiro. Custo medido: BOI MIX mascararia 8,7 m² em vez de 0,8.

### 2.4 Espovo
Kraft furado à mão + carvão. Direto na chapa para faixa; sobre máscara para logo
grande. Raro — só quando extremamente grande e fácil.

### 2.5 Fita pelo substrato — e eu generalizei errado
Escrevi na doutrina *"fita amarela só em isoplastic/lona"*. O dono havia dito
*"se for outro tipo de implemento, **se estiver muito vertical** não dá"*. A
condição é a **verticalidade do traçado**. Em chapa com curva tranquila a amarela
passa — caso da BURES.
> As reanálises v2 herdaram o erro. Onde acusaram "fita amarela proibida" (AAN,
> SGT, BURES, Cavalcante), a acusação precisa ser **reavaliada**, não descartada.

### 2.6 O 2 Amigos resolvido
Morangos = aerografia. Banner = pintura com degradê. Texto "Frutícula 2 Amigos" =
adesivo sobre o banner já pintado e envernizado. Texto cinza com degradê parcial =
máscara dentro da máscara.

### 2.7 Terminologia
A peça chama-se **adesivo** ou **vinil** — nunca "máscara de máquina".

### 2.8 Preparação é condicional
Lavagem e empapelamento completo **só com pintura geral**. Em chapa, só uma cinta
em volta dos adesivos.

### 2.9 Corte manual é raro
Só existe para separar duas tintas. Sobre chapa o adesivo vai inteiro.
> Eu tinha corte manual como rota **preferida**. Isso invertia a árvore inteira.

### 2.10 A faixa precisa do VLM
Nenhuma medida geométrica diz "isto é uma faixa". Sem o nome, ela virava quatro
etapas de mascaramento por tom.

### 2.11 Adesivo aplicado inteiro
Não separado por cor. O que muda entre sessões é a **depilação**.

### 2.12 Papel em folhas de 100 cm, janelas retangulares
O vinil é folha quadrada: empapela-se em volta do **retângulo**. Exceção: fita
acompanha a curva.

### 2.13 Pintura por cor, não por componente
Uma demão cobre todos os elementos daquela tinta.

### 2.14 O papel fica até o fim
Só sai no verniz final.

### 2.15 Adesivo é traço, não silhueta preenchida
O que sai do plotter é a linha de corte.

### 2.16 8 cm de folga
Entre o corte do plotter e a extremidade do adesivo.

### 2.17 Cobrir cada cor antes da próxima
E: bounding inteiro quando não sobrou cor ali dentro; só a forma quando ainda
falta pintar outra cor no mesmo bounding.

### 2.18 Verniz sobre os boundings, com interseções
Não dá para envernizar só as letras. Caixas que se tocam viram uma passada.

### 2.19 Degradê tem de sair suavizado
Nunca em bandas.

### 2.20 Cobertura sem ultrapassar o bounding alheio
E cada parte precisa da sua própria caixa — o "RES" laranja e o "BU" azul são
partes distintas do mesmo adesivo.

### 2.21 Verniz não desperdiça
Seguia uma caixa fundida que atravessava a face; deve seguir o adesivo.

### 2.22 Aerografia leva adesivo, só do contorno externo
Nada interno, nenhuma depilação de miolo.

### 2.23 Pintura geral não conta como "tocar tinta"
É feita no dia anterior e chega curada.
> Sem isso o 137 PESCADOS jogava **os 7 elementos** na rota de verniz + espera.

### 2.24 Sessões por cores que não se tocam
Pinta todas as que não se encontram, mascara todas, corta, próximo grupo. O nº de
sessões é o **número cromático**, não o nº de cores.

### 2.25 Só existem duas técnicas
Chapada ou aerográfica. "Pintura à mão" **é** aerografia.
> Dissolveu as 9 "pendências" das reanálises — nunca foram decisões.

### 2.26 O adesivo preserva o branco
Não depilar a parte branca já preserva a chapa. Sai de graça.

### 2.27 Existe alternativa ao corte que eu não tinha
Pinta o fundo → seca → **reaplica o adesivo** → pinta. Sem verniz. Com chapa
branca de fundo, nem a primeira demão existe.

### 2.28 Filete branco entre cores não é T-T
E o detector **não pode dilatar por cima do filete**.

### 2.29 Degradê: os tons são tintas, não uma tinta só
*"Se pinta as 3, 4 quantas quer que sejam cores primeiro, depois começa a cortar
a separação, fazendo efeito."* Cada tom tem demão própria.
> Eu tinha entendido ao contrário e fundia os tons — apagando demãos reais do
> orçamento. O agente da quantização tinha listado **como mitigação obrigatória**
> "emitir flag DEGRADE em vez de descartar", e eu apliquei a versão que absorve.

### 2.30 Pintura geral é o primeiro dia inteiro
Lavagem → empapelamento do implemento → geral → cura até o dia seguinte → só
então os adesivos.
> Eu punha a geral **depois** do empapelamento localizado, contradizendo a
> própria regra de que ela chega curada.

### 2.31 Tinta se conta pelo bounding
Não se pinta um texto de 5 cm de altura exatamente — pinta-se a janela inteira.
Área de tinta (bounding) e comprimento de corte (forma) são grandezas distintas.

---

## 3. Meus erros técnicos

### 3.1 Antialias fazia toda fronteira virar T-T
A faixa intermediária de 1–3 px entre uma letra e a chapa virava cor própria; a
letra deixava de encostar no fundo. **Primeiro render da AAN: quase tudo vermelho**,
inclusive letras isoladas sobre chapa branca. → voto modal antes de classificar.

### 3.2 Detector de textura com dois falsos positivos
Máscara vinha dos rótulos quantizados, L* da imagem original: o anel de antialias
inflava o desvio e **a AAN inteira saiu como AEROGRAFIA**. E em cinza/preto
(a,b≈0) o ângulo de matiz é ruído puro e gira 360°. → erodir antes de medir;
matiz só onde há croma.

### 3.3 A hipótese do `sobre` não se sustentou
Afirmei que `sobre: TINTA` "lia, no resultado, a decisão que a produção foi
obrigada a tomar". Medido em 422 elementos: distribuições **indistinguíveis**
(mediana 28,7 × 25,6 mm). Numa arte com pintura geral **todo** elemento pousa
sobre tinta. → serve para excluir o ramo caro, nunca para confirmá-lo.

### 3.4 Convenções misturadas no mesmo struct
`bbox` é (linha, coluna); `centroid` é (x, y). Desempacotar como (y, x)
**colapsou 6 elementos em 3**.

### 3.5 Caixa do elemento pela união das regiões
Bastava uma região espalhada cair no elemento para a caixa virar a face inteira —
a do "nome" ocupava **99,9%**. Era o "bounding do BURES quebrado" e a causa de o
kraft não aparecer. → caixa semântica + descarte de região que extrapola 1,6×.

### 3.6 Union-find transitivo na fusão de tons
A~B e B~C juntava A e C mesmo longe. Nos 6 azuis do 137 (ΔE 7,5–8,9 consecutivos)
a cadeia colapsou num tom só, **extremos a ΔE 39,6** — e o plano os descrevia como
"bandas do mockup", o oposto do que são.

### 3.7 A fusão inteira era remendo de artefato
Os ΔE 9,7 e 13,0 da BURES eram **artefato do passo do grid** do seeder, não
propriedade da arte. Eu compensava um erro do motor e, ao compensar, criava outro
pior.

### 3.8 Aerografia estruturalmente incapaz de tocar tinta
`touches[]` é indexado por `owner.get()`, chave que regiões `FOTOGRAFICO` nunca
recebem — eu as desviava antes. O polvo perdeu **28,59 m** de T-T, creditados à
faixa, e caiu na rota mais barata quando a certa era a mais cara.

### 3.9 A rota `AEROGRAFIA` nunca era lida
`build_steps` testava `tipo != "FAIXA"` e jamais consultava a rota. Era etiqueta
decorativa: o polvo recebeu adesivo **por acidente**.

### 3.10 O prompt que consertou a BURES quebrou a mar e rio
Escrevi *"o símbolo, o nome escrito e a linha descritiva são TRÊS elementos"*. O
modelo obedeceu e devolveu **três fatias horizontais de um retângulo só**. Efeito
colateral: "ainda mais" e "perto de você" caíram na caixa da faixa e foram
**orçados como fita amarela**. Texto cobrado como fita.

### 3.11 Bugs de ordem no `LABEL_MAP`
`razão social` → `REDE_SOCIAL` (a agulha `"social"` vem antes). `marca escrita` →
`LOGOMARCA` (`"marca"` sombreia). E `faixa` caía em `ORNAMENTO`, apagando a rota
de fita — o Qwen acertava e eu descartava na normalização.

### 3.12 Caixa × forma, três vezes
Empapelamento, verniz e cobertura. Cada correção resolvia um caso e quebrava
outro, porque eu escolhia entre as duas em vez de dar a cada uma o seu papel.
→ resolvido repartindo a superfície por **território** (peça cuja forma está mais
perto): os papéis se encostam sem se sobrepor.

### 3.13 Uma edição rejeitada permaneceu no arquivo
A rejeição interrompeu o comando, mas a alteração já havia sido gravada. Passei
duas rodadas "corrigindo" algo que continuava lá. Só apareceu quando fui **ler o
código** em vez de confiar no que achava ter escrito.

### 3.14 Diagnóstico errado antes de medir
Culpei o `background_index` de índice único pelo `toca_tinta=True` geral. Medido:
o 137 tem 3 cores na paleta e **4 fronteiras PAINT_PAINT contra 121
WITH_BACKGROUND** — o motor estava correto. O erro era meu.

### 3.15 Calibração invalidada duas vezes
- Rodada 1–2: a amostra vinha ordenada só por espessura e cheia de **cor sobre
  chapa**, onde não se corta. O dono marcou "corto" em tudo.
- Rodada 3: filtrei por cor sobre cor, mas com dois falsos positivos — **filete
  branco entre as cores** (o anel de vizinhança pulava por cima) e **tons da mesma
  tinta** partidos pelo quantizador. O único "não corto" marcado nem era T-T.

### 3.16-a Apliquei a versão que o agente tinha desaconselhado
O diagnóstico da quantização trazia, na lista de riscos, "mitigação obrigatória:
emitir flag `DEGRADE` na região em vez de descartar". Apliquei o caminho que
absorve, e o dono corrigiu na primeira olhada. **Ler a lista de riscos com o
mesmo peso do patch.**

### 3.16 Silhuetas invisíveis
`#01` e `#02` da rodada 3 não mostravam nada: traço de 9,2 mm com compacidade 196
some ao reduzir a face inteira para caber na página. → recortar em volta da forma.

---

## 4. O que aprendi sobre o processo de trabalho

**Medir antes de afirmar.** Três diagnósticos meus caíram quando fui medir (§3.3,
§3.14, e o `dominant_curve` que achei quebrado e estava certo).

**Ler o código em vez de lembrar dele.** §3.13 custou duas rodadas.

**Correção sem teste de regressão é troca de bug.** Foi o padrão de toda a §1.

**Distinguir o que o dono disse do que eu derivei.** O catálogo marca cada regra
com a fonte justamente para que uma medição minha nunca sobreponha uma palavra
dele.

**Números escolhidos não podem ser apresentados como medidos.** Seis dos valores
em uso são chute meu, e agora estão listados como tal.
