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

Tem de dar **4 passed** e imprimir `7 marcas · 24 modelos · 60 chassis · 53
arquivos distintos`. Se não der, **pare**: o que está em `public/` não está
íntegro e publicar espalharia o problema.

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

> ### São DUAS árvores enquanto a virada não acontecer
>
> `/srv/files/Estudio3D/v1/` é o **destino** e `/srv/studio-assets/v1/` é quem
> **está no ar** — `STUDIO_ASSETS_ROOT` no `.env.production` ainda aponta para a
> segunda (ver "Estado", no fim). Elas são árvores independentes, não hard links:
> `stat -c %d:%i` nos mesmos arquivos devolve inodes diferentes.
>
> **Publicar só no destino não muda nada no ar**, e o sintoma é silencioso: o
> upload confere, o `sha256sum` bate, e o `curl` continua devolvendo os bytes
> velhos com 200. Aconteceu em 2026-08-10 com o `set.glb` do distrito industrial.
>
> Enquanto as duas existirem, publique nas **duas** — a de destino para não
> ficar para trás (e entrar no rclone), a viva para o efeito acontecer.

```bash
for T in /srv/files/Estudio3D /srv/studio-assets; do
  rsync -avn --delete web/public/ ankaa:$T/v1/   # ENSAIO
done
```

**Rode o ensaio (`-n`) primeiro e leia a lista de `deleting …`.** O `--delete` é
intencional e é o ponto do passo: é ele que tira da árvore servida o `cabs.json`
aposentado (segunda fonte de verdade), o `scania.fbx` de 46 MB e os backups de
carreta. Só deve remover:

- `models/vehicles/cabs.json`
- `models/vehicles/scania.fbx`
- `models/vehicles/trailer.glb.*`
- `models/vehicles/trailer_old_probe.glb`

Qualquer outra coisa na lista: **pare e investigue** — o servidor tem algo que a
nossa árvore não tem.

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

**Falta a virada de caminho.** A árvore já existe em `/srv/files/Estudio3D/v1/`
(cópia completa, permissões no padrão dos irmãos, entrando no rclone), mas
`STUDIO_ASSETS_ROOT` no `.env.production` do servidor (linha 119) continua
apontando para `/srv/studio-assets`. Enquanto essa linha não mudar, quem serve é
a árvore antiga.

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
