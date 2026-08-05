# Catálogo de casos — motor de pintura

Cada caso que o motor precisa acertar, com a condição que o dispara, o
comportamento esperado, e de onde a regra veio.

**Este documento é a especificação executável.** Todo caso com `ID` tem uma
asserção correspondente em `painting-vision/tests/test_casos.py`. Nenhuma
correção pode ser considerada pronta se quebrar um caso já verde — foi assim
que os defeitos se acumularam: cada conserto reintroduzia um erro anterior.

Fonte de cada regra:
- **dono** — correção direta, tem precedência sobre qualquer medição
- **medido** — número extraído de arte real, com o valor registrado
- **derivado** — consequência lógica de outra regra, sem observação própria

---

## 1. Substrato e fundo

| ID | condição | comportamento | fonte |
|---|---|---|---|
| `F1` | chapa branca domina a face | **sem lavagem**; empapelamento só em cinta ao redor de cada adesivo | dono |
| `F2` | pintura geral (cor ≠ branco domina) | lavagem + empapelamento completo (perfis, borrachas, ferragens, refletiva) + demão geral | dono |
| `F3` | qualquer arte | **branco é chapa preservada, nunca tinta.** Não vira elemento, não vira cor a orçar | dono |
| `F4` | tons quase-brancos além do dominante | também são chapa. O teste é **relativo ao fundo daquela arte** (a chapa nunca é `#ffffff` puro; mockups usam `#ECECEC`–`#F0F0F0`) | dono |

> `F4` existe porque o motor elege **um** índice de fundo (`regions.py:247`). Um
> segundo tom de branco vira tinta e todo elemento que o encosta "toca tinta".

---

## 2. Fronteiras

| ID | condição | comportamento | fonte |
|---|---|---|---|
| `B1` | elemento encosta só em chapa | **T-F.** Adesivo aplicado inteiro, sem corte manual, sem verniz | dono |
| `B2` | duas cores **do desenho** se tocam | **T-T.** Dispara a pergunta de cortabilidade (§3) | dono |
| `B3` | elemento encosta na **pintura geral** | **não é T-T.** A geral é feita no dia anterior e chega curada; o adesivo assenta direto | dono |
| `B4` | filete de chapa separa duas cores | não há contato. BURES 1: 0 fronteiras T-T, 1 sessão, 1 dia | medido |
| `B6` | detector de vizinhança | **não pode saltar o filete.** Dilatar a máscara para achar vizinhos atravessa um filete branco fino e inventa T-T. Vizinhança tem de parar na chapa | dono |
| `B7` | dois tons da mesma tinta partidos pelo quantizador | não são duas cores. Não geram T-T | dono |

> `B6` e `B7` foram os dois falsos positivos que inutilizaram a rodada 3 da
> calibração: o único "não corto" marcado (`#10`, 3 IRMÃOS traseira) tinha
> branco entre o vermelho e o dourado, e o dono apontou na hora.
| `B5` | dois tons vizinhos de uma rampa | **não é fronteira** — é uma tinta com degradê | dono |

> `B3` é o que impede uma arte de pintura geral de jogar **todos** os elementos
> na rota de verniz + espera. No 137 PESCADOS seriam 7 de uma vez.

---

## 3. Cortabilidade — decide técnica **e** ordem

| ID | condição | comportamento | fonte |
|---|---|---|---|
| `C1` | sem T-T | nunca há corte manual. Adesivo inteiro, depilado por cor | dono |
| `C2` | T-T + cor menor cortável à mão | **menor primeiro**: pinta → cura → mascara → pinta a maior. `CORTE_MANUAL` | dono |
| `C3` | T-T + cor menor não cortável | **campo primeiro**: pinta → enverniza → cura → adesivo → pinta. `ADESIVO_SOBRE_VERNIZ` | dono |
| `C4` | traço ≥ 14 mm | cortável (9 marcações, todas "corto") | medido |
| `C5` | traço < 14 mm | **sem evidência.** Marcar `incerto`, não afirmar | medido |
| `C6` | forma reta, mesmo fina | cortável. Triângulos do ACM: cor sobre cor, cortados à mão | dono |

> Cortabilidade é **espessura × retilineidade**. Nenhuma das duas decide
> sozinha: um script da mesma espessura de um triângulo é incortável porque
> muda de direção o tempo todo.

---

## 4. Fita — duas condições, a segunda é do traçado

