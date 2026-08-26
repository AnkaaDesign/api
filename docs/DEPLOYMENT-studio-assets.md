# Publicação dos assets 3D do Truck Studio — runbook

A árvore 3D do Truck Studio **é servida pela API**, não pelo web. O web só a
versiona: `web/public/` é a árvore de origem, e o que a API entrega em
`/studio-assets/v1/` é uma cópia dela.

Quem monta o mount é `src/main.ts`, a partir de `STUDIO_ASSETS_ROOT`
(`.env.example` documenta os dois valores). A versão é **por subdiretório**
(`v1`, `v2`, …), nunca por query string, porque o mount responde
`Cache-Control: immutable` — uma URL publicada promete que seus bytes não mudam.
Geometria nova é um diretório `vN` NOVO; nunca sobrescreva arquivo dentro de um
`vN` vivo.

## Onde a árvore mora em produção — e por quê

`/srv/files/Estudio3D/`, **irmão de `Artes`, `Clientes`, `Tintas`** — não um
`/srv/studio-assets` à parte.

O motivo é operacional, não estético: `~/scripts/backup/files-sync.sh` espelha
`/srv/files/` para o HDD (`/mnt/backup/sync/`) e de lá para o Google Drive. O que
está fora dessa árvore não é copiado para lugar nenhum — os 451 MB de geometria
ficavam sem cópia alguma enquanto moravam em `/srv/studio-assets`.

**Isso é sincronização, não backup.** A fase do Drive é `rclone sync`, ou seja,
espelho: o que sumir daqui some de lá na próxima passada. Só a fase do HDD
preserva o que foi apagado, num cemitério datado (`--backup-dir`). Não trate o
Drive como cofre de versões — para geometria, o cofre é
`~/Documents/asset-backups/truck-studio/`, com `SHA256SUMS`.

Permissões: o diretório segue o padrão dos irmãos — `kennedy:ankaa`, setgid, e a
ACL default de `/srv/files` é herdada automaticamente. Se você criar `vN` com
`cp -a` a partir de outra árvore, **confira o grupo**: `cp -a` preserva o dono de
origem e o diretório sai `kennedy:kennedy`, fora do padrão do resto.

---

## Desenvolvimento — como está montado nesta máquina

`STUDIO_ASSETS_ROOT` não está no `.env`, então cai no default do `main.ts`, que
resolve para `api/studio-assets/`. Dentro dele, `v1/` é composto de **symlinks
absolutos** para `web/public/`.

**Por que symlink aqui e diretório de verdade em produção.** São problemas
diferentes. Em dev, os mesmos bytes têm um dono claro — o repositório `web`, que
versiona 123 desses arquivos — e copiá-los para `api/` criaria uma segunda
árvore de 451 MB que ninguém atualiza: bastaria alguém commitar um `.glb` novo no
`web` para o dev passar a servir a versão velha, em silêncio. O symlink torna
essa divergência impossível de existir. Em produção não há repositório `web` no
disco: o que chega é o resultado de um rsync, então a árvore é real, e aí sim ela
precisa morar onde o sincronizador enxerga.

```
api/studio-assets/v1/
  brands       -> web/public/brands
  environments -> web/public/environments
  models       -> web/public/models
  renders      -> web/public/renders
  textures     -> web/public/textures
```

**São CINCO.** `renders/` foi criado depois dos outros quatro e ficou de fora até
2026-08-09; sem ele a API responde 404 em toda a arte de card do catálogo e o
seletor abre sem imagem. Ao adicionar um diretório novo em `web/public/` que o
studio consuma, **o symlink correspondente aqui não é opcional**.

Conferência rápida (o `-L` é obrigatório — `find` não atravessa symlink sozinho):

```bash
cd api/studio-assets/v1
for d in brands environments models renders textures; do
  [ -e "$d" ] && echo "$d OK" || echo "$d FALTANDO"
done
find -L . -type f | wc -l          # 176
du -shL .                          # 451 MB
find -L models/trucks -name '*.glb' | wc -l   # 49
```

---

## 0. Antes de publicar

```bash
cd web
npx vitest run tools/verify-manifests/catalog-resolves.test.ts
```

Tem de dar **5 passed** e imprimir `7 marcas · 22 modelos · 52 chassis · 52
arquivos distintos` *(números de 2026-08-26; a versão anterior deste passo dizia
`4 passed · 24 modelos · 60 chassis · 53 arquivos`, que nunca correspondeu à
árvore)*. Se não der, **pare**: o que está em `public/` não está íntegro e
publicar espalharia o problema.

