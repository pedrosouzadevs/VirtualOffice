# Edição estrutural do mapa (tiles) — guia de operação

> **Propósito.** Como conceder, usar e consolidar edições estruturais in-game (pisos e paredes). Racional de
> design: [ADR-0007](adr/0007-tile-overlay-map-editing.pt-BR.md).
> **Público.** Administradores do mundo.
> **Pré-requisitos.** Stack rodando com `ADMIN_API_URL` definido, e um mapa servido pelo map-storage (sala `/~/`).

## Concedendo acesso

A edição estrutural é permitida **apenas** pela tag `adminMap` — `admin` e `editor` não têm override. A tag é
pré-criada no bootstrap e concedível como qualquer outra:

- **Dashboard:** `/admin/` → membro → adicionar tag `adminMap`.
- **CLI:**

```bash
docker compose exec admin-api npm run member:grant -- alguem@empresa.com adminMap
```

A pessoa precisa **sair e entrar de novo** (logout/login) após a concessão — só recarregar não basta, porque
as tags ficam presas à sessão de login (verificado empiricamente no smoke: o e2e só vê a tag concedida após um
login novo). `adminMap` também abre o editor completo (objetos e áreas), então é a única tag que um mantenedor
de mapa precisa.

## Usando o editor

Abra o editor de mapa → ícone de grade ("Ferramenta de editor de tiles", visível só com `adminMap`):

| Modo | O que faz |
|---|---|
| **Piso** | Pinta o tile selecionado da paleta na camada escolhida. |
| **Parede** | Pinta o tile E marca a célula como colidível (tile marcador na camada `collisions`), numa pincelada só. |
| **Borracha** | Limpa a célula na camada escolhida E libera a colisão dela. |

Clique ou arraste; cada arrasto é uma pincelada desfazível (Ctrl+Z). As edições chegam a todos na sala ao vivo,
persistem como **overlay de tiles no `.wam`** (o `.tmj` de autoria nunca é modificado) e sobrevivem a reloads.

Notas:

- As camadas `collisions` e `start` nunca são oferecidas como alvo de pintura.
- O mapa do escritório tem 144×128 tiles com só ~31×21 desenhados: aumente o escritório pintando no canvas vazio.
- Limites: 2048 células por pincelada, ~50k células no overlay total. Além disso, consolide (abaixo) e limpe.
- Tilesets novos: adicione no Tiled desktop e re-suba o mapa — não há upload de tileset em runtime.

## Consolidando as edições de volta ao Tiled (o round-trip)

O overlay não é o `.tmj`. Para tornar as edições parte do arquivo base do mapa:

1. **Baixe** o mapa consolidado: botão "Baixar .tmj consolidado" no painel do editor de tiles, ou

```bash
curl -o office-consolidado.tmj "https://<dominio>/map-storage/maps/office.wam?consolidated-tmj"
```

2. **Confira no Tiled desktop** (opcional mas recomendado) e **re-suba** por cima do `.tmj` original via
   `/map-storage/` (basic auth), mantendo o mesmo nome de arquivo.
3. **Limpe o overlay**: "Limpar edições estruturais" no painel. Todos na sala recebem contagem de 30 segundos e
   recarregam no mapa base novo. Isso é deliberado — os clientes conectados têm o overlay antigo em memória e
   precisam recarregar.

> Pular o passo 3 é inofensivo visualmente (o overlay re-aplica os mesmos gids sobre o base novo) mas deixa o
> overlay crescendo; pular o passo 2 e limpar mesmo assim simplesmente reverte o mundo ao mapa base antigo.

## Troubleshooting

| Sintoma | Causa / correção |
|---|---|
| Sem ícone de grade na sidebar do editor | O usuário não tem `adminMap`, ou não fez logout/login após a concessão (as tags ficam presas à sessão de login). |
| Aviso "paredes serão apenas visuais" | O mapa não tem tile de tileset com `collides: true` ou não tem camada `collisions`. Adicione no Tiled. |
| Pincelada some logo após pintar | O servidor recusou (sem `adminMap` server-side). A reversão é intencional. |
| Tile pintado aparece sem rotação | Gids com flip flags renderizam sem rotação in-game; o export consolidado preserva as flags (ADR-0007). |
| `?consolidated-tmj` responde 400 | O `mapUrl` do `.wam` é absoluto/externo; só mapas relativos podem ser consolidados. |
