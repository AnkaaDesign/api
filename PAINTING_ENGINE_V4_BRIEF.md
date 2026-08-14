# Motor de Análise e Precificação de Layout — Brief de reimplementação

> **Para quem lê:** este documento existe para que o motor seja **reimplementado do
> zero**. Ele descreve *o que tem de ser entregue* e *o que o dono precisa ver e
> poder mudar na tela*. **Ele deliberadamente NÃO descreve como o motor deve
> funcionar por dentro** — a arquitetura, os algoritmos de visão computacional, a
> ordem dos estágios e as estruturas de dados são decisão de quem implementa.
>
> **Status:** documento vivo. Supersede o comportamento de plano/UI descrito em
> `PAINTING_V3_WORKFLOW_SPEC.md` e a arquitetura de `PAINTING_COST_ENGINE_PLAN.md`.
> A relação completa com a documentação anterior está no §10.

---

## 0. A hierarquia da verdade

Existe muita documentação acumulada sobre este assunto e **nenhuma dela é a
verdade**. Ela é o registro de um motor que errou, foi corrigido, errou de novo
por causa da correção, e assim por diante. Serve como catálogo de armadilhas —
não como especificação.

A verdade está sendo construída agora, layout a layout, pelo dono:

| nível | fonte | peso |
|---|---|---|
| 1 | **As fichas de análise por layout** (§9) — o dono analisando cada arte real e dizendo o que faria | **manda em tudo** |
| 2 | Correções diretas do dono registradas com aspas | manda sobre qualquer medição |
| 3 | Números medidos em arte real, com o valor e o método registrados | vale enquanto ninguém medir melhor |
| 4 | Documentação legada (§10) | histórico e catálogo de erros; **nunca especificação** |

**Regra dura:** quando uma medição minha contradisser uma frase do dono, a frase
do dono vence. Quando duas fichas contradisserem uma à outra, isso não é conflito
— é **discriminante** (§8.4), e é a informação mais valiosa que existe aqui.

---

## 1. O produto, em uma frase

Um sistema que recebe a **imagem de um layout enviada pelo cliente** e devolve o
**processo de pintura inteiro, passo a passo, precificado** — onde cada passo é
uma operação real de oficina, mostrada num quadro que reproduz o estado da peça
naquele instante, com as quantidades de cada material, o tempo, o custo, a
explicação de por que aquela decisão foi tomada — **e todos os passos e todas as
decisões podem ser alterados à mão pelo revisor.**

Duas metades, igualmente importantes:

- **Analisar** — extrair da imagem tudo que decide o processo. Isso exige
  tratamento de imagem pesado e várias técnicas de visão computacional operando
  em conjunto (§8).
- **Precificar** — transformar a análise em passos, materiais, horas e preço,
  com cada número auditável até a sua origem (§7).

**O motor propõe. Quem fecha é o revisor.** Um motor que acerta 90 % e não deixa
corrigir os 10 % é inútil; um motor que acerta 70 % e deixa corrigir tudo em três
cliques é usável no dia seguinte. **A editabilidade é o requisito nº 1, não um
extra.**

---

## 2. Vocabulário obrigatório

Termos errados já produziram decisões erradas. Use exatamente estes:

| termo | significado |
|---|---|
| **adesivo** / **vinil** | a peça recortada no plotter. **Nunca é o produto final — é sempre máscara.** Nunca dizer "máscara de máquina" |
| **adesivo impresso** | **não existe no fluxo.** A empresa não usa e nunca usou. Jamais propor |
| **depilação** | remover do adesivo a parte que libera a cor da vez. O adesivo é aplicado **inteiro**; o que muda entre sessões é o que se depila |
| **demão de fundo** | a cor de campo **do desenho**, aplicada no painel inteiro antes de tudo. **Não é a cor da chapa** |
| **chapa** | o implemento como chegou. Pode ou não coincidir com a cor de fundo do desenho |
| **fronteira compartilhada** | trecho onde **duas tintas** se encostam. É o que exige corte à mão. Tinta encostando no campo não conta |
| **empapelamento** | proteção com papel + fita ao redor da área que vai receber tinta |
| **mascaramento** | proteção de precisão, rente à aresta |
| **aerografia** | pintura de tom contínuo, à mão livre. "Pintura artística à mão" é o mesmo que aerografia — não são duas coisas |
| **espovo** | estêncil de kraft furado + carvão para transferir o desenho |
| **face** | lateral esquerda, lateral direita, traseira, frontal. Cada uma tem seu próprio plano |
| **passo** | uma operação de oficina. É a unidade de saída do sistema (§4) |

---

## 3. Entradas, e o que não se pode presumir

### 3.1 O que entra

- **A imagem do layout** enviada pelo cliente, por face. É a entrada canônica e
  quase sempre a única. O cliente não manda vetor.
- **Medidas do implemento**, quando existirem — às vezes no nome do arquivo, às
  vezes ditas pelo comercial, na maior parte das vezes **ausentes**.
- **Dados do implemento**: tipo, substrato (chapa lisa / corrugada / rebitada /
  isoplastic / lona), cor com que chega, componentes que precisam ser
  desmontados.
- **Catálogo de tintas e materiais** do ERP, com preços de estoque.
- **Parâmetros de processo** — consumos por m², velocidades por m², custo-hora,
  esquemas de demãos.

### 3.2 O que o motor não pode presumir sozinho

Cada item abaixo, se presumido errado, inverte decisões e o orçamento inteiro.
**Todos têm de aparecer na tela como premissa explícita, com a fonte, e todos têm
de ser editáveis.**

