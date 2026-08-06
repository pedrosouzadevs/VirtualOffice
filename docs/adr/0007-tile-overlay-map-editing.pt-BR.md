# ADR-0007: Edição estrutural in-game como overlay de tiles no WAM, gated por `adminMap`

- **Status:** Aceito
- **Data:** 2026-08-06
- **Decisores:** time ArqueumSpace
- **Idiomas:** este arquivo (pt-BR) + [0007-tile-overlay-map-editing.md](0007-tile-overlay-map-editing.md), em sincronia
- **Origem:** pedido de produto (2026-08-05): editar a estrutura do mapa — pisos, paredes, entradas, saídas —
  dentro do jogo, permitido apenas por uma nova tag `adminMap`. Saídas e spawns já eram editáveis in-game
  (propriedades de área `exit`/`start`); o gap real eram os tiles.

## Contexto

O editor in-game edita o overlay `.wam` (entidades, áreas, configurações). O `.tmj` feito no Tiled é dono da
geometria e é imutável pós-upload: nenhum comando de edição o toca, o endpoint de JSON-Patch é travado por
regex em `.wam`, o back memoiza seu parse por sala para sempre, e nada notifica clientes quando os bytes dele
mudam. O upstream deixou a costura: o `FloorEditorTool` existia como stub registrado e vazio, alcançável por
`#mapEditor=floor` mas ausente da sidebar. A API de scripting já colocava tiles no cliente (`WA.room.setTiles`
→ `putTile`), efêmero e sem sincronização — prova de que o lado Phaser era viável, com dois bugs a não herdar:
o `putTile` nunca *limpava* colisão (colisores fantasma), e camadas GPU recusam em silêncio tiles de um segundo
tileset.

## Decisão 1 — `adminMap` abre o editor completo; tiles aceitam **só** `adminMap`

A tag é dado livre (concedível pela dashboard e CLI sem mudança de schema) e entra em `MAP_EDITOR_TAGS`: abre o
editor inteiro (objetos, áreas, tiles) e é pré-criada no bootstrap. Os comandos de tile são aceitos **apenas**
quando as tags do usuário incluem `adminMap` — deliberadamente **sem override de `admin` ou `editor`**, por
decisão de produto ("apenas permitido pela tag adminMap"). Um administrador concede a tag a si mesmo pela
dashboard; ela fica fora de `PROTECTED_TAGS`.

O predicado único `canEditTiles` vive em `libs/map-editor` (`TILE_EDITOR_TAGS`), importado pelo front
(visibilidade da ferramenta, deep link), pelo pusher (pré-gate barato respondendo o mesmo formato de
`errorCommandMessage`) e pelo map-storage — **a checagem autoritativa**, um `throw` posicionado antes de
qualquer enfileiramento ou eco, que o catch externo transforma em `errorCommandMessage` de verdade. De
propósito NÃO é o padrão do `EntityPermissions`, cujo caminho Sentry-e-break deixa um comando recusado ser
enfileirado e ecoado como sucesso.

## Decisão 2 — Edições persistem como overlay de tiles no `.wam`; o `.tmj` fica intocado

O `WAMFileFormat` ganha um `tileOverlay` opcional: `{ layers: { [nomeFlatDaCamada]: { "x,y": gid } } }`.

- **Dict achatado, last-write-wins**: o WAM é revalidado pelo zod após cada comando e serializado inteiro pelo
  autosave de 15s, então o overlay precisa ser O(células tocadas), nunca O(edições feitas).
- **Gids crus, flip flags incluídas** (daí uint32); a consolidação os escreve verbatim. In-game renderizam sem
  rotação (o Phaser carrega flips nas propriedades do Tile, não no índice) — limitação aceita do MVP.
- **gid 0 é apagamento explícito**, distinto de chave ausente: apagar um tile que o `.tmj` base pintou precisa
  sobreviver à consolidação.
- **As chaves de camada são os nomes ACHATADOS** (`walls/walls1`), casando com `GameMap.flatLayers`, as camadas
  do Phaser e o `WA.room.setTiles`.
- **Tetos no servidor**: 2048 células por pincelada, ~50k células no overlay; além disso, consolide.

### Alternativas consideradas

- **Escrever o `.tmj` direto** — o arquivo do Tiled seguiria como verdade única, mas falta toda a maquinaria:
  sem caminho de escrita server-side (o PUT é de arquivo inteiro, revalidando 10 imagens de tileset por save),
  sem notificação de mudança, parse eternamente velho no back, caches de browser/Phaser. Rejeitada: só risco,
  nenhum reuso de pipeline.
- **Lista de patches em vez de dict** — cresce sem limite sob repintura; rejeitada.

Andar no `.wam` significa que o pipeline inteiro já provado — lock por mapa, autosave, validação zod, catch-up
de comandos no join, `refreshRoomMessage` — funciona sem mudança. Transporte novo: `SetTilesMessage` (uma
pincelada) e `ClearTileOverlayMessage`, fields 14/15 do `EditMapMessage`. O bump do `apiVersionHash` é
automático (todo Dockerfile roda `tag-version` no build), então abas pré-deploy são recusadas e recarregam em
vez de ficarem cegas aos broadcasts de tile.