> **2026-08-26 — ele PEGOU um defeito de verdade, e é o que este passo existe
> para fazer.** Reprovou em `chassi sem render neutro` com quatro nomes:
> `volvo-vm-2015/{8x2r,4x2r}` e `vw-constellation/{8x2-tl,4x2-tl}`. Os quatro
> chassis rígidos estavam em `brands.json` sem cartão nenhum — publicar teria
> posto quatro silhuetas de placeholder no seletor. Resolvido gerando os que
> faltavam:
>
> ```bash
> # o gerador quer uma raiz que CONTENHA v1/; em dev, um symlink resolve
> mkdir -p /tmp/ar && ln -sfn "$PWD/../web/public" /tmp/ar/v1
> STUDIO_ASSETS_ROOT=/tmp/ar node tools/studio-render/shoot.mjs --neutral
> ```

> **Em 2026-08-10 ele NÃO passa**, e a diferença não é pequena: sai
> `7 marcas · 20 modelos · 49 chassis · 49 arquivos` e um teste vermelho —
> `renders.json` promete `renders/trucks/iveco/iveco-s-way-480/4x2/{neutro,
> metallica}.webp` e o diretório `iveco-s-way-480` não existe em `public/`
> (existem `iveco-s-way-440` e `iveco-s-way-metallica`).
>
> Isso é o **oposto** do caso que o `--delete` do passo 2 existe para resolver:
> aqui é a nossa árvore que tem MENOS que o esperado, então um
> `rsync --delete` apagaria do servidor os 11 chassis que só existem lá. Até o
> teste voltar ao verde, publique **arquivo a arquivo** (`scp`), nunca com
> `--delete`.

O teste lê `web/public/` direto do disco, sem mock — é a mesma árvore que o
rsync leva. Ele passa pelo carregador de verdade (`loadCatalog()` → `getModel()`
→ `getChassis()` → `fileOf()`), porque os normalizadores do motor **descartam em
silêncio** (`return null`) o que não entendem: contar 60 chassis no JSON não
prova que o motor enxerga 60.

Confira também o volume:

```bash
du -sh web/public/models web/public/renders web/public/brands
# esperado: models ~390 MB · renders ~1,5 MB · brands ~1,1 MB
ls web/public/models/trucks/*.glb | wc -l    # 49
ls -l web/public/models/vehicles/trailer.glb # ~31,3 MB, NAO 286 MB
```

Se a carreta estiver com ~286 MB, você está com o **tier fonte** no lugar do tier
web. A fonte mora em `~/Documents/asset-backups/truck-studio/` e não vai para o
servidor.

---

## 1. (Opcional) Pré-comprimir em brotli

O middleware reescreve para `.br` **só** em `.glb` e `.hdr`, e só se o arquivo
existir — nunca comprime na hora. Os GLB do tier web já saem com Draco + WebP,
então o ganho é pequeno, mas é grátis em tempo de request.

```bash
cd web/public
find models -name '*.glb' -exec brotli -q 5 -f -k {} \;
find environments -name '*.hdr' -exec brotli -q 5 -f -k {} \;
```

`-q 5`, não `-q 11`: em dado já comprimido o nível alto custa minutos por arquivo
e devolve menos de 1%. `-k` mantém o original — o middleware precisa dos dois,
porque quem não manda `Accept-Encoding: br` recebe o `.glb` puro.

---

## 2. rsync para a árvore servida

> ### Uma árvore só, desde 2026-08-12
>
> A virada foi feita: `STUDIO_ASSETS_ROOT=/srv/files/Estudio3D` e
> `/srv/studio-assets` saiu do ar. Não existe mais o par de árvores que obrigava
> a publicar duas vezes — publique só no destino.
>
> Se algum dia voltarem a existir duas, a regra antiga vale de novo: publicar só
> na que NÃO está no ar não muda nada, e o sintoma é silencioso — o upload
> confere, o `sha256sum` bate, e o `curl` devolve os bytes velhos com 200.
> Aconteceu em 2026-08-10 com o `set.glb` do distrito industrial.

**Sincronize os CINCO diretórios, um a um — nunca `web/public/` inteiro.**

```bash
for D in brands environments models renders textures; do
  rsync -avn --delete "web/public/$D/" "ankaa:/srv/files/Estudio3D/v1/$D/"   # ENSAIO
done
```