| premissa | por que não se presume |
|---|---|
| **escala** | não existe escala universal no acervo. A maioria das artes não declara medida. Erro de escala já transformou um contorno de 5 cm em "menos de 6 mm" e inverteu a técnica |
| **cor real da tinta** | a imagem carrega **identidade** (que regiões compartilham cor) e **topologia**, não cor de tinta. A mesma tinta sai com hex diferente em faces diferentes do mesmo layout. Cor real vem do catálogo ou do cliente |
| **cor de chegada do implemento** | não está na arte, e é a maior variável do orçamento: decide se a demão de fundo é de graça ou é o item mais caro do serviço |
| **substrato** | não está na arte, e decide a técnica de fita e de mascaramento |
| **o que é chapa e o que é tinta** | a decisão mais cara do layout. Um campo claro pode ser a chapa preservada (sai de graça) ou uma demão de verdade (o serviço inteiro muda de patamar) |
| **intenção do cliente** | arte com defeito, degradê, elemento ambíguo — não se resolve medindo. Vira pergunta (§6.4) |

**Regra:** o motor **nunca afirma milímetro sem escala confirmada**. Sem escala
ele ainda pode entregar proporção, topologia e a estrutura do plano — e tem de
dizer, na tela, que o valor é proporcional e não métrico.

### 3.3 O implemento não é a arte

A pintura geral, a lavagem, o mascaramento do chassi, o empapelamento dos perfis
metálicos, a desmontagem e a remontagem de componentes **são atributos do
implemento, não da arte**. Um plano que nasce inteiro da imagem cobra o
mascaramento do chassi uma vez por face e inventa quatro pinturas de fundo.

São **dois programas de produção que se cruzam**:

- **programa do implemento** — vale para a peça toda, acontece uma vez, e a
  geometria dele vem das medidas do implemento;
- **programa da arte** — vale por face, e a geometria vem da imagem.

O plano final é a intercalação dos dois na linha do tempo, respeitando as curas.

### 3.4 Parâmetros de oficina — cadastro, não código

Existe um conjunto de valores que descreve **como esta oficina trabalha**. Eles
têm valor padrão vindo da prática, mas mudam com o tempo, com o material
disponível e com o tipo de serviço. Eu preciso poder alterá-los sem que ninguém
mexa no sistema, e nenhum deles pode aparecer no meio de uma decisão sem estar
visível na tela e sem poder ser mudado ali. As famílias:

| família | do que se trata |
|---|---|
| **Sistema de pintura** | quantas demãos de cada produto, em que ordem, e o que é opcional, por tipo de tinta |
| **Consumo** | quanto de cada insumo por unidade de trabalho |
| **Produtividade** | quanto tempo cada tipo de trabalho leva por unidade |
| **Folgas e margens** | a sobra que cada tipo de peça precisa em volta do que ela protege ou aplica |
| **Material em bobina** | larguras disponíveis, e quando se emenda |
| **Mascaramento por posição** | quanto de fita e de papel cada posição estrutural consome — perfil de cima, de baixo e lateral não consomem igual |
| **Simplificação de contorno** | o tamanho abaixo do qual um vazio interno deixa de ser contornado na prática |
| **Cura e calendário** | quanto tempo cada acabamento precisa antes do passo seguinte, e o que isso faz com o dia |

---

## 4. A unidade de saída é o PASSO

### 4.1 O que é um passo

Um passo é **uma coisa que alguém faz na oficina**, no nível em que o pintor
descreveria. Não é um estágio do pipeline, não é uma sessão de cálculo, não é
uma fase abstrata. Se o passo não corresponde a alguém pegando uma ferramenta e
fazendo algo na peça, ele não devia existir.

Todo passo carrega, obrigatoriamente:

| campo | o que é |
|---|---|
| **o que se faz** | uma frase no vocabulário da oficina |
| **escopo** | implemento inteiro · face · elemento · cor |
| **estado da peça** | como a peça está **no início deste passo** (§5.2) |
| **geometria de atuação** | onde exatamente se atua, desenhado no quadro |
| **materiais** | item, medida-base, consumo por unidade, quantidade, unidade, preço unitário, total |
| **tempo** | medida-base × taxa, com a taxa visível |
| **dependências** | o que precisa estar pronto/seco/curado antes |
| **justificativa** | por que este passo existe e por que assim (§5.4) |
| **confiança** | e o que a rebaixou |
| **edição** | o que dá para mudar aqui (§6) |

### 4.2 O catálogo de passos — classes, não casos

Abaixo estão as **classes** de passo. Nenhuma delas é um caso particular de um
layout: são operações do processo que aparecem ou não conforme as condições. O
motor tem de tratar cada uma como um handler parametrizado, com sua própria
geometria, seu consumo e sua explicação.

**Grupo A — Preparação do implemento** *(condicional: só existe se houver
pintura geral)*

1. **Lavagem** — área de atuação: toda a superfície a ser pintada. Consumo por m²
   dos produtos de lavagem, incluindo os abrasivos/consumíveis contados por
   unidade por m².
2. **Secagem**.
3. **Desengraxe** — área de atuação e consumo por m² próprios.
4. **Preparação mecânica do substrato** (lixamento e correlatos), quando o
   substrato exigir.
5. **Desmontagem de componentes** — portas, equipamentos, lanternas, ferragens,
   sinalização. Depende da face e do implemento, não da arte.
