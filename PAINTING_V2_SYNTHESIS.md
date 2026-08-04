# V2 — Síntese e decisões de integração (passos de produção como produto)

> Consolida o batch de 8 análises (2026-08-04). Fontes:
> - Lentes de artes: `layout database/analysis/` (v1) + scratchpad v2 (chapa branca / pintura geral / emblemas — regras nos resumos abaixo)
> - Engine layout: resumo `scratchpad/v2/design_layout_stage.md` (íntegra no transcript do agente)
> - Classificador+sessões: `api/PAINTING_ENGINE_V2_CLASSIFY_SEQUENCE_PLAN.md`
> - Renderer: `scratchpad/v2/design_renderer.md`
> - UX página: `web/PAINTING_BUDGET_DETAIL_UX_V2.md`

## Visão (do dono)
O wizard de detalhes mostra OS PASSOS DE PRODUÇÃO (dezenas): [Artes] → [Revisão enxuta] → [Produção passo 1..N] → [Orçamento]. Cada passo de produção = canvas simulando o estado (adesivagem em P&B com bandas rotuladas 110/50; empapelamento kraft; pintura mostrando o RETÂNGULO inteiro da cor) + tabela (Tamanho / Material / Quantidade / Tempo por unidade / Preço por unidade / Preço total). Consumo de tinta pela ÁREA DA JANELA. Emblemas multi-cor (bandeira) = sequência de mascaramento por CONTENÇÃO (verde→amarelo→azul, estrelas em adesivo), nunca aerografia.

## Decisões de integração (conflitos resolvidos)
1. **Engine emite `artifact.layout` rico (D1)**; a API (compute) converte por passo no contrato do cliente (D3): `step.visualization = {baseMode: 'BW'|'COLOR', rects:[{x,y,w,h,kind:'ADHESIVE_BAND'|'PAPER'|'PAINT_WINDOW', phase:'PRIOR'|'CURRENT', color?, label?}]}` — cena AUTOCONTIDA por passo (acúmulo é responsabilidade do compute, nunca do cliente). `label` da banda = widthClass ("110").
2. **Tabela do passo**: derivada no cliente de `step` + `materials` (D3), sem `lines[]` novo na API (D4 lines[] adiado). Novo campo `PaintingStepMaterial.sizeLabel` ("110 cm", "90 cm TKV").
3. **Sessões**: o compute (TS) é dono do sequenciamento (emblema por DAG de contenção + conflito por SOBREPOSIÇÃO DE JANELAS, não adjacência vetorial); o engine fornece geometria (strips/bandas/janelas por cor via `sessions` kwarg opcional — v2.0 usa `_default_sessions` do engine para janelas por cor e o compute refina/reordena; iteração futura: compute passa sessions ao engine).
4. **Consumo por janela**: PINTURA usa windowAreaM2 (janela ∩ bandas; geral = face inteira); persistir windowAreaM2 (coluna já criada) e manter elementAreaM2 no quantity/desc.
5. **Fronteiras somem da UI** (viram contexto do RegionPanel); "Fundo da face" → propriedades em Artes + ação do alerta; "Recalcular" → automático (debounce) + menu ⋯.
6. Classificador: Fase A (gate por tile exige gradiente suave ≥20%) + Fase B (demoção por quantização local: ≤8 cores reais, resíduo ≤15%, borda dura ≥50%) + C1–C6 das lentes. Bandeira NUNCA mais fotográfico.
7. Mapeamento de passos engine→API: APPLY_BANDS→ADESIVO_APLICACAO (plotagem/depilação continuam derivadas), PAPER→EMPAPELAMENTO, PAINT_GENERAL/PAINT_SESSION→PINTURA (AEROGRAFIA p/ sessão AEROGRAFIA). CURA/LIXAMENTO/REMOCAO seguem do compute.
8. Regras das lentes viram parâmetros/StrategyRule: strip gap 8–10 cm (fusão de faixas), W ≥ h+2×margem (piso 50; 104→110), >120 empilha com emenda 5 cm/overlap 1 cm ajustável, gap horizontal ~40 cm–1 m segmenta, full-bleed sem margem lateral, papel halo 50 cm (HALO) ou face−bandas (GENERAL_PAINT), fita crepe = perímetros−costuras, grafo de contato de janelas (tocam <5 cm → cura 3h; disjuntas → mesmo turno; sobreposição → claro→escuro + re-mascarar curado), "1 mistura N momentos", scheduler encaixa disjuntas nas curas, decal <10 mm, claro-sobre-escuro = reserva+preenchimento, verniz coletivo final.

## Plano de implementação (3 frentes)
- **F1 Engine v2 (agente)**: masks.py estágio layout (P0–P7) + params novos + pipeline DAG/alias + classifier Fases A/B + version 0.2.0 + testes (subset central: cover_height/margem, cenário fronteiras 110+50, thresholds strip/segmento, ordem GENERAL_PAINT, fixture bandeira resgatada). Base: transcripts D1/D2.
- **F2 Web v2 (agente)**: `detail/simulation/{simulation-tab,step-canvas,step-rail,step-cost-table}.tsx` (esqueletos D3), página com sequência plana via StepRail (D4), Revisão enxuta (BoundariesCard→RegionPanel), remoção do combo Fundo/Recalcular do card (auto-recalc + ⋯). Tolerante a `visualization` ausente (fallback = card sem canvas).
- **F3 Compute v2 (principal)**: consumir artifact.layout; gerar steps com visualization por cena acumulada (PRIOR/CURRENT); emblema util (DAG contenção); consumo por janela; sizeLabel nos materiais; faceId no tipo web; cascata do PATCH minutos (recalc totals já existe).

## Migrações
- `PaintingProductionStep.windowAreaM2/visualization` ✔ (20260804170000)
- `PaintingStepMaterial.sizeLabel String?` (nova)
- Seeds: novas StrategyRules (LAYOUT_*, EMBLEM_CLUSTER, PAINT_CONSUMPTION_BASIS, ENGINE_PARAMS_OVERRIDE)