O que a árvore servida contém é exatamente o `STUDIO_ASSETS` de
`web/src/config/assets.ts` — `models/vehicles/`, `textures/`, `environments/`,
`brands/trucks/` e `renders/`. O resto de `public/` (`branding/`, `icons/`,
`messages/`, `ghs/`, `vendor/`, `fonts/`, `.well-known/`, `favicon.ico`,
`site.webmanifest`, `firebase-messaging-sw.js`) é **contrato da plataforma web**,
servido na raiz do site pelo próprio web — não tem nada que fazer sob um mount
`immutable` da API.

> Uma versão anterior deste passo mandava `rsync web/public/ → v1/`, a árvore
> toda. Em 2026-08-12 isso despejou os onze itens acima dentro de
> `/srv/files/Estudio3D/v1/` — inofensivo (ninguém os pede por ali), mas eram
> duplicatas do que o web já serve, e o rclone as levava para o Drive junto.
> Foram removidos na mesma sessão. Daí o laço por diretório.

**Rode o ensaio (`-n`) primeiro e leia a lista de `deleting …`.** O `--delete`
é o ponto do passo: é ele que tira da árvore servida o `cabs.json` aposentado
(segunda fonte de verdade), o `scania.fbx` de 46 MB e os backups de carreta. Só
deve remover:

- `models/vehicles/cabs.json`
- `models/vehicles/scania.fbx`
- `models/vehicles/trailer.glb.*`
- `models/vehicles/trailer_old_probe.glb`

Qualquer outra coisa na lista: **pare e investigue** — o servidor tem algo que a
nossa árvore não tem. Foi o que aconteceu em 2026-08-12, quando o ensaio acusou
**3.608 remoções**: quatro levas de render antigas (`renders.v4`,
`renders.novo`, `renders.escura-20260809`, `renders.leva4-20260810`, ~170 MB)
que só existiam em `/srv/studio-assets`. Publicou-se sem `--delete` e as levas
morreram junto com a árvore, na virada.

> **`rsync -a` NÃO preserva o grupo sem ser root**, e reescreve a permissão dos
> diretórios a partir da origem — ou seja, derruba o setgid. Depois de publicar,
> devolva o padrão dos irmãos de `/srv/files`:
>
> ```bash
> ssh ankaa 'cd /srv/files/Estudio3D && chgrp -R ankaa v1 \
>   && find v1 -type d -exec chmod g+rwxs {} + \
>   && find v1 -type f -exec chmod g+rw {} +'
> ```
>
> Confira com `find v1 ! -group ankaa | wc -l` e
> `find v1 -type d ! -perm -g+s | wc -l` — os dois têm de dar **0**.

---

## 2-B. ⚠️ A ORDEM IMPORTA: `brands.json` DEPOIS do bundle do web

Os cinco manifestos (`brands.json`, `renders.json`, `plates.json`,
`hitch.json`, `environments.json`) não são bytes inertes como um `.glb`: eles
são o CATÁLOGO, e quem os lê é o bundle que estiver no ar. Um chassi novo em
`brands.json` aparece no seletor **imediatamente** — inclusive para um bundle
que não tem o motor capaz de montá-lo.

Foi o caso de 2026-08-26: os dez rígidos (Scania P, VM, VW) precisam de
`vehicle/implements.ts`, `chassis-parts.ts`, `rear-bogie.ts` e companhia, e o
`dist/` em produção era de um commit anterior a todos eles. Publicar só a árvore
teria posto dez caminhões no seletor que o app não sabia montar.

**A ordem segura é:**

1. os ARQUIVOS (`.glb`, `.hdr`, `.webp`) — inertes, ninguém os pede sem
   manifesto;
2. `git pull && npm run build` em `~/repositories/web` no servidor;
3. os MANIFESTOS.

Entre 1 e 3 nada muda para quem está no ar. Se você inverter 2 e 3, a janela de
quebra é o tempo do build.

> Se só os arquivos puderem subir (o web ainda não está pronto), **segure os
> manifestos** e publique-os junto com o próximo build. É seguro: os arquivos
> ficam no disco sem ninguém pedir, que é o mesmo estado dos `.ktx2` entre
> 14/08 e 24/08.

---

## 2-C. ⚠️ `renders.json` E `plates.json` NÃO SAEM DIRETO DO REPOSITÓRIO

A árvore servida tem coisas que `web/public/` nunca teve, e a diferença é
ANTIGA — o §0 já avisa que a nossa árvore pode ter MENOS que o servidor. Medido
em 2026-08-26:

| | repositório | servidor | o que o servidor tem a mais |
|---|---|---|---|
| `renders.json` | 719 imagens | **780** | as 46 `_neutral.webp` (o nome antigo do render sem tinta, hoje `neutro.webp`) e 12 cores de `volvo-fh16-2009/2012` e `volvo-fh-2021/2024` |

> ### ✅ RESOLVIDO no mesmo dia, e a metade cautelosa desta seção estava errada
>
> Medidas as 74 uma a uma, elas são **duas coisas diferentes**:
>
> - **24 são cartões VIVOS** — as cores `0a7f4d4e`, `2eb99944` e `e45baebc` em
>   `volvo-fh16-2009/2012` e `volvo-fh-2021/2024`. As três estão na paleta ATUAL
>   de `GET /studio/colors`, ou seja o seletor as oferece. **Foram trazidas para
>   `web/public/renders/`** e agora são versionadas.
> - **46 são `_neutral.webp`** — o nome ANTIGO de `neutro.webp` —, e as cinco
>   combinações em que só elas existem (`daf-xf-euro6/6x4`, `iveco-hi-way/6x4`,
>   `iveco-stralis/6x4a`, `mb-actros-mp3/6x4a`, `scania-streamline/6x4-4`)
>   **não estão em `brands.json`**: nenhum chassi as declara, então o app nunca
>   as pede. Deixar de anunciá-las não tira cartão de ninguém.
>
> **`renders.json` voltou a sair DIRETO do repositório.** Os 46 arquivos órfãos
> continuam no disco do servidor, mudos, porque `--delete` é proibido aqui.
>
> ⚠️ **A LIÇÃO QUE FICA não é "publique direto":** é que "o servidor tem mais que
> nós" pode significar duas coisas opostas — *cartão vivo que falta no repo* ou
> *lixo que o catálogo nem cita* —, e a única forma de saber é **cruzar cada
> entrada com `brands.json` e com a paleta da API**. Publicar a união sem cruzar
> é seguro e deixa a divergência crescer; publicar direto sem cruzar apaga
> cartão vivo. Cruze.

Antes disso, o caminho seguro é publicar a **UNIÃO** (a do servidor mais as
entradas novas), conferindo que cada entrada resolve num arquivo que existe lá.

`plates.json` é o caso oposto e é BENIGNO: o do repositório tem 6 sítios A MENOS
(`daf_xf_105_6x4`, `man_tgx_6x4`, `mercedes_actros2014_6x4`,
`volvo_fh16_2012_6x4a`, `volvo_fh_2021_6x4`, `volvo_fh_2024_6x4`), porque
`tools/placa/probe.mjs` enumera o que `brands.json` declara e nenhum desses seis
GLB é declarado por chassi nenhum. São entradas para arquivos que o app não tem
como pedir. Publicar poda; não perde nada.

**A dívida foi paga em 2026-08-26** (ver o bloco acima). Ficou uma parenta dela,
e vale o mesmo cuidado: **o manifesto pode estar atrasado em relação à PRÓPRIA
árvore do repositório.** Medido no mesmo dia — `renders.json` anunciava 719
imagens com 841 versionadas em `public/renders/`: 122 cartões que o app não tinha
como pedir, porque `engine/catalog/renders.ts` consulta o manifesto ANTES de
montar a URL. Não há aviso nenhum para isso; o que conserta é rodar
`tools/studio-render/shoot.mjs`, que reescreve o manifesto varrendo o DISCO.
Confira sempre a bijeção antes de publicar:

```bash
python3 - <<'EOF'
import json, os
d = json.load(open('public/renders/renders.json'))
falta = [f"{k}/{c}" for k, v in d['have'].items() for c in v
         if not os.path.exists(f"public/renders/trucks/{k}/{c}.webp")]
disco = sum(1 for _, _, fs in os.walk('public/renders/trucks')
            for f in fs if f.endswith('.webp'))
print('anunciados', d['counts']['imagens'], '· no disco', disco,
      '· sem arquivo', len(falta))
EOF
```

---

## 3. Reiniciar a API? **Não.**

`express.static` resolve do disco a cada request e o mount é registrado antes do
`app.init()`. Arquivo novo aparece sozinho. A única coisa que exigiria restart é
mudar `STUDIO_ASSETS_ROOT` no `.env.production`.