6. **Empapelamento e mascaramento das partes que não recebem tinta.** Esta classe
   é paramétrica e é onde mora boa parte da conta de material:
   - a lista de **elementos estruturais protegidos** (perfis/frames metálicos,
     chassi, borrachas, faixa refletiva, rodagem, etc.) e a **técnica de proteção
     de cada um** vêm de uma tabela configurável por tipo de implemento —
     **não da imagem**;
   - a **extensão de cada elemento estrutural deriva das medidas do implemento**.
     O comprimento de um elemento longitudinal acompanha o comprimento do
     painel; o de um elemento vertical acompanha a altura;
   - a técnica de cada elemento é uma de: **só fita**, **fita + papel**,
     **líquido de mascaramento**, e o consumo sai da técnica:
     - o **número de passadas de fita** de um elemento é função da largura dele
       contra a largura da fita — elemento estreito fecha com passadas de fita e
       dispensa papel; elemento largo leva papel e a fita só prende;
     - **papel se conta em metro corrido** pela largura da bobina, nunca em m²;
     - **fita se conta em metro corrido** pelo contorno colado;
     - **líquido de mascaramento se conta por volume sobre a área coberta**;
   - a **isolação na junta entre a superfície pintada e a parte protegida é de
     precisão**: fita rente à aresta, ao longo de toda a junta, porque a tinta
     não pode encostar na parte protegida. Essa metragem é um item próprio e tem
     de aparecer separada do empapelamento generoso.

**Grupo B — Pintura geral** *(condicional)*

7. **Preparo da tinta** — por cor, com o esquema de demãos do sistema escolhido.
8. **Demão de fundo / preparação** — quantas demãos o sistema exigir.
9. **Demão de cor** — idem.
10. **Verniz** — quando o sistema exigir. **Removível pelo revisor.**
11. **Cura** — um passo de espera de verdade, que ocupa lugar na linha do tempo.

**Grupo C — Arte** *(por face; o bloco C4–C9 se repete por ciclo)*

12. **Preparação da superfície para o adesivo** — desengraxe localizado nas
    áreas que vão receber adesivo. A geometria aqui é **simplificada** (§4.4).
13. **Plotagem e depilação do adesivo** — trabalho de bancada, fora da peça.
    A máquina de corte **nunca é gargalo**; este passo é tempo de manuseio.
14. **Aplicação do adesivo** — cada adesivo tem uma **caixa física** (a folha de
    vinil) com folga em torno do contorno recortado. Mostrar a caixa **e** o
    contorno.
15. **Empapelamento em volta do adesivo** — papel encostado na caixa do adesivo,
    preso por fita na junta entre o papel e o adesivo. A **orientação de cada
    peça de papel decorre do lado que ela protege**: peças laterais na vertical,
    peças de topo e base na horizontal. Papel e fita em **metro corrido**.
16. **Depilação da vez** — abrir no adesivo só a cor que entra agora.
17. **Pintura da cor** — todas as áreas daquela tinta que entram nesta rodada,
    em uma passada só.
18. **Cobertura da cor pintada** — antes da próxima cor entrar.
19. **Corte à mão** — quando duas tintas compartilham fronteira. **É o único
    corte que custa**, e o custo é proporcional ao **comprimento da fronteira
    compartilhada**, não ao tamanho da forma.
20. **Verniz intermediário + cura**, **reaplicação de adesivo**, **aerografia**,
    **aplicação de fita** — passos que só existem quando a condição do elemento
    os exige.

**Grupo D — Fechamento**

21. **Remoção de mascaramento e empapelamento.**
22. **Verniz final.**
23. **Remontagem** dos componentes desmontados.
24. **Inspeção e retoque.**
25. **Limpeza final.**

> **O plano é montado por condição, não por template.** Uma face sem pintura
> geral não tem os passos do Grupo A: não se lava, e o empapelamento é só uma
> cinta ao redor de cada adesivo. Emitir o ciclo de preparação inteiro numa peça
> que não leva pintura geral infla o orçamento com horas que não acontecem — e
> emitir passos vazios de placeholder é pior ainda: **nunca gerar passo sem
> conteúdo real.**

### 4.3 A linha do tempo: dia, cura e sessão

- A unidade de calendário é o **dia de trabalho**, não a hora. Uma cura entre
  pintura e adesivo não é "espere N horas": é **"pintou hoje, o próximo passo é
  amanhã"**. O plano tem de mostrar essa quebra visualmente.
- **Cores que não se encostam podem entrar na mesma rodada.** O número de
  rodadas é uma propriedade do grafo de contato entre as cores, não a contagem
  de cores.
- A cura, a espera e a quebra de dia são **editáveis** — inclusive para juntar
  ou separar dias.

### 4.4 Resolução de execução — a simplificação é uma feature

Todo passo tem uma **tolerância de execução**: a menor geometria que faz sentido
representar naquele passo. Abaixo dela, a geometria é simplificada.

O motivo é físico: um operador não evita com precisão um vazio pequeno dentro de
uma área grande de trabalho. Num passo de preparação de superfície, os vazios
internos abaixo da tolerância são **absorvidos** — a área de atuação é o contorno
simplificado, não a forma exata. Já num passo de pintura ou de corte, a mesma
geometria precisa aparecer inteira.

Portanto: **a tolerância é um parâmetro por classe de passo, visível na tela e
editável**, e o quadro tem de mostrar qual geometria está sendo usada. Um sistema
que usa a mesma geometria em todos os passos está errado nos dois sentidos —
detalha demais na preparação e de menos no corte.

### 4.5 Caixa e forma são duas grandezas, e cada uma manda numa coisa

Esta foi a causa raiz de mais defeitos do que qualquer outra no motor anterior:
escolher entre uma representação e outra quando **as duas são necessárias e
mandam em coisas diferentes**.

| representação | manda em |
|---|---|
| **caixa envolvente** | onde o adesivo é aplicado · onde o papel pousa · onde o verniz vai · **consumo de tinta** (pinta-se a janela, não o contorno da letra) |
| **forma real** | onde a tinta entra · o que precisa ficar exposto · **comprimento de corte** · fronteira compartilhada |

Nenhuma substitui a outra. Caixas de peças vizinhas se sobrepõem e precisam ser
repartidas por proximidade da forma, senão uma apaga a outra.

---

## 5. O que eu quero ver na tela

### 5.1 A tela do plano

