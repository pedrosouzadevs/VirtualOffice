# ADR-0002: Admin API própria (`admin-api`) para membros, tags e permissões

- **Status:** Aceito
- **Data:** 2026-07-29 — contrato reverificado contra o código em 2026-07-30 (ver *Correções*)
- **Decisores:** Equipe VirtualOffice
- **Idiomas:** este arquivo (pt-BR) + [0002-admin-api.md](0002-admin-api.md) (en-US), em lockstep.
- **Spec de origem:** [Spec 0001 — Roadmap de Features](../specs/0001-feature-roadmap.pt-BR.md), Feature 3.

## Contexto

Hoje o `play` **não tem banco de usuários**. Sem uma Admin API, as tags (`admin`, `editor`, …) vêm exclusivamente da claim OIDC — não há onde persistir uma permissão atribuída por uma tela. Foi exatamente o bloqueio que originou este roadmap: *"não consigo arrumar as tags"*.

O pusher já sabe conversar com uma Admin API: quando `ADMIN_API_URL` está definido, ele deixa de usar o stub [`LocalAdmin.ts`](../../play/src/pusher/services/LocalAdmin.ts) e passa a chamar HTTP via [`AdminApi.ts`](../../play/src/pusher/services/AdminApi.ts). **Nós não escolhemos o contrato — ele já existe.** Nosso trabalho é implementá-lo do outro lado.

> ⚠️ **Risco central desta feature:** o contrato é consumido em runtime com validação `zod`. Um campo faltando ou com tipo errado em `/api/map` ou `/api/room/access` **quebra o login e o carregamento do mapa**. Por isso este ADR documenta o contrato **verificado no código**, não a documentação (que está incompleta).

### Efeito colateral importante — e bem maior que uma variável

Com `ADMIN_API_URL` definido, `MAP_EDITOR_ALLOW_ALL_USERS` passa a ser **ignorado** — o `admin-api` assume o controle do acesso ao editor de mapa. Ou seja: **no dia em que ligarmos o `admin-api`, a configuração atual por env var deixa de valer.** O `canEdit` passa a vir da nossa resposta.

Não é uma variável, são **40** (verificado em 2026-07-30). O [`LocalAdmin`](../../play/src/pusher/services/LocalAdmin.ts) monta seus dois payloads a partir do ambiente do `play`:

| Consumidor | Quantidade | Exemplos |
|---|---|---|
| `fetchMapDetails` → `/api/map` | **28** | `START_ROOM_URL`, `PUBLIC_MAP_STORAGE_URL`, `DISABLE_ANONYMOUS`, `ENABLE_CHAT*` (4), `ENABLE_SAY`, `ENABLE_ISSUE_REPORT`, `MATRIX_*` (5), `DEFAULT_WOKA_*` (2), `PROVIDE_DEFAULT_WOKA_*` (2), `SKIP_CAMERA_PAGE`, `BYPASS_PWA`, `ENABLE_TUTORIAL`, `OPID_WOKA_NAME_POLICY`, `LIVEKIT_RECORDING_S3_*` (5) |
| `fetchMemberDataByUuid` → `/api/room/access` | **+12** | `MAP_EDITOR_ALLOW_ALL_USERS`, `MAP_EDITOR_ALLOWED_USERS` e as 10 flags de aplicação (`KLAXOON_ENABLED`, `YOUTUBE_ENABLED`, `GOOGLE_*_ENABLED` ×4, `ERASER_ENABLED`, `EXCALIDRAW_ENABLED`, `CARDS_ENABLED`, `TLDRAW_ENABLED`) |

Quando esses dois endpoints forem nossos, todas as 40 passam a ser lidas do ambiente do **`admin-api`**, e as cópias no `play` viram configuração morta para esses campos. Duplicá-las em dois `.env` significa divergência silenciosa, e o modo de falha não é erro — é *"o chat sumiu depois que ligamos o admin-api"*.

**Decisão:** o `docker-compose.yaml` não usa `env_file`; ele interpola cada variável do `.env` da raiz do repositório (ex.: `ENABLE_MAP_EDITOR: "$ENABLE_MAP_EDITOR"`). O serviço `admin-api` declara **as mesmas variáveis interpoladas do mesmo `.env` da raiz** — um valor, dois consumidores, sem mecanismo novo. Variáveis que forem genuinamente exclusivas do `admin-api` recebem o prefixo `ADMIN_API_`.