> ### ⚠️ Reiniciar `ankaa-api` NÃO é uma operação barata
>
> O serviço é `ExecStart=/usr/bin/node dist/main.js` com `Restart=always`, e o
> único `ExecStartPre` é um `fuser -k 3030/tcp`. **Ele não compila nada** — sobe
> o `dist/` que estiver no disco naquele instante.
>
> O working tree de `/home/kennedy/repositories/api` costuma ter trabalho não
> commitado, e um `dist/` pode ter sido gerado no meio dessa edição. Enquanto
> ninguém reinicia, o processo antigo segue rodando do build anterior — **bom** —
> e o `dist/` quebrado no disco não incomoda ninguém. O restart é que troca um
> pelo outro.
>
> Em 2026-08-09 isso derrubou a API: um `dist` com `InvoiceController` pedindo
> `ChangeLogService` sem `ChangeLogModule` nos imports do `InvoiceModule`
> crash-loopou o Nest e devolveu 502 no nginx. A causa não tinha nada a ver com
> assets; só apareceu porque houve um restart.
>
> **Antes de reiniciar:** `git status` no diretório da API e `stat -c %y dist/main.js`.
> Se a árvore estiver suja ou o `dist` for mais novo que o último deploy
> conhecido, **não reinicie** — confirme com quem está editando. E lembre que
> `sudo -n systemctl restart` neste servidor **executa**, não pergunta: `systemctl`
> é passwordless no sudoers (o resto do sudo pede senha).

Atenção ao cache: o mount responde `immutable`, então navegador e CDN seguram as
versões velhas. Como os caminhos dos manifestos **não mudam**, faça purge de CDN
dos três (`brands.json`, `hitch.json`, `renders.json`) se houver CDN na frente.
Os GLB são caminho novo e não têm esse problema.

---

## 4. Conferir que responde 200

```bash
BASE=https://api.ankaadesign.com.br/studio-assets/v1

for p in brands/trucks/brands.json models/vehicles/hitch.json renders/renders.json; do
  printf '%-34s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code} %{size_download}B' $BASE/$p)"
done
```

Conteúdo, não só o código:

```bash
# brands.json TEM de ser v2 e TEM de trazer `file` nos chassis
curl -s $BASE/brands/trucks/brands.json | grep -c '"schema": "truck-studio/brands@2"'   # 1
curl -s $BASE/brands/trucks/brands.json | grep -c '"file"'                              # >= 60
curl -s $BASE/models/vehicles/hitch.json | grep -c '"sourceFile"'                       # 57
curl -s -o /dev/null -w '%{http_code}\n' $BASE/models/vehicles/cabs.json                # 404
```

Uma geometria de cada tipo — a carreta em ~31,3 MB (se vier ~300 MB, o rsync não
substituiu) e o `daf_xd_4x2_sl.glb` em ~10 MB:

```bash
curl -s -o /dev/null -w 'truck   %{http_code} %{size_download}B\n' $BASE/models/trucks/daf_xd_4x2_sl.glb
curl -s -o /dev/null -w 'trailer %{http_code} %{size_download}B\n' $BASE/models/vehicles/trailer.glb
curl -s -o /dev/null -w 'render  %{http_code} %{size_download}B\n' $BASE/renders/trucks/daf/daf-xd/4x2-sl/_neutral.webp
```

---

## 5. Conferir no app, não só no curl

No DevTools do studio publicado:

1. **Network** — `brands.json`, `hitch.json` e `renders.json` em **200**.
2. **Console** — sem `[manifest] brands.json indisponível`. Essa linha significa
   que caiu no catálogo mínimo embutido e **o solver não roda**.
3. O seletor mostra **7 marcas** (com a MAN) e o passo de **CHASSI** aparece
   entre MODELO e COR.
4. Acoplar um caminhão: o engate encosta sem vão nem interpenetração.

---

## Estado em 2026-08-12 — a virada FOI FEITA

`STUDIO_ASSETS_ROOT=/srv/files/Estudio3D` (linha 119 do `.env.production`, com
backup em `.env.production.bak-antes-virada-20260812`). A API foi reiniciada e
quem serve agora é essa árvore.

**Como isso foi PROVADO**, e não deduzido: as duas árvores tinham os mesmos
bytes depois do rsync, então tamanho de resposta não distingue uma da outra. O
que distingue é um arquivo que só existe em uma:

```bash
ssh ankaa 'echo estudio3d > /srv/files/Estudio3D/v1/virada-check.txt'
curl -s https://api.ankaadesign.com.br/studio-assets/v1/virada-check.txt   # -> estudio3d
```