- **Cabeçalho de premissas**, sempre visível: medidas apuradas e **de onde vieram**
  (declarada · apurada · editada), escala, substrato, cor de chegada, sistema de
  pintura, face. Cada uma editável no lugar.
- **A linha do tempo dos passos**, agrupada por dia, com as barreiras de cura
  desenhadas. Dá para ver o processo inteiro sem abrir passo nenhum.
- **Totais** — tempo, material, mão de obra, preço — sempre abríveis até a conta.
- **Painel de pendências**: tudo que o motor não conseguiu decidir sozinho, como
  **perguntas em português**, não como avisos técnicos (§6.4).
- **Painel de divergências**: onde duas leituras da imagem discordaram (§8.3).

### 5.2 A tela do passo

Três blocos, nesta ordem de importância:

**1. O quadro.** É o coração da tela. Ele mostra **o estado real da peça no
início daquele passo** — não a arte final com um filtro por cima:

- na lavagem, a peça como chegou: painel em branco, sem arte nenhuma;
- depois da demão de fundo, o painel na cor de fundo;
- depois dos adesivos, o painel com os adesivos e o papel desenhados;
- no meio da sequência de cores, o painel com as cores já pintadas e só elas.

Sobre esse estado, as **camadas do passo**:

| camada | o que desenha |
|---|---|
| área de atuação | a superfície que este passo trata, com a geometria da tolerância do passo (§4.4) |
| material aplicado | papel, fita, líquido, adesivo — desenhados na posição e na orientação reais |
| contorno de corte | o traço que o plotter percorre, vetorial |
| caixa do adesivo | a folha física, com a folga |
| fronteira compartilhada | destacada, porque é ela que paga o corte à mão |
| cotas | as medidas escritas em cima do desenho |

Requisitos do quadro:

- **camadas ligáveis e desligáveis**, com legenda que traz a quantidade de cada
  item ao lado do nome;
- **desenho vetorial** a partir dos contornos extraídos — não filtro de CSS sobre
  a imagem;
- **passo sem geometria própria** (uma espera de cura, uma desmontagem) mostra o
  estado da peça e diz que nada é feito nela. **Nunca mostrar a arte crua sem
  nada.**

**2. As contas.** Uma tabela por passo, uma linha por item:

`item · medida-base · consumo por unidade · quantidade · unidade · preço unitário · total · fonte`

E, em separado, o tempo: `medida-base × taxa = tempo`, com a taxa visível.

**Toda linha mostra a fonte do número** — do dono, medido, catálogo do ERP,
parâmetro de configuração, ou estimativa. Sem isso é impossível distinguir "o
motor mediu errado" de "o parâmetro está errado", e essa distinção é o que
permite corrigir a coisa certa.

**3. A justificativa.** Ver §5.4.

### 5.3 Como quero ler as quantidades

- **m²** para o que se mede por área: tinta, lavagem, desengraxe, adesivo.
- **metro corrido** para o que se mede por comprimento: fita, papel de bobina,
  corte à mão, fronteira.
- **unidade** para o que se conta: folhas, peças, consumíveis.
- Sempre a **medida-base**, o **consumo por unidade** e o **total**, nessa ordem.
  Nunca só o total — o revisor precisa poder discordar do consumo sem refazer a
  conta.

### 5.4 A justificativa — duas camadas

Toda decisão do motor aparece explicada em **duas camadas separadas**:

**Camada 1 — a frase.** Duas a quatro frases, em português simples, no vocabulário
da oficina, sem jargão técnico e sem nome de algoritmo. Ela responde a três
coisas:

1. **o que foi visto** na arte;
2. **o que foi decidido** por causa disso;
3. **o que mudaria** se a decisão fosse outra — o efeito em tempo e em custo.

O terceiro item é o mais importante e é o que costuma faltar: o revisor precisa
saber **quanto custa a decisão** para decidir se quer mudá-la.

**Camada 2 — a trilha.** Recolhida por padrão, aberta a um clique: os números
medidos, os limiares comparados, os sinais que concordaram e os que discordaram,
e o que rebaixou a confiança. É aqui que mora o técnico. **Nunca misturar as duas
camadas** — a frase perde a força e a trilha vira ruído.

### 5.5 Confiança

Confiança não é enfeite: é o que direciona a atenção do revisor. Ela aparece por
elemento, por decisão e por passo, e **é ordinal, não booleana**. E toda confiança
baixa vem acompanhada do **motivo** — o que faltou para o motor ter certeza.

---

## 6. Edição manual — é uma feature, não um caso

Esta é a seção mais importante do documento. Não existe layout suficientemente
bem analisado para dispensá-la, e **nenhum eixo de edição pode ser tratado como
exceção de um caso particular**: cada um é um recurso geral do produto.

### 6.1 O que tem de ser editável

**Estrutura do plano**
- adicionar, remover, reordenar, dividir e fundir passos;
- marcar um passo como não executado, mantendo-o visível e fora da conta;
- mover um passo entre dias; juntar ou separar dias; alterar as curas.

**Decisões de análise**
- a **técnica/rota** de qualquer elemento;
- a **classificação de acabamento** de qualquer elemento — inclusive rebaixar um
  acabamento caro para um simples, que é uma decisão comercial legítima e tem de
  custar menos na hora em que é feita;
- a **paleta**: declarar que duas cores são a mesma tinta, ou que uma cor lida
  como única são duas;
- o **agrupamento em elementos** e o **agrupamento em adesivos**;
- a **topologia** e a **ordem** entre as cores;
- o que é **chapa** e o que é **tinta**.

**Materiais e sistema**
- a **tinta de cada cor**, escolhida no catálogo do ERP — o motor propõe por
  aproximação e o revisor troca;
- o **sistema de pintura** e, com ele, o **esquema de demãos**: quantas demãos de
  fundo, quantas de cor, se leva verniz;