| ID | condição | comportamento | fonte |
|---|---|---|---|
| `T1` | faixa em isoplastic ou lona | **fita amarela**, qualquer curva, sem corte | dono |
| `T2` | faixa em outro substrato, traçado até 55° da horizontal | **fita amarela** | dono |
| `T3` | faixa em outro substrato, traçado muito vertical | **fita branca** — não curva, é mais larga, **exige corte** | dono |
| `T4` | qualquer faixa | quase nunca leva adesivo | dono |

> Os 55° são **meus**, não medidos. Ancorar quando o dono apontar uma faixa que
> exigiu fita branca.

---

## 5. Aerografia

| ID | condição | comportamento | fonte |
|---|---|---|---|
| `A1` | zona fotográfica / tom contínuo | **aerografia.** Nunca impresso — impressão não existe no fluxo | dono |
| `A2` | zona de aerografia | leva adesivo **só do contorno externo**. Nada interno, nenhuma depilação de miolo | dono |
| `A3` | corte de uma zona de aerografia | mede **só o anel externo**, ignorando `holes[]` e sub-regiões | derivado de `A2` |
| `A4` | aerografia | é **técnica de pintura**, não rota de adesivo. A rota do adesivo segue as regras normais (§2/§3) | derivado de `A2` |
| `A5` | aerografia | nunca é `CORTE_MANUAL` — o contorno sai sempre no plotter | derivado de `A2` |

> `A4` corrige o modelo em que `AEROGRAFIA` era rota irmã: o polvo da "mar e
> rio" ficava incapaz de tocar tinta e perdia 28,59 m de T-T.

---

## 6. Degradê

| ID | condição | comportamento | fonte |
|---|---|---|---|
| `D1` | rampa entre N tons | **são N tintas, com N demãos.** Pinta-se todas e só depois se corta a separação para esfumar | dono |
| `D2` | render do passo de esfumaçar | mostra a rampa suavizada; nas demãos anteriores os tons aparecem separados, que é como a peça realmente fica | derivado de `D1` |
| `D3` | elemento com parte chapada + parte em rampa | **máscara dentro da máscara**: pinta a base, cobre a metade com fita e papel, aerografa o resto | dono |
| `D4` | tons encadeáveis A→B→C | **não fundir transitivamente.** 6 azuis a ΔE 7,5–8,9 consecutivos têm extremos a ΔE 39,6 | medido |

---

## 7. Ordem, cobertura e acabamento

| ID | condição | comportamento | fonte |
|---|---|---|---|
| `O1` | várias cores | **menor área primeiro** — é mais fácil de cobrir depois | dono |
| `O2` | cor pintada, com outra por vir | cobre antes da próxima | dono |
| `O3` | cobertura de uma cor | **a caixa da parte**, não as letras — não dá para recortar papel rente ao texto | dono |
| `O4` | caixas de peças vizinhas se sobrepõem | reparte por **território** (peça cuja forma está mais perto). Sem território, uma caixa apaga a outra | derivado |
| `O5` | cor pintada com outra pendente **no mesmo bounding** | cobre só a forma; a caixa inteira invadiria o que falta pintar | dono |
| `O6` | qualquer arte | o papel fica até o fim; sai só no verniz final | dono |
| `O7` | verniz | vai sobre os **boundings** do que foi pintado, não só o desenho | dono |
| `O8` | verniz | segue o adesivo — não enverniza chapa vazia entre elementos | dono |
| `O9` | adesivo | aplicado **inteiro**; o que muda entre sessões é a depilação | dono |

---

## 8. Geometria

| ID | condição | comportamento | fonte |
|---|---|---|---|
| `G1` | caixa de um adesivo | forma real **+ 8 cm** — folga entre o corte do plotter e a borda da folha | dono |
| `G2` | empapelamento | folhas de kraft de **100 cm**, com emendas | dono |
| `G3` | janela de adesivo | **retangular** — o vinil é uma folha quadrada | dono |
| `G4` | janela de fita | segue a **forma** — a fita acompanha a curva | dono |
| `G5` | altura do implemento | **2,45 m** é o padrão; serve de referência de escala | dono |
| `G6` | escala | jamais presumir. Erro de escala já inverteu decisões (contorno de 5 cm lido como "<6 mm") | medido |
| `G7` | **consumo de tinta** | pelo **bounding**, não pela forma. Não se pinta um texto de 5 cm de altura exatamente — pinta-se a janela inteira e a máscara bloqueia o resto | dono |
| `G8` | área de **corte** | pela **forma** (é o que o plotter percorre). Área de tinta e área de corte são grandezas diferentes e não se substituem | derivado de `G7` |

---

## 9. Semântica