Use um nome SEM ponto na frente: `express.static` ignora dotfiles por padrão, e
um `.virada-check.txt` volta 404 tanto faz a árvore — o que parece falha da
virada e não é.

Publicado nesta rodada (rodada do Truck Studio de 10–12/08): `set.glb` novo do
distrito industrial (18.061.228 B), os `sky.hdr`/`sky-night.hdr` próprios do
cenário — que fecham o item em aberto da §3 do `ARCHITECTURE.md` — e as 20
chapas novas de livery em PNG. As duas chapas velhas (`traseira.png`,
`lateral.png`) foram removidas da árvore servida.

Árvore final: **1.025 arquivos · 533 MB · 49 cabines · 877 renders**, só os
cinco diretórios, tudo `kennedy:ankaa` com setgid.

**Pendência:** `/srv/studio-assets` (703 MB) ficou no disco. `/srv` é do root e
`sudo` pede senha para tudo que não seja `systemctl`, então a remoção não pôde
ser feita pela sessão. Ela está **inerte** — nada aponta para lá (`.env.example`
e os dois `.bak` mencionam o caminho, só isso). Para remover:

```bash
sudo rm -rf /srv/studio-assets
```

## Estado em 2026-08-10

Publicado por `scp`, **nas duas árvores**, com conferência de `sha256sum` antes
da troca e por HTTP depois:

- `environments/distrito-industrial/set.glb` — 14.700.908 → 17.428.964 B
- `environments/environments.json` — 40.938 → 44.843 B

`models/vehicles/trailer.glb` **não foi tocado**: o hash local e o do servidor
já eram o mesmo (`59c890bd…`). A porta lateral do implemento é geometria gerada
em runtime a partir desse GLB — código, não asset —, então uma feature inteira
de porta pode sair sem que nada suba para `/srv`.

Nenhum `.br` existe para esses dois caminhos, então não há companheiro velho
para o middleware servir no lugar. O `Cache-Control: immutable` continua valendo:
quem já carregou o cenário antigo só vê o novo depois de esvaziar o cache.

Sem `rsync` (a publicação saiu de uma máquina Windows) e sem `--delete`, pelo
motivo do aviso do passo 0.

## Estado em 2026-08-09

Publicado: 176 arquivos, 451 MB, 49 cabines, 53 renders, os cinco diretórios.
Conferido por HTTP — os três manifestos em 200, `brands@2`, 60 entradas com
`file`, 57 `sourceFile` no `hitch.json`, `cabs.json` e `scania.fbx` em 404, e a
carreta em 31.319.392 B (tier web, não a fonte de 286 MB).

**Falta a virada de caminho.** *(Feita em 2026-08-12 — ver o estado no topo.)* A
árvore já existe em `/srv/files/Estudio3D/v1/` (cópia completa, permissões no
padrão dos irmãos, entrando no rclone), mas `STUDIO_ASSETS_ROOT` no
`.env.production` do servidor (linha 119) continua apontando para
`/srv/studio-assets`. Enquanto essa linha não mudar, quem serve é a árvore
antiga.

A virada foi **tentada e revertida em 2026-08-09**: o restart necessário para
aplicá-la esbarrou no `dist/` quebrado descrito no aviso do passo 3, e o 502 que
apareceu não tinha relação com o caminho dos assets. A linha voltou ao valor
original. Refazer **só com a API saudável**:

1. `git status` no diretório da API — árvore limpa e `dist` confiável, senão pare;
2. `STUDIO_ASSETS_ROOT="/srv/files/Estudio3D"` no `.env.production`;
3. reiniciar a API (**único caso que exige restart** — o caminho é lido na
   composição do mount, não a cada request);
4. conferir o passo 4 de novo;
5. só então remover `/srv/studio-assets`.

Fazer nessa ordem: enquanto as duas árvores existirem, um erro no `.env` é
reversível sem novo upload de 450 MB.

As fontes cruas (de onde os dois tiers são assados) ficam **fora** de qualquer
árvore servida ou sincronizada, em `~/Documents/asset-backups/truck-studio/`, com
`SHA256SUMS`.

## A rota no web

O estúdio é servido em **`/ferramentas/estudio-3D`** (era `/ferramentas/teste`,
oculta). Está no menu de navegação e no hub de Ferramentas, grupo "Cores". O gate
é ADMIN e mora em `web/src/utils/route-privileges.ts` — o menu só decide quem VÊ
o item; quem decide quem ENTRA é aquela linha. Ao mudar o público, mude os dois.