- qualquer **material** de qualquer passo, e o **consumo por unidade** de cada um.

**Geometria**
- mover e redimensionar caixas de adesivo;
- alterar a orientação e a posição das peças de papel;
- ajustar a tolerância de execução de um passo (§4.4).

**Premissas e parâmetros**
- escala, medidas, substrato, cor de chegada;
- todas as taxas de produção e o custo-hora;
- todos os preços.

### 6.2 O que acontece quando eu edito

1. **Edição é sobreposição, nunca destruição.** O valor proposto pelo motor
   continua visível ao lado do valor editado, e dá para voltar a ele.
2. **Recalcula o que vem depois.** Trocar uma tinta muda demãos, tempo, material
   e talvez a ordem. Trocar um acabamento pode apagar passos inteiros e criar
   outros.
3. **Mostra o delta.** Antes → depois, em tempo e em dinheiro, imediatamente.
   Sem isso o revisor edita às cegas.
4. **Diz o que caiu e o que nasceu.** Nenhum passo pode sumir em silêncio.
5. **Travar é possível.** Um passo ou uma decisão travada não é desfeita por
   recálculo posterior.
6. **Desfazer e refazer** em toda a sessão de edição.

### 6.3 Procedência e escopo

Toda edição registra **quem**, **quando**, **o motivo** (opcional) e o **escopo**:

- **só neste orçamento** — não vira regra;
- **sempre que** (uma condição) — vira regra candidata;
- **sempre** — vira regra.

O escopo é o campo que impede a generalização indevida, e é por onde o motor
aprende. **Duas travas obrigatórias:**

- uma regra nova **não altera retroativamente** orçamento já fechado;
- uma regra nova **não entra sem passar no corpus de regressão** (§8.5).

### 6.4 Perguntas em vez de palpites

Há coisas que não se resolvem medindo. Nesses casos o motor **não escolhe em
silêncio**: ele emite uma **pergunta**, em português, com as opções e o efeito de
cada uma em tempo e custo, e segue com um default declarado até ser respondida.

São perguntas, entre outras: o que não está na arte (substrato, cor de chegada,
medidas), o que depende da intenção do cliente (como resolver um acabamento que
o processo não faz, se um defeito de arte é erro ou proposital), e o que depende
de aprovação (quando o mesmo painel tem mais de uma marca, cada uma pode ter um
aprovador diferente).

---

## 7. Precificação

### 7.1 Duas grandezas que não se substituem

> **Área paga tinta. Fronteira paga hora.**

Essa é a descoberta central da série de análises, e ela tem de estar embutida na
estrutura do cálculo, não aparecer como um coeficiente:

- **material** escala com **área** (e com o esquema de demãos);
- **mão de obra** escala com **comprimento** — de fronteira compartilhada, de
  corte, de fita, de junta a mascarar — e com o **número de ciclos**.

Painéis com muita área pintada e quase nenhuma fronteira são baratos de mão de
obra; painéis com pouca tinta e fronteira densa são caros. Um modelo que
precifica por área erra por múltiplos, nos dois sentidos.

### 7.2 O que multiplica o custo

O que encarece não é o número de cores. É o **número de ciclos** — cada ciclo
extra de "pintar → esperar → aplicar adesivo de novo → pintar" custa material,
espera e um dia. O motor tem de contar ciclos e mostrar quantos são, e por que
cada um existe.

### 7.3 De onde vem o preço

- **Materiais**: preço de estoque do ERP. Material sem preço aparece como
  **quantidade sem custo e sinalizado** — nunca como zero.
- **Mão de obra**: custo-hora configurável.
- **Tempo**: taxas de produção configuráveis, cada uma com a fonte declarada.
- **Calibração**: os tempos têm de ser calibrados contra o tempo real já
  registrado no ERP nas ordens de serviço e nos serviços de aerografia
  executados, e não permanecer como estimativa indefinidamente.

### 7.4 Toda conta é auditável

Nenhum número aparece sem origem. Um número escolhido sem observação tem de estar
**marcado como tal na tela** — é o que permite que o revisor saiba em quem
desconfiar primeiro quando um plano sair estranho.

Uma quantidade de tinta é **mistura pronta**, não tinta pura: catalisador e
diluente têm preço próprio, existem no estoque e entram na conta.

---

## 8. A análise: exigências e modos de falha

> **Esta seção não prescreve algoritmo.** Ela lista o que a análise precisa
> entregar e, principalmente, **as armadilhas já medidas em arte real**. Elas são
> a parte mais cara deste documento: cada uma custou uma rodada inteira de
> trabalho. Como resolvê-las é decisão de quem implementa — **ignorá-las não é.**

### 8.1 Uma técnica isolada não resolve nenhum acervo real

Está medido: **o mesmo parâmetro, no mesmo acervo, erra nos dois sentidos
opostos.** Uma configuração que separa corretamente cores próximas de um mosaico
funde uma rampa contínua em cores falsas; a configuração inversa faz o oposto. Não
existe limiar único que sirva às duas — e as duas artes estão no mesmo acervo, do
mesmo cliente, no mesmo dia de trabalho.

A consequência é estrutural: **o discriminante não pode ser só cromático.** Ele
precisa vir de propriedades diferentes da imagem, medidas por caminhos
independentes, que se confirmem ou se contradigam. Quando se contradizem, isso é
informação — vira divergência exposta (§8.3), não voto silencioso.

O mesmo vale para todo o resto da análise: identificar elemento, medir traço,
medir fronteira, classificar acabamento, decidir topologia. **Toda decisão que
importa tem de ter mais de um caminho de evidência.**

### 8.2 Armadilhas medidas em arte real

Todas as classes abaixo já derrubaram uma versão do motor. Estão descritas como
**classe de problema**, não como caso.