## Decisão 3 — O round-trip com o Tiled é um fluxo de commit manual

"Salvar no `.tmj`" são três passos explícitos, não efeito colateral de editar:

1. **Baixar** `<url-do-wam>?consolidated-tmj` — o `.tmj` base com o overlay aplicado
   (`applyTileOverlayToTmj`, nada mais tocado, então passa no validador de upload sem mudança). Servido da
   própria URL do wam, o único endereço que o front conhece em qualquer topologia de deploy. **Público**, como
   o `.wam` e o `.tmj`: o overlay já é transmitido a todo cliente conectado de qualquer forma.
2. **Re-subir** pelo PUT autenticado existente (ou pelo fluxo Tiled → zip → upload).
3. **Limpar o overlay** no editor. O servidor pareia isso com o mecanismo de refresh de upload de mapa — todo
   back é avisado, envia `refreshRoomMessage` (contagem de 30s) e evita caches — porque os clientes conectados
   têm o overlay antigo aplicado nos tilemaps em memória e precisam recarregar no base novo. Antes desse
   refresh, o map-storage **descarrega o WAM para o storage** (`MapsManager.flushMapToStorage`): o caminho de
   eviction descarta a cópia em memória sem salvar, e um clear mais novo que o autosave ressuscitaria do
   arquivo velho.

## Decisão 4 — Recortes de escopo do MVP

- **Sem resize de canvas.** O office.tmj é declarado 144×128 com 31×21 desenhados (~3,5%): "aumentar o
  escritório" é pintar em espaço que já existe. Redimensionar é Tiled desktop + re-upload.
- **Sem upload de tileset em runtime, sem gestão de camadas.** Tilesets novos chegam editando no Tiled e
  re-subindo — o fluxo que já existe.
- **Modo Parede é pintura pareada**, data-driven: o gid visual na camada escolhida mais o gid marcador de
  colisão na camada literal `collisions`, as duas células num comando só. O marcador é o primeiro tile de
  tileset com `collides: true`. Sem marcador ou camada, Parede degrada para visual com aviso no painel.
- **A borracha sempre libera a colisão da célula também.** Colisor órfão invisível é o problema da parede
  fantasma; piso visivelmente faltando é autoexplicativo e repintável.
- **`collisions` e `start` nunca são oferecidas como alvo de pintura** (geridas pelo modo Parede / semântica
  de spawn).
- **Camadas GPU single-tileset**: a elegibilidade agora une os gids do overlay no load, então um overlay que
  traz um segundo tileset rebaixa a camada para CPU em vez de descartar células em silêncio; pintar ao vivo
  cruzando tilesets numa camada GPU é recusado com aviso no console (a restrição da paleta é a resposta de UX).

## Consequências

### Positivas

- O `.tmj` permanece o artefato Tiled puro; "desfazer tudo" é um clear-overlay de distância.
- Toda garantia existente (locks, autosave, validação, catch-up, undo/redo) vale para tiles de graça; uma
  pincelada recusada pelo servidor agora reverte visualmente na tela do autor (gap achado e corrigido no branch
  do `errorCommandMessage`, escopado a comandos de tile).
- O bug do colisor fantasma no `putTile` foi corrigido para todo chamador, API de scripting inclusa.

### Negativas

- Desfazer uma pincelada escreve os gids anteriores como entradas próprias do overlay (célula de valor base
  ganha entrada redundante). Inofensivo: a saída consolidada é idêntica.
- Limpar o overlay recarrega todo cliente conectado (contagem de 30s) mesmo sem re-upload — aceito para uma
  operação administrativa e rara.
- Células de overlay com flip flags renderizam sem rotação in-game até a consolidação.
- Pinceladas concorrentes de dois editores resolvem last-write-wins por célula, como todo comando do editor.

### Neutras

- `MemberAdministrationService` e a dashboard concedem `adminMap` como qualquer tag; só `admin` segue
  SQL-apenas.
- O export consolidado carrega o WAM na memória do map-storage (a eviction recupera); não inicia timer de
  autosave.

## Referências

- [ADR-0002](0002-admin-api.pt-BR.md) (contrato, tags do banco), [ADR-0004](0004-admin-dashboard.pt-BR.md) (superfícies de concessão)
- Guia de operação: [MAP-STRUCTURAL-EDITING.pt-BR.md](../MAP-STRUCTURAL-EDITING.pt-BR.md) / [en-US](../MAP-STRUCTURAL-EDITING.md)
- Arquivos-chave: `libs/map-editor/src/Commands/Tiles/*`, `libs/map-editor/src/GameMap/TileOverlayMerge.ts`,
  `play/src/front/Phaser/Game/MapEditor/Tools/FloorEditorTool.ts`,
  `play/src/front/Phaser/Game/GameMap/GameMapFrontWrapper.ts` (`setTilesBatch`),
  `map-storage/src/MapStorageServer.ts` (gate + cases), `map-storage/src/index.ts` (`?consolidated-tmj`)