| ID | condição | comportamento | fonte |
|---|---|---|---|
| `S1` | símbolo + nome + descritivo empilhados | **um** elemento (lock-up), um adesivo. Não fatiar por linha | dono |
| `S2` | bloco de texto de várias linhas | uma caixa para o bloco, não uma por linha | medido |
| `S3` | faixa | tem categoria própria — rota própria (fita). Não pode cair no balde `ORNAMENTO` | derivado |
| `S4` | região fotográfica | elemento próprio, nunca absorvida pela caixa vizinha | derivado de `A1` |
| `S5` | região sem dono | se somar área relevante, é elemento não nomeado — **não** é ruído | medido |

---

## 10. Sessões — agrupamento por cores que não se tocam

| ID | condição | comportamento | fonte |
|---|---|---|---|
| `M1` | várias cores na peça | pinta de uma vez **todas as cores que não se tocam entre si**; depois mascara todas elas, corta, e só então entra o próximo grupo | dono |
| `M2` | nº de sessões | é o **número cromático** do grafo "cores que se tocam", não o número de cores | derivado de `M1` |
| `M3` | mosaico de N facetas | N peças não geram N sessões. Um mosaico low-poly de 6 azuis costuma fechar em 3 ou 4 grupos | derivado de `M2` |

> Resolve `P1`. A pergunta era "teia de vinil ou cura?" e a resposta é outra: o
> que reduz sessão é **agrupar cores que não se encontram**. O 137 deixa de ser
> "26 passos porque há 7 cores" e passa a ser "K grupos, K ≈ 3-4".
>
> Implementação: colorir o grafo de adjacência entre cores (guloso por grau
> decrescente basta — o grafo é planar).

---

## 10-b. O adesivo também preserva o branco

| ID | condição | comportamento | fonte |
|---|---|---|---|
| `R1` | elemento com parte branca, sobre chapa branca | **não se pinta o branco.** Depila só a parte colorida e pinta; o adesivo fica sobre a parte branca e a chapa se preserva | dono |
| `R2` | T-T difícil demais para cortar à mão | pinta o fundo → espera secar → **aplica o adesivo de novo por cima** → pinta a segunda cor. Duas aplicações de adesivo, não um corte | dono |
| `R3` | `R2` com chapa branca de fundo | o fundo nem é pintado: a chapa branca já é o fundo. Pinta só a segunda cor | dono |

> `R1` é a reserva (`F3`) aplicada na camada do adesivo: em vez de mascarar
> para preservar, **não depilar** já preserva. Sai de graça.
>
> `R2` é a alternativa ao corte manual que eu não tinha no modelo — eu só
> conhecia `ADESIVO_SOBRE_VERNIZ`. Aqui não há verniz: pinta, seca, reaplica
> adesivo, pinta. `R3` elimina até a primeira demão.

---

## 11. Técnica de pintura — só existem duas

| ID | condição | comportamento | fonte |
|---|---|---|---|
| `N1` | qualquer elemento | a pintura é **chapada** ou **aerográfica**. Não existe terceira | dono |
| `N2` | "pintura artística à mão" | **é aerografia.** São a mesma coisa, não são rotas distintas | dono |
| `N3` | degradê | é pintura aerográfica — rampa suave não sai de pistola chapada | derivado de `N1` |

> Dissolve `P4`. As 9 "pendências de aerografia × pintura à mão" das reanálises
> **não eram decisões** — os dois nomes designam a mesma técnica. Todo bloco
> fotográfico é aerografia, ponto.

---

## 12. Casos que ainda não têm resposta

| ID | pergunta | quem decide |
|---|---|---|
| `P2` | piso de cortabilidade abaixo de 14 mm. **A primeira folha de calibração não serviu**: quase tudo nela era cor sobre chapa, e a pergunta só existe em cor sobre cor | dono |
| `P3` | limiar de "muito vertical" para fita branca | dono |

---

## Números não calibrados

Escolhidos por mim, sem observação. Primeiros suspeitos quando um plano sair
estranho:

| valor | onde | decide |
|---|---|---|
| 55° | `VERTICAL_DEG` | fita amarela × branca |
| 1,6× | filtro de região espalhada | descarte de região mal atribuída |
| 0,10 m² | `AVULSO_MIN_M2` | piso de ruído de quantização |
| 1,5 cm | folga de cobertura | papel × forma pendente |
| 5 cm | fusão de boundings | passadas de verniz |

Calibrados com o dono: **8 cm** (folga de corte) e **14 mm** (traço cortável,
só o teto — o piso segue desconhecido).