**Cor e paleta**
- A imagem não carrega cor de tinta. Faces diferentes do mesmo layout renderizam
  a mesma tinta com valores diferentes. Casar cor entre faces por valor produz
  cores fantasma.
- Distância de cor ingênua não sustenta limiar: pares que são a mesma tinta e
  pares que são tintas diferentes se sobrepõem na métrica errada e se separam na
  métrica certa.
- A paleta tem de ser uma **partição** — cada pixel pertence a uma cor e só uma.
  Máscaras independentes que se sobrepõem fazem o motor medir a fronteira de uma
  forma consigo mesma e produzir metragens absurdas.
- Fundir tons em cadeia (A com B, B com C) junta extremos que não têm nada a ver
  um com o outro.

**Antialias — a fonte de defeito mais produtiva do acervo**
- A borda entre duas cores vira uma cor própria, e essa cor pode cair **em cima
  de uma terceira cor real da paleta**, inventando dezenas de metros de fronteira
  onde existem centímetros.
- Um fio de antialias com a mesma cor de um elemento, atravessando a face inteira,
  **funde a arte inteira num único elemento** por conectividade.
- Uma cor que nasce só de antialias não é tinta: ela desaparece quando a forma é
  levemente reduzida, e é assim que se distingue.
- Um filete claro entre duas cores significa que **elas não se tocam** — e o
  detector de vizinhança não pode saltar por cima dele.

**Medição de geometria**
- Espessura medida por varredura horizontal ou vertical mede a tangente da curva,
  não o traço. O resultado é sistematicamente absurdo para baixo.
- Espessura de faixa se mede na direção **perpendicular** ao traçado.
- Comprimento de fronteira contado por transições cruas superestima; precisa de
  correção geométrica.
- Fronteira contra o campo **não conta** como fronteira de trabalho.
- Componentes conexos espalhados adotados como elemento estouram a caixa
  envolvente e fazem um elemento ocupar a face inteira.
- Convenções de eixo e de unidade misturadas na mesma estrutura já colapsaram
  elementos distintos em um só. Convenção única, declarada.

**Sinais que enganam**
- Um sinal pode correlacionar com **a arte** e não com **o elemento**. Um sinal
  assim tem estatística linda e não discrimina nada: serve, no máximo, para
  excluir, nunca para confirmar.
- Antes de afirmar que um detector está errado, **medir**. Diagnósticos sobre o
  motor já se mostraram errados três vezes seguidas quando finalmente foram
  medidos.

**Estrutura e semântica**
- Elemento de produção não é região de cor. Uma marca com símbolo, nome e linha
  descritiva é **um** elemento, resolvido por **uma** técnica, mesmo atravessando
  várias cores.
- Agrupar por proximidade de caixa envolvente funde coisas que não têm relação —
  a distância que importa é entre as **formas**.
- **A caixa envolvente não é a área de trabalho.** Geometria invisível ou
  irrelevante dentro de uma caixa já produziu decisões erradas em outros
  subsistemas pelo mesmo motivo.
- Topologia importa e é de tipos diferentes: elementos **aninhados**, elementos
  **adjacentes** e elementos **isolados** exigem ordens de execução diferentes.
  Uma regra de ordenação pensada para aninhamento não decide nada em adjacência.
- A face traseira é sempre **recomposição** do layout, nunca a lateral em escala.
  Comparar as duas por semelhança global falha.

**Defeitos da própria arte**
- O acervo tem erro de digitação, texto truncado, espelhamento e material de
  terceiro sem licença. **O motor tem de comparar o conteúdo entre as faces do
  mesmo layout e acusar divergência** — se ninguém olhar, pinta-se errado.

**Escala**
- Estratégias diferentes de estimar escala erram em artes diferentes. É preciso
  mais de uma, um portão de sanidade sobre o resultado, e **alerta quando elas
  discordam**.

### 8.3 Divergência é saída, não erro interno

Quando dois caminhos de evidência discordam, isso **aparece na tela** como
divergência, com os dois resultados e o efeito de cada um. É informação de
primeira classe: quase toda correção importante da série nasceu de uma
discordância que estava sendo resolvida em silêncio.

### 8.4 O motor tem de carregar o discriminante, não o veredito

Ao longo da série, layouts **parecidos mas não iguais** receberam decisões
opostas. O que importa não é a decisão de cada um: é **a condição que os
separou**.

Um motor que decora "neste layout eu faço assim" quebra no próximo layout
parecido. Um motor que carrega "quando esta condição vale eu faço assim, e é isto
que a torna diferente daquele outro caso" generaliza.

**Portanto, toda regra implementada tem de registrar:**

1. a **condição** que a dispara — mensurável;
2. o **caso real** que a originou;
3. o **caso vizinho** que ela precisa **não** capturar, quando existir;
4. a **fonte** (dono, medido, derivado).

Uma regra sem contraexemplo é uma regra que ninguém testou.

**Discriminantes já identificados na série.** Cada linha é a condição que separou
dois casos parecidos, e cada uma vale como asserção de regressão:

| decisão | o que faz pender para um lado ou para o outro |
|---|---|
| **existe pintura geral?** | a cor de campo do desenho pertencer ao grupo "chapa" ou ao grupo "tinta" — são dois grupos separados por uma faixa vazia no acervo, não uma linha fina entre valores vizinhos |
| **um elemento sai de graça?** | ele ter exatamente a cor do **campo do desenho**, não a cor da chapa. O mesmo elemento é gratuito num layout e é o passo mais caro em outro, só porque o campo mudou |
| **quantos ciclos de máscara?** | topologia: elemento aninhado dentro de outra cor cobra ciclo próprio; elementos que só encostam no campo saem juntos |
| **duas regiões, uma tinta ou duas?** | se elas chegam a se encostar em algum ponto. Cores que nunca aparecem lado a lado não são decidíveis pela imagem — viram pergunta |
| **onde o mascaramento é caro?** | comprimento de aresta **entre duas tintas**. Aresta contra o campo não custa recorte à mão |
| **o que limita o recorte?** | **não é a máquina de corte** — ela corta o que for preciso. Limita o corte **à mão** e o manuseio de peça pequena |
| **o que é cortável à mão?** | espessura **e** retilineidade, e nenhuma decide sozinha: forma reta fina se corta; forma da mesma espessura que muda de direção o tempo todo, não |
| **duas cores separadas por um filete da cor do campo** | não se tocam: não geram recorte fino nem ciclo. É exatamente onde uma análise desatenta inventa contato |
| **traseira × lateral** | traseira é **recomposição**, nunca a lateral em escala. Reaproveitar geometria entre faces errou em todos os casos vistos |

