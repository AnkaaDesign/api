# layout database

66 artes de pintura de implementos rodoviários, mais toda a documentação do
motor de análise construída em cima delas.

## Por onde começar

| documento | o que é |
|---|---|
| [CONHECIMENTO_DO_MOTOR.md](CONHECIMENTO_DO_MOTOR.md) | **comece aqui.** Tudo que se sabe sobre o processo real de pintura e sobre o comportamento do motor — com o que é medido separado do que é chute |
| [ERROS_E_CORRECOES.md](ERROS_E_CORRECOES.md) | o que deu errado e por quê. 28 correções do dono e 16 erros técnicos, com causa raiz |
| [analysis_v2/](analysis_v2/) | as 66 artes reanalisadas contra a doutrina corrigida |
| [analysis_v2/planos/](analysis_v2/planos/) | planos de produção completos, gerados ponta a ponta, com as imagens de cada passo |
| ~~[analysis/](analysis/)~~ | **obsoleto.** As análises originais violam a premissa central; mantidas só como registro do que foi corrigido |

Fora deste diretório:

| documento | o que é |
|---|---|
| `api/PAINTING_PRODUCTION_DOCTRINE.md` | as regras do processo, ditadas pelo dono. **Precedência sobre tudo** |
| `api/PAINTING_CASE_CATALOG.md` | cada caso com ID, condição e comportamento esperado — especificação executável |
| `api/painting-vision/tests/test_casos.py` | as asserções que travam o catálogo. Nenhuma correção pode deixar um caso verde vermelho |
| `api/painting-engine/` | o motor de geometria (Python, sem banco, sem regra de negócio) |
| `api/painting-vision/` | camada semântica (Qwen3-VL) + geração do plano de produção |

## A regra que organiza tudo

**Adesivo nunca é produto final. Adesivo é máscara.** Tudo que aparece pintado
foi pintado; a única etapa feita por máquina é o corte do vinil.

As análises originais violavam isso em 8 de 8 fatias, e é por isso que existe uma
`analysis_v2`.

## Como reproduzir um plano

```bash
# 1. geometria
cd api/painting-engine
PYTHONPATH=src .venv/bin/python -m painting_engine.cli \
  --input "../../layout database/BURES 2 8.40.png" \
  --reference-kind HEIGHT --reference-cm 245 \
  --out /tmp/eng.json

# 2. semântica + rotas + passos
cd ../painting-vision
export OPENROUTER_API_KEY=...
.venv/bin/python probe/production.py /tmp/eng.json \
  "../../layout database/BURES 2 8.40.png" --out /tmp/plano --substrato CHAPA

# 3. página autocontida
.venv/bin/python probe/report_html.py --report /tmp/plano --out plano.html
```

A altura de **2,45 m** é padrão e serve de referência de escala — o que resolve
as 56 artes cujo nome não traz o comprimento.

## Antes de mexer no motor

```bash
cd api/painting-vision && .venv/bin/python -m pytest tests/ -q
cd ../painting-engine && PYTHONPATH=src .venv/bin/python -m pytest tests/ -q
```

O primeiro trava o catálogo de casos; o segundo, a geometria. Rodar os dois antes
e depois de cada mudança é o que impede o padrão descrito em `ERROS_E_CORRECOES.md`
§1 de se repetir.