## Contrato verificado (fonte: `AdminApi.ts`)

### Autenticação — a primeira armadilha

```
Authorization: <ADMIN_API_TOKEN>
```

O token vai **cru, sem o prefixo `Bearer`** (`headers: { Authorization: \`${ADMIN_API_TOKEN}\` }`). Um servidor que exija `Bearer <token>` rejeita todas as chamadas. Também é enviado `Accept-Language` com o locale do usuário.

**Exceção — o `/api/capabilities` não leva token nenhum** (verificado em 2026-07-30). O [`AdminApi.ts:208`](../../play/src/pusher/services/AdminApi.ts) dispara `axios.get(ADMIN_API_URL + "/api/capabilities")` **sem objeto de config**: sem headers, sem `Authorization`. Todos os outros endpoints mandam um.

Logo, a proteção por token precisa isentar esse caminho. Responder 403 nele lança dentro do `initialise()`, que faz retry infinito — o pusher pendura exatamente como no 404 (Armadilha #2), só que por outra porta. O jeito certo é montar a proteção de forma que tudo sob `/api` fique protegido **por padrão** e abrir um caminho seja ato deliberado, isentando este.

### Endpoints

| Endpoint | Método | Criticidade | Papel |
|---|---|---|---|
| `/api/capabilities` | GET | 🔴 **Bloqueante** | Retorna as capabilities suportadas. ⚠️ **Um 404 pendura o pusher** — ver Armadilha #2. Responder `200 {}` é válido e é o que permite implementar por fases. |
| `/api/map` | GET | 🔴 **Bloqueante** | `?playUri&userId?&accessToken?` → `MapDetailsData` \| `RoomRedirect` \| `ErrorApiData`. Sem isso, nenhum mapa carrega. |
| `/api/room/access` | GET | 🔴 **Bloqueante** | `?userIdentifier&playUri&ipAddress&characterTextureIds&companionTextureId&accessToken&isLogged&chatID` → dados do membro (inclui `tags` e `canEdit`). Sem isso, ninguém entra. |
| `/api/woka/list` | GET | 🟡 **No P0 mesmo assim** | Não é bloqueante sozinho — é gated por capability. Mas o `/api/room/access` nos obriga a ter o catálogo de Wokas de qualquer forma: ver Armadilha #3. |
| `/api/companion/list` | GET | 🟡 | Lista de companions. |
| `/api/members`, `/api/members/{uuid}` | GET | 🟡 | Busca e detalhe de membro. |
| `/api/world/tags`, `/api/room/tags` | GET | 🟡 | Tags disponíveis (alimenta os seletores do editor). |
| `/api/ban`, `/api/report` | GET/POST | 🟡 | Moderação. |
| `/api/save-name`, `/api/save-textures`, `/api/save-companion-texture` | POST | ⚪ Opcional | Gated por capability. |
| `/api/room/same`, `/api/chat/members`, `/api/login-url/{token}` | GET | ⚪ Opcional | Mundos, chat, login por token. |

### Armadilha #2 — 404 no `/api/capabilities` pendura o pusher (verificado em 2026-07-30)

A documentação oficial, e o primeiro rascunho deste ADR, diziam que 404 era aceitável. **O código diz o contrário:**

- [`AdminApi.ts:161`](../../play/src/pusher/services/AdminApi.ts) — o `queryCapabilities` faz `catch` de **qualquer** exceção (404 incluso: não há `validateStatus` customizado, então o axios rejeita) e se reagenda via `setTimeout` **sem limite de tentativas**. A promise externa nunca se assenta.
- [`app.ts:193`](../../play/src/pusher/app.ts) — `await adminApi.initialise()` roda dentro do `init()`. O `try/catch` ao redor nunca dispara: a promise não rejeita, ela simplesmente nunca resolve.
- [`server.ts:52`](../../play/src/server.ts) — `await app.init()` roda **antes** do `listenWebServer`.

Consequência: com `ADMIN_API_URL` ligado e o `/api/capabilities` respondendo 404, o pusher fica em retry infinito e **nunca abre a porta HTTP/WS**. Não quebra, e loga um único aviso — pendura. A tolerância ao 404 só vale quando `ADMIN_API_URL` está vazio, porque aí a chamada nunca acontece.

Portanto o `/api/capabilities` é o endpoint **mais** bloqueante dos três, não uma negociação opcional. O que viabiliza a entrega faseada é responder **`200` com objeto vazio** — não declarar capability alguma é perfeitamente válido.

### Armadilha #3 — `characterTextures` puxa o catálogo de Wokas para o P0 (verificado em 2026-07-30)

O `/api/woka/list` **não** é bloqueante sozinho: o [`WokaService.ts:10`](../../play/src/pusher/services/WokaService.ts) seleciona o `adminWokaService` apenas quando `capabilities["api/woka/list"] === "v1"`; caso contrário o pusher continua servindo o catálogo local. O mesmo gating vale para o `/api/companion/list`.

Só que o `/api/room/access` precisa devolver `characterTextures` — o `WokaDetail[]` resolvido a partir dos `characterTextureIds` recebidos — junto com `isCharacterTexturesValid`. Array vazio ou flag falsa manda o usuário para a tela de seleção de Woka. O `LocalAdmin` resolve isso pelo [`LocalWokaService`](../../play/src/pusher/services/LocalWokaService.ts), que lê o `play/src/pusher/data/woka.json`.

Ou seja, o `admin-api` precisa do catálogo de um jeito ou de outro. Se pularmos o `/api/woka/list`, o pusher serve a lista da cópia do `play` enquanto validamos contra a nossa — duas fontes de verdade, cuja divergência aparece como **loop de login**: o usuário é jogado na seleção de Woka, escolhe uma textura que não conhecemos, e é jogado de novo.

**Decisão: implementar o `/api/woka/list` no P0**, servindo o mesmíssimo catálogo usado na resolução de texturas. O ADR original chegou à conclusão certa pelo motivo errado — ele está no P0 por causa do `/api/room/access`, não porque o endpoint seja bloqueante.

### Formatos de resposta (campos exatos)

**`/api/room/access`** → exatamente **10 campos obrigatórios** ([`AdminApi.ts:58`](../../play/src/pusher/services/AdminApi.ts)):
```
status ("ok"), email (nullable), userUuid, tags[], visitCardUrl (nullable),
isCharacterTexturesValid, characterTextures[], isCompanionTextureValid,
messages[], world
```
Opcionais: `username`, `companionTexture`, `userRoomToken`, `activatedInviteUser`, `applications`, `canEdit`, `chatID`, `canRecord`.

Repare na ironia: **`canEdit` é opcional no schema** (`z.boolean().nullable().optional()`) e ainda assim é o campo que **libera o editor de mapa** — onde a gestão de tags vira efeito prático. Omiti-lo resulta em falso silencioso, que é exatamente o bug que enviaríamos sem perceber.

#### O `userUuid` precisa ecoar o identificador, não o nosso id interno (verificado em 2026-07-30)

Devolver o `member.id` aqui pareceria a coisa organizada a fazer. E **quebraria o F4**, que já está entregue.

A cadeia: o `ConnectionManager` monta o usuário local do front a partir deste campo (`new LocalUser(data.userUuid, data.email)`), e o editor de mapa grava esse valor no `personalAreaPropertyData.ownerId` quando alguém reivindica uma área pessoal ([`MapEditorModeManager.ts:557`](../../play/src/front/Phaser/Game/MapEditor/MapEditorModeManager.ts)). Toda área já reivindicada guarda, portanto, o **e-mail**. Troque o `userUuid` por um uuid interno e todas elas ficam órfãs — ninguém mais é dono do próprio escritório.

A decisão #5 diz o mesmo pelo outro lado: a chave primária interna **nunca** é um identificador externo. Ela fica dentro do banco.

#### O pusher deixa de enviar as tags do OIDC

O `AdminApi.fetchMemberDataByUuid` aceita um argumento `tags` mas **não o coloca na query string** ([`AdminApi.ts:419`](../../play/src/pusher/services/AdminApi.ts)). Ou seja, a partir do momento em que `ADMIN_API_URL` é definido, as tags vêm de nós e de mais ninguém — que é justamente o objetivo da feature, e também o motivo de o `canEdit` **não** honrar `MAP_EDITOR_ALLOW_ALL_USERS` nem `MAP_EDITOR_ALLOWED_USERS`. Reproduzi-los devolveria a autorização para uma variável de ambiente que ninguém muda por tela. O `ENABLE_MAP_EDITOR` continua valendo: ele é chave geral, não regra de autorização.

> ⚠️ **Consequência de migração:** no dia em que o `ADMIN_API_URL` for ligado, quem tinha `admin`/`editor` pela claim OIDC mas não tem registro de membro perde o acesso ao editor até receber a tag. É para isso que existe o bootstrap da decisão #6.

**`/api/map`** → `MapDetailsData`, **ou** `RoomRedirect` (`{ redirectUrl }`), **ou** `ErrorApiData`.

O `MapDetailsData` exige **exatamente um** campo: `group` (`z.string().nullable()`, ou seja, `null` passa) — [`MapDetailsData.ts:163`](../../libs/messages/src/JsonMessages/MapDetailsData.ts). Todos os demais são `.optional()`, e como o objeto não é `.strict()`, chaves desconhecidas são descartadas. O número "~45 campos" descreve a superfície do tipo, não a obrigação.

> Isso inverte onde mora o risco do P0. Satisfazer o `zod` é barato; a corretude **funcional** não é. `mapUrl`/`wamUrl` e o roteamento `/~/` é que fazem um mapa realmente carregar — e o [`LocalAdmin.fetchMapDetails`](../../play/src/pusher/services/LocalAdmin.ts) é a especificação executável de tudo isso. **O P0 é um porte fiel do `LocalAdmin` sobre o Postgres**, não um payload escrito do zero.

#### Três campos que o `LocalAdmin` emite e o schema não tem (verificado em 2026-07-30)

O `isMapDetailsData` não tem chave para nenhum deles, e o objeto não é `.strict()`, então o `zod` os descarta em silêncio. Reproduzi-los seria peso morto; o porte omite os três de propósito:

| Campo | Por que não é reproduzido |
|---|---|
| `canEdit` | O editor de mapa é liberado pelo `/api/room/access`, cujo valor chega ao front pelo `RoomJoinedMessage` do protobuf ([`RoomConnection.ts:565`](../../play/src/front/Connection/RoomConnection.ts)). No `/api/map` ninguém o lê. |
| `loadingCowebsiteLogo` | Não existe essa chave no schema. |
| `opidUsernamePolicy` | Typo do upstream para `opidWokaNamePolicy`. Nós emitimos o nome **correto**. |

Emitir o `opidWokaNamePolicy` com o nome certo é seguro, e não uma mudança de comportamento, porque o front já cai na própria variável de ambiente quando o campo falta — [`Room.ts:183`](../../play/src/front/Connection/Room.ts): `data.opidWokaNamePolicy ?? OPID_WOKA_NAME_POLICY` — e os dois lados leem o mesmo valor.

Vale notar também que o `editable` está no schema mas **nada no `play` o lê**; o `LocalAdmin` também não o define. É campo só do SaaS.

## Decisão

### 1. Serviço novo `admin-api`, Clean Architecture, PostgreSQL dedicado

Domain → Application → Infrastructure/API. Postgres próprio (decisão #3 do spec), sem integração com banco corporativo nesta fase.

**Stack: TypeScript, como workspace dentro deste monorepo** (decidido em 2026-07-30), seguindo o padrão do `map-storage` — Express 5 + `tsx` + Vitest.

O argumento decisivo é o teste obrigatório #1 abaixo: *reusar os schemas `zod` de `@workadventure/messages`, não redigitá-los*. Isso só é literalmente possível em TypeScript. Um serviço .NET — o padrão da nossa engenharia em geral — obrigaria a redigitar `MapDetailsData` e `FetchMemberDataByUuidResponse` em C#, e a divergência de contrato com o upstream passaria a ser invisível até quebrar o login em runtime. Importar os schemas transforma essa divergência em falha de **compilação/teste** a cada `npm ci`.

Ganhos secundários: um `docker compose up`, um toolchain, um pipeline de CI, e as `libs/*` disponíveis para reuso.

O que abrimos mão: divergência do stack .NET de referência, e nada de EF Core. **Aposta:** a proteção contra divergência de contrato vale mais que uniformidade de stack para este serviço específico, porque o trabalho inteiro dele *é* o contrato.

**ORM: Drizzle.** Schema declarado em TypeScript (bate com o `strict` do repositório), migrations forward-only via `drizzle-kit`, SQL-first sem query engine binário. O Prisma acrescentaria um passo de codegen e ~50 MB à imagem para três tabelas. O seed idempotente da decisão #6 continua em SQL puro com `ON CONFLICT DO NOTHING`.

### 2. Faseamento guiado pelas capabilities

O `/api/capabilities` permite entregar **incrementalmente sem quebrar o `play`**: implementamos o núcleo bloqueante primeiro e declaramos só o que existe.

### 3. Dashboard separado

Front próprio (Next.js), autenticado só para administradores, consumindo a API do `admin-api` — **não** os endpoints que o pusher usa.

> ⚠️ **Parcialmente substituída pelo [ADR-0004](0004-admin-dashboard.pt-BR.md) (2026-07-31).** A metade "front
> Next.js separado" é trocada por uma UI Svelte embutida no `admin-api`, seguindo o precedente do
> `map-storage/src-ui` que este ADR não considerou. A metade "consome a nossa própria API, não os endpoints do
> pusher" permanece, e o ADR-0004 a preserva.

### 4. Contrato antes de features

O P0 é um "esqueleto que responde certo": os 3 endpoints bloqueantes servindo dados do Postgres, com o `play` funcionando ponta a ponta. Só então vêm membros/tags/UI.

### 5. Identidade do membro: PK interna + identificadores externos (decidido 2026-07-29)

**Restrição verificada no código:** o pusher usa o **e-mail** como identificador. Em [`AuthenticateController.ts:318`](../../play/src/pusher/controllers/AuthenticateController.ts) ele chama `createAuthToken(email, …)`, e o `JWTTokenManager` documenta o campo como *"will be a email if logged in or an uuid if anonymous"*. O `OpenIDClient` **tem** o `sub` em mãos, mas **não o repassa**. Logo, `userIdentifier` chegando em `/api/room/access` é o e-mail.

Consequência: **chavear a tabela pelo `sub` do OIDC é inviável** sem alterar o pusher — e alterá-lo criaria divergência com o upstream a cada merge.

**Decisão (respondendo "o que for melhor para o Azure"):**

```
member
  id          uuid  PK      -- nossa, interna; nunca um identificador externo
  email       text  UNIQUE  -- chave de lookup (é o que o pusher envia)
  oidc_sub    text  UNIQUE NULL  -- preenchida quando disponível; preparada para o Azure
  ...
```

Racional: o valor que o `sub` traria — sobreviver a uma troca de e-mail sem perder tags e propriedade de área — é entregue pela **PK interna**. Se o e-mail de alguém mudar, atualiza-se a coluna e todo o resto (tags, áreas, bans) continua apontando para o mesmo `id`. O `oidc_sub` fica pronto para o F2: quando o Azure entrar, gravamos o `oid`/`sub` no primeiro login (vinculando pela conta de e-mail existente) e ganhamos a opção de migrar o lookup depois, sem migração de dados.

O que **não** fazer: usar o e-mail como chave estrangeira nas demais tabelas. Esse é o erro que torna a troca de e-mail dolorosa.

### 6. Bootstrap do primeiro admin: seed idempotente (decidido 2026-07-29)

O primeiro administrador nasce de um **seed idempotente** (`ON CONFLICT DO NOTHING`, padrão do projeto), com o e-mail vindo de uma variável de ambiente (ex. `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL`) para não ficar hardcoded nem versionado. Roda na inicialização do `admin-api`; se o membro já existir, nada acontece.

Alternativa aceita para desenvolvimento: `INSERT` manual no Postgres.

### 7. Mundo único no P0 (decidido 2026-07-29)

O campo `world` existe na resposta de `/api/room/access` e será devolvido com um valor **fixo** no P0. Nada de tabela `world` nem relacionamentos por mundo agora.

Como isso não vira armadilha: `world` continua sendo um campo da resposta desde o primeiro dia (o contrato não muda quando multi-mundo chegar), e as tags já nascem por membro. Introduzir mundos depois é acrescentar uma tabela e um escopo às tags — não reescrever o modelo.

## Alternativas consideradas

### A. Continuar sem Admin API (env vars)
- **Prós:** zero trabalho.
- **Contras:** é exatamente o bloqueio que originou o roadmap — tags só via claim OIDC, nada gerenciável.
- **Rejeitada.**

### B. Assinar o SaaS (`admin.workadventu.re`)
- **Prós:** pronto, mantido por eles.
- **Contras:** custo por assento, dados fora, sem customização; e o F5 (ejeção) e o modo dono do F4 são **nossos**, não existem lá.
- **Rejeitada** para este contexto, mas é o *benchmark* de funcionalidade.

### C. Estender o `play` com um banco embutido
- **Prós:** menos um serviço.
- **Contras:** vai contra a arquitetura upstream (o pusher é stateless por design) e cria divergência dolorosa em cada merge com o upstream.
- **Rejeitada.**

## Consequências

### Positivas
- Destrava o bloqueio original: tags e permissões gerenciáveis por tela.
- Vira a fundação do **F2** (Azure fornece identidade; o `admin-api` fornece autorização) e permite ao **F5** migrar a propriedade de área para gestão central.
- Habilita mundos, moderação e URLs `/@/`.

### Negativas
- **Maior feature do roadmap** (L–XL) e um serviço a manter para sempre.
- **Superfície de segurança:** passa a deter identidade e autorização → threat model STRIDE obrigatório, auditoria, segredos em cofre.
- Divergência do contrato = login quebrado. Mitigação: testes de contrato desde o P0.

### Neutras
- `MAP_EDITOR_ALLOW_ALL_USERS` e afins saem de cena.
- Licença AGPL-3 + Commons Clause continua valendo (uso interno livre; revenda como serviço, não).

## Plano de implementação

| Fase | Escopo |
|---|---|
| **P0 — Esqueleto que responde certo** | `admin-api` + Postgres + **4** endpoints: `/api/capabilities` (sempre `200`), `/api/map`, `/api/room/access`, `/api/woka/list` (Armadilha #3). Meta: `ADMIN_API_URL` ligado e o `play` funcionando como hoje. |
| **P1 — Membros e tags** | CRUD de membros, atribuição de tags, `canEdit` derivado das tags. Endpoints `/api/members*`, `/api/world/tags`, `/api/room/tags`. |
| **P2 — Dashboard** | UI de administrador: listar/buscar membros, atribuir tags, ver salas. |
| **P3 — Moderação** | `/api/ban`, `/api/report`, mundos, `/api/room/same`. |
| **P4 — Endurecimento** | Log de auditoria, RBAC no próprio dashboard, threat model STRIDE, rotação de segredos. |

### Testes obrigatórios

1. **Teste de contrato** por endpoint: a resposta valida contra o mesmo schema `zod` que o pusher usa (`isCapabilities`, `isMapDetailsData`, `isRoomRedirect`, `isFetchMemberDataByUuidResponse`, `wokaList`). *Reusar os schemas de `@workadventure/messages` — não redigitar.*

   > ⚠️ Isso **não era possível como estava escrito** (descoberto em 2026-07-30). Só o `isMapDetailsData` morava em `@workadventure/messages`; o schema do `/api/room/access` vivia em `play/src/pusher/services/AdminApi.ts`, um módulo que valida o ambiente inteiro do `play` no import e chama `process.exit(1)` quando falha. Ele foi movido para [`libs/messages/src/JsonMessages/FetchMemberDataByUuidResponse.ts`](../../libs/messages/src/JsonMessages/FetchMemberDataByUuidResponse.ts) e re-exportado do `AdminApi.ts`, de modo que **nenhum import do `play` mudou** e os dois lados do contrato passam a compartilhar uma definição só. Havia precedente: o `libs/shared-utils/src/SharedAdminApi.ts` já compartilha código da Admin API com o `back`.
2. Login ponta a ponta com `ADMIN_API_URL` ligado.
3. `canEdit` verdadeiro/falso conforme as tags do membro.
4. **`/api/capabilities` responde `200` mesmo sem capability alguma** (`{}` é corpo válido). ⚠️ *Isto substitui o teste #4 original — "404 não derruba o `play`" — que afirmava um comportamento inexistente: um 404 pendura o pusher (Armadilha #2).*
5. Token errado → 403 em todos os endpoints **exceto o `/api/capabilities`**, que precisa responder 200 sem token e precisa rejeitar token embrulhado em `Bearer`.
6. Membro desconhecido no `/api/room/access` entra com `tags: []` e `canEdit: false` — **nunca erro**, senão nenhum visitante novo consegue entrar.
7. Qualquer caminho não implementado responde JSON, nunca o HTML padrão do Express: todo chamador parseia nossas respostas com `zod`.

## Correções (2026-07-30)

O contrato foi relido contra o código antes de iniciar o P0. Quatro afirmações do rascunho de 2026-07-29 estavam erradas:

| # | O rascunho dizia | O código diz | Efeito no P0 |
|---|---|---|---|
| 1 | `/api/capabilities`: "404 é aceitável" | 404 → retry infinito → o pusher nunca abre a porta (Armadilha #2) | Promovido a **bloqueante**; teste #4 invertido |
| 2 | `/api/woka/list` é bloqueante | Gated por capability no [`WokaService.ts:10`](../../play/src/pusher/services/WokaService.ts); sem a capability o pusher usa o catálogo local | Rebaixado para 🟡 — mas fica no P0 pelo motivo #3 |
| 3 | *(não mencionado)* | O `/api/room/access` precisa resolver `characterTextureIds` → `WokaDetail[]`, então o catálogo de Wokas é nosso de qualquer forma (Armadilha #3) | O `/api/woka/list` entra no P0 como fonte única desse catálogo |
| 4 | `MapDetailsData` tem "~45 campos" para acertar | O schema `zod` exige exatamente um: `group`, nullable | O risco do P0 é funcional, não de schema: é um porte fiel do `LocalAdmin` |

Uma quinta apareceu durante a implementação do E2:

| # | O rascunho dizia | O código diz | Efeito no P0 |
|---|---|---|---|
| 5 | `Authorization: <token>` em todos os endpoints | O `/api/capabilities` é chamado **sem objeto de config**, logo sem header nenhum ([`AdminApi.ts:208`](../../play/src/pusher/services/AdminApi.ts)) | A proteção por token precisa isentar esse caminho, senão um 403 pendura o pusher igual a um 404 |

Mais uma omissão: o efeito colateral de ligar o `admin-api` abrange **40 variáveis de ambiente**, não apenas o `MAP_EDITOR_ALLOW_ALL_USERS` (ver *Efeito colateral importante*).

## Pontos confirmados

**2026-07-29**

1. ✅ **Identidade** — PK interna + `email` como chave de lookup + `oidc_sub` preparada para o Azure (decisão #5). Chavear por `sub` puro é inviável: o pusher não o envia.
2. ✅ **Bootstrap** — seed idempotente com o e-mail do primeiro admin vindo de env var (decisão #6).
3. ✅ **Mundos** — mundo único no P0; `world` devolvido como valor fixo (decisão #7).

**2026-07-30**

4. ✅ **Stack** — workspace TypeScript dentro do monorepo, Express 5 + Vitest, Drizzle na persistência (decisão #1). Ditado pelo teste obrigatório #1: os schemas `zod` precisam ser importados, não redigitados.
5. ✅ **Configuração** — o `admin-api` lê o mesmo `.env` da raiz do repositório de onde o `play` interpola, para que as 40 variáveis compartilhadas tenham um valor só.

Nenhum ponto pendente bloqueia o início do P0.

## Referências

- [`play/src/pusher/services/AdminApi.ts`](../../play/src/pusher/services/AdminApi.ts) — **a fonte da verdade do contrato** (chamadas, headers, parsing `zod`, o laço de retry do `initialise()`)
- [`play/src/pusher/services/AdminInterface.ts`](../../play/src/pusher/services/AdminInterface.ts) — interface TypeScript
- [`play/src/pusher/services/LocalAdmin.ts`](../../play/src/pusher/services/LocalAdmin.ts) — comportamento padrão sem Admin API; **a especificação executável do P0**
- [`play/src/pusher/services/WokaService.ts`](../../play/src/pusher/services/WokaService.ts) — o gating por capability da lista de Wokas (Armadilha #3)
- [`play/src/pusher/services/LocalWokaService.ts`](../../play/src/pusher/services/LocalWokaService.ts) — resolução de texturas e o catálogo `woka.json`
- [`play/src/pusher/app.ts`](../../play/src/pusher/app.ts) e [`play/src/server.ts`](../../play/src/server.ts) — a sequência de inicialização que a Armadilha #2 bloqueia
- [`libs/messages/src/JsonMessages/MapDetailsData.ts`](../../libs/messages/src/JsonMessages/MapDetailsData.ts) — o schema a importar nos testes de contrato
- [Doc oficial: implementar sua própria Admin API](../others/self-hosting/adminAPI.md)
- Swagger de referência: `https://play.workadventu.re/swagger-ui/`
- [Spec 0001 — Roadmap](../specs/0001-feature-roadmap.pt-BR.md) (Feature 3)