### 8.5 Correção em lote, com regressão — inegociável

O histórico deste motor tem um padrão registrado e repetido: **a maior parte dos
defeitos veio de correções anteriores.** Corrigir arte por arte é otimização
gulosa e oscila — o discriminante só existe no contraste entre artes.

Requisitos:

- **corpus de regressão** derivado das fichas: cada caso vira asserção;
- nenhuma correção é considerada pronta se quebrar um caso já verde;
- ao mudar um parâmetro, **rodar o acervo inteiro e mostrar o diff arte a arte** —
  não só a arte que motivou a mudança;
- a lista de riscos de um diagnóstico tem o mesmo peso do conserto proposto.

---

## 9. O corpus de verdade: as fichas por layout

O dono está analisando o acervo **layout por layout**, do zero, dizendo o que
faria em cada um. Cada layout vira uma **ficha** com: as medições, a decomposição
em elementos, o agrupamento em adesivos, a ordem de pintura, o empapelamento, os
defeitos de arte encontrados, e a tabela de regras acumuladas marcando o que já é
firme, o que precisa do cliente e o que falta medir.

**Essas fichas são a especificação real deste motor.** Elas cobrem hoje uma parte
do acervo e continuam sendo produzidas; o motor tem de ser construído para que
cada ficha nova entre como caso e como asserção de regressão, sem quebrar as
anteriores.

O que já está fechado nas fichas produzidas até aqui — e que qualquer
implementação tem de honrar:

- **adesivo impresso não existe**: tudo é vinil usado como máscara, aplicado uma
  vez e depilado progressivamente, cor por cor;
- **a demão de fundo é a cor de campo do desenho**, no painel inteiro, primeiro,
  independentemente da cor com que o implemento chega;
- **o que sai de graça é o que tem a cor do fundo do desenho** — não a cor da
  chapa;
- **a máquina de corte nunca é gargalo**; o que custa é o **corte à mão**, e ele
  só existe na **fronteira compartilhada entre duas tintas**;
- **traço fino não é problema de corte** — é risco de depilação e de aplicação, e
  precisa aparecer como risco, não como impossibilidade;
- **mascaramento de precisão só na fronteira compartilhada**; no resto, papel
  generoso;
- **curva grande e orgânica não é vinil, é fita** — e qual fita depende do
  substrato, que não está na arte;
- **acabamento de tom contínuo não sai de recorte**: exige outra técnica ou uma
  decisão comercial de simplificar, e a decisão é do cliente, antes do plot;
- **o agrupamento em adesivos é limitado pelas bobinas disponíveis**, e emenda
  não é driver de custo; vão grande entre elementos desaconselha agrupar;
- **registro entre elementos vence aproveitamento de filme** quando os dois
  conflitam;
- **mesma tinta em profundidades de aninhamento diferentes são duas demãos.**

A lista acima é resumo. **O detalhe, com os números medidos e o raciocínio, está
nas fichas — e é lá que se resolve qualquer dúvida.**

---

## 10. A documentação anterior — o que fazer com ela

Todos os arquivos abaixo devem ser lidos **como histórico**, e nenhum deles como
especificação. O que sobreviveu deles já está incorporado acima.

| arquivo | o que é | veredito |
|---|---|---|
| `layout database/ERROS_E_CORRECOES.md` | 31 correções do dono + 16 erros técnicos meus, com a causa de cada um | **o mais valioso do lote.** Ler inteiro antes de escrever código. É a origem do §8.2 |
| `PAINTING_PRODUCTION_DOCTRINE.md` | doutrina de processo | **parcialmente superada.** Escrita antes das correções que dizem que a máquina de corte não é gargalo e que a demão de fundo é a cor do desenho. As partes de fita, aerografia e sequência seguem valendo |
| `PAINTING_CASE_CATALOG.md` | catálogo de casos com ID, condição, fonte | **o formato está certo e deve ser mantido.** O conteúdo precisa ser revalidado ficha a ficha |
| `layout database/CONHECIMENTO_DO_MOTOR.md` | o porquê de cada regra, o que foi medido, o que é chute | vale pela separação medido × chute. Conteúdo superado em cortabilidade e em fundo |
| `PAINTING_V3_WORKFLOW_SPEC.md` | diagnóstico do que existe hoje + spec de workflow | **§1 é leitura obrigatória** (é o inventário dos defeitos do produto atual). O resto está superado por este documento |
| `PAINTING_COST_ENGINE_PLAN.md` | arquitetura do motor atual | histórico |
| `PAINTING_ELEMENTS_WITHOUT_AI_ARCHITECTURE.md` | decompor em elementos sem modelo de visão | direção ainda válida |
| `PAINTING_TEACHING_LOOP_SPEC.md` | o ciclo de ensino em lote e a estação de marcação | **o mecanismo vale e deve ser preservado** (§6.3, §8.5) |
| `PAINTING_ML_STRATEGY_2026-08-12.md` | por que não treinar modelo de visão | vale a decisão: ensina-se o motor, não se treina modelo |
| `PAINTING_SEMANTIC_VISION_PLAN.md`, `PAINTING_ENGINE_V2_CLASSIFY_SEQUENCE_PLAN.md`, `PAINTING_V2_SYNTHESIS.md`, `PAINTING_BUDGET_DEEP_ANALYSIS_2026-08-05.md` | planos anteriores | histórico |
| `layout database/analysis/analysis_A..F.md` | primeira rodada de análise do acervo | **obsoleto.** Escrito sob a premissa errada de adesivo impresso |
| `layout database/analysis_v2/` | segunda rodada | histórico; herdou erros da doutrina da época |
| `painting-engine/`, `painting-vision/`, `painting-teach/` | o motor atual e a estação de marcação | **referência, não base.** A reimplementação é do zero; o que se aproveita é o catálogo de armadilhas e o modelo de marcação |

**Sobre o código atual:** ele resolve partes do problema e erra outras de forma
documentada. Vale ler para não repetir os mesmos erros — **não vale herdar a
arquitetura**, porque boa parte dos defeitos é estrutural (o plano nascendo
inteiro da imagem, a escolha entre caixa e forma, a pintura geral tratada como
atributo da arte).

### 10.1 Conflitos já identificados entre o legado e as fichas

Estes quatro não são "documento velho, ignora": são **decisões de processo em que
o legado e as fichas discordam**, e cada uma muda comportamento do motor. Não
resolver por conta própria — cada uma precisa da minha palavra.

| conflito | o legado diz | a ficha diz | por que importa |
|---|---|---|---|
| **elemento com transição de cor** | é rampa de N tons: pintam-se as N tintas, em N demãos, e depois se corta a separação para esfumar; a técnica cara fica só para tom contínuo/fotográfico | a ficha do caso 4 apresenta três saídas — executar na técnica cara, achatar, ou escalonar — como decisão do cliente, sem eleger a rampa pintada como padrão | são custos muito diferentes para o mesmo elemento, e é a decisão mais cara daquele layout |
| **branco é sempre chapa?** | "branco é chapa preservada, nunca tinta; não vira elemento nem cor a orçar", para qualquer arte | quando o campo do desenho é cinza pintado, os elementos brancos **são tinta**, e caros — vão sobre a demão curada | é a diferença entre um elemento sair de graça e virar o passo mais caro do painel |
| **lavagem em layout sem pintura geral** | chapa branca dominante ⇒ **sem lavagem**; empapelamento só em cinta ao redor de cada adesivo | as fichas ainda não trataram do preparo em layout sem pintura geral | muda o primeiro passo inteiro de metade dos layouts do acervo |
| **limite de corte à mão** | traço a partir de ~14 mm é cortável à mão, e abaixo disso não há evidência | as fichas mediram formas bem mais finas sem que isso fosse o gargalo, porque o gargalo é o corte à mão e o manuseio, não a máquina | o número existe e é útil; falta saber se ele mede o corte à mão (então vale) ou o corte da máquina (então caiu) |

---

## 11. Perguntas em aberto

Perguntas que dependem do dono ou de medição no pátio, e que o motor tem de
tratar como pendências explícitas até serem respondidas — não como defaults
silenciosos:

1. Confirmação da **altura útil padrão do painel**, que resolve a escala da maior
   parte do acervo de uma vez.
2. **Tipo de chapa** por implemento — decide a técnica de fita e não está na arte.
3. Qual o **menor elemento de vinil que sobrevive à depilação** na prática.
4. Como resolver **acabamento de tom contínuo** quando ele aparece: simplificar,
   escalonar ou executar na técnica cara — e quem aprova.
5. Casos em que a mesma cor aparece em duas variações que **nunca se encostam**:
   uma tinta ou duas? Não é decidível pela imagem.
6. **Calibração de tempo** contra o histórico real do ERP, substituindo as
   estimativas.

---

## 12. Critérios de aceitação

O motor está pronto quando, para qualquer arte do acervo:

1. **Todo passo emitido corresponde a algo que alguém faz na oficina.** Zero
   passos de placeholder, zero passos vazios.
2. **Todo passo mostra o estado real da peça naquele instante**, desenhado —
   nunca a arte final com filtro.
3. **Todo número na tela tem fonte declarada** e é rastreável até a origem.
4. **Toda decisão tem justificativa em duas camadas** (§5.4), incluindo o custo
   de decidir diferente.
5. **Todo eixo do §6.1 é editável**, a edição recalcula o que vem depois, mostra
   o delta e não destrói a proposta do motor.
6. **Toda coisa que não dá para decidir pela imagem vira pergunta**, com default
   declarado.
7. **Toda regra registra sua condição, sua origem e seu contraexemplo** (§8.4).
8. **Existe corpus de regressão a partir das fichas**, e nenhuma mudança entra
   sem rodar o acervo inteiro e mostrar o diff (§8.5).
9. **O plano do implemento e o plano da arte são programas separados** que se
   intercalam na linha do tempo (§3.3).
10. **Material e mão de obra escalam por grandezas diferentes** — área e
    comprimento — e isso é visível na conta (§7.1).

---

## 13. Como este documento cresce

A série de análises continua. A cada layout novo:

- a ficha entra como **caso** e como **asserção de regressão**;
- se o layout gerou uma decisão diferente de um caso parecido, o **discriminante**
  entra no §8.4 — essa é a parte que mais importa;
- se apareceu um passo, um material ou uma condição que o §4.2 não previa, o
  catálogo de passos cresce;
- se apareceu uma armadilha de análise nova, o §8.2 cresce;
- se uma pergunta do §11 foi respondida, ela sai de lá e vira regra.

**Nada neste documento deve ser lido como fechado, exceto os §§ 6 e 12** — a
editabilidade e os critérios de aceitação são o contrato do produto, e não mudam
com o próximo layout.
