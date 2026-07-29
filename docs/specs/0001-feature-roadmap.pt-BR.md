# Spec 0001 — Roadmap de Features (VirtualOffice / WorkAdventure)

- **Status:** Rascunho (proposto)
- **Data:** 2026-07-23
- **Autor:** Equipe VirtualOffice
- **Idiomas:** este arquivo (pt-BR) + [0001-feature-roadmap.md](0001-feature-roadmap.md) (en-US), mantidos em lockstep.

## TL;DR

Este documento especifica quatro features para o fork VirtualOffice do WorkAdventure:

1. **Entidade animada** — usuário faz upload de um GIF animado; o sistema converte em spritesheet e o disponibiliza como um **novo tipo** de objeto animado, posicionável livremente pelo editor inline.
2. **Autenticação Azure** — adicionar o Azure Entra ID (Microsoft) como provedor de login, **mantendo** o provedor atual (OIDC mock/dev) em paralelo.
3. **Dashboard e APIs de administração** — implementar a Admin API (contrato `AdminInterface`) com persistência própria e uma UI de administrador para gestão de membros, tags e permissões.
4. **Dono da área abre/fecha sua área** — permitir que o usuário dono de uma **área** (seu escritório dentro do mapa compartilhado) a feche e reabra quando quiser (trava persistente, controlada pelo dono).
5. **Ejeção de ocupantes pelo dono** *(promovida a feature própria em 2026-07-29)* — o dono remove ocupantes da sua área ("todos" ou individual), bloqueável pelo admin via flag por área. Design em [ADR-0001 §8](../adr/0001-area-owner-lock.pt-BR.md); fundação (E0: schema + `canEjectFromArea`) já entregue.

**Ordem definida:** **F4 → F3 → F2 → F1** (revisada em 2026-07-23). O F4 foi confirmado **standalone** — a propriedade fica na área, sem depender do `admin-api` — e é o mais barato (**S**), então entrega valor visível primeiro. Depois vem a fundação (F3), a identidade sobre ela (F2) e, por fim, o F1.

Detalhe de desenho do F4 já decidido e registrado no [ADR-0001](../adr/0001-area-owner-lock.pt-BR.md).

Cada feature não-trivial recebe seu próprio **ADR** em `docs/adr/` antes da implementação. Toda doc é bilíngue (§ regra do projeto). Todo bug fix leva teste de regressão.

---

## Contexto de arquitetura (compartilhado)

WorkAdventure é um monorepo de serviços: `play` (front Svelte/Phaser + pusher WebSocket + room-api), `back` (estado da sala), `map-storage` (mapas/assets e edições do editor), `messages` (protobuf, contrato entre serviços), `libs/*`.

Fatos que ancoram este spec:

- **Editor inline** grava no arquivo `.wam` (metadados WA), nunca no `.tmj` (Tiled). Só funciona em URLs `/~/` (mapas no map-storage).
- **Entidades (objetos)** são renderizadas por `play/src/front/Phaser/ECS/Entity.ts`, que **estende `Phaser.GameObjects.Image`** — textura estática, sem animação.
- **Tiles animados** existem nativamente (`GameScene.configureTileAnimations`), mas são presos à grade e pintados no Tiled — não servem para "objeto solto que o usuário sobe".
- **Autorização (tags):** sem Admin API, as tags vêm exclusivamente da claim OIDC (`OPENID_TAGS_CLAIM`, default `tags`). `LocalAdmin.ts` é um stub. Com `ADMIN_API_URL` definido, o `MAP_EDITOR_ALLOW_ALL_USERS` é ignorado — a Admin API passa a mandar.
- **Licença:** AGPL-3 + Commons Clause. Uso interno é livre; revender como serviço, não. Considerar em qualquer decisão de produto.

---

## Feature 1 — Entidade animada (novo tipo)

### Objetivo

Usuário sobe um GIF animado no editor de entidades; o sistema o transforma automaticamente em um objeto animado que roda no mundo e é posicionável livremente (mesma UX das entidades atuais).

### Não-objetivos

- Animar tiles do mapa (grade/Tiled).
- Editor de animação frame-a-frame na UI.
- Suporte a vídeo (mp4/webm) nesta fase.

### Decisão de design

Criar um **tipo de entidade novo e paralelo** (`AnimatedEntity`), sem tocar na `Entity` estática. Justificativa: a `Entity` (711 linhas) concentra colisão, profundidade, outline e ativação; trocar sua classe base de `Image` para `Sprite` arriscaria regressões em tudo que já funciona. Um tipo paralelo isola o risco (confirmado como preferência na conversa).

Três camadas mudam:

| Camada | Mudança |
|---|---|
| **Conversão** (map-storage, novo) | No upload: decodificar GIF (frames + durações) → montar spritesheet PNG → extrair metadados (`frameWidth`, `frameHeight`, `frameCount`, durações/`frameRate`). Libs candidatas: `sharp` (libvips com suporte a GIF) ou `gifuct-js`/`omggif`. |
| **Modelo de dados** | Novo prefab/tipo no `libs/map-editor/src/types.ts` (zod) com bloco de animação opcional; nova mensagem protobuf `UploadAnimatedEntityMessage` (ou campos opcionais em `UploadEntityMessage`) em `messages/protos/`. Migração do arquivo de coleção de entidades. |
| **Rendering** (front) | Nova classe `AnimatedEntity extends Phaser.GameObjects.Sprite`: `load.spritesheet` → `anims.create` → `.play()`. Reaproveitar ativação/colisão/outline por composição ou mixin compartilhado — sem alterar a `Entity` estática. Respeitar `localUserStore.getDisableAnimations()`. |

### Alternativas consideradas

- **Estender `Entity` (Image→Sprite):** rejeitada — risco de regressão nas entidades estáticas.
- **Tiles animados:** rejeitada — preso à grade, exige Tiled, sem UX de upload no editor.
- **iframe/overlay com o GIF:** rejeitada — é painel sobreposto, não objeto no mundo.

### Plano faseado

- **P0 — PoC:** renderizar uma `AnimatedEntity` com spritesheet hardcoded no mapa. Prova o rendering antes de investir na conversão. *(Prova de valor rápida.)*
- **P1 — Modelo + protobuf:** novo tipo, mensagem, migração; salvar/ler do map-storage.
- **P2 — Conversão GIF→spritesheet** no upload (map-storage), com limites (nº máximo de frames, dimensão máxima, tamanho de arquivo).
- **P3 — UX do editor:** aceitar `image/gif` no fluxo animado, toggle "animado", validação nos dois lados, testes de regressão.
- **P4 — Docs** bilíngues (usuário e desenvolvedor).

### Riscos

Variância de timing entre frames do GIF; tamanho/performance do spritesheet (muitos frames → textura grande, limite de WebGL); memória; interação com o modo "desativar animações". Guard rails: teto de frames e de dimensão, com erro amigável (nunca 500).

### Esforço estimado: **M–L**

---

## Feature 2 — Autenticação Azure (manter os dois provedores)

### Objetivo

Permitir login via Azure Entra ID (Microsoft), **mantendo** o provedor OIDC atual (mock em dev) disponível.

### Realidade técnica

O `OpenIDClient` (`play/src/pusher/services/OpenIDClient.ts`) resolve **um único** issuer (`Issuer.discover(OPID_CLIENT_ISSUER)`, cacheado em `issuerPromise`). O Azure Entra é compatível com OpenID Connect, então:

- **Trocar** para o Azure é essencialmente **configuração** (apontar as env `OPENID_CLIENT_*` para o tenant Azure).
- **Manter os dois ao mesmo tempo** exige **multi-provider** — não suportado nativamente. É mudança de código (registro de N clients, seleção de provedor no fluxo e na tela de login).

### Ponto crítico: mapeamento de tags

O Azure **não emite** uma claim `tags` por padrão. Para que `admin`/`editor` cheguem ao WA, é preciso mapear **App Roles** ou **grupos** do Entra para a claim configurada em `OPENID_TAGS_CLAIM`. Esse mapeamento é o verdadeiro trabalho de integração, não o login em si.

### Opções de design

| Opção | Descrição | Situação |
|---|---|---|
| **A — Config swap** | Apontar o OIDC para o Azure. Dev segue com o mock; prod usa Azure. | ✅ **ESCOLHIDA** |
| **B — Multi-provider** | Refatorar `OpenIDClient` para manter N clients por `providerId`; seletor na tela de login. | ❌ **Fora de escopo** |

**Decisão (2026-07-23):** adotar a **Opção A**. Os dois provedores **não** precisam coexistir no mesmo ambiente: durante a transição vale **dev = mock / prod = Azure**, e **após o F3 estar completo, o mock é aposentado e fica só o Azure**.

Consequência relevante: o multi-provider (Opção B) — que era o item caro desta feature — **sai do escopo**. O esforço cai de L para S, e o trabalho concentra-se no mapeamento de tags, abaixo.

### Plano faseado

- **P0** — Config-swap do Azure validado em staging (login ponta-a-ponta).
- **P1** — Mapeamento de App Roles/grupos do Entra → claim de tags, com as tags passando a ser resolvidas pelo `admin-api` (F3).
- **P2** — **Aposentadoria do mock**: após o F3 completo, remover o `oidc-server-mock` dos ambientes e deixar só o Azure. Documentar o procedimento de rollback.

### Riscos

Diferença no formato das claims; endpoints Azure v2; claim de tags não-nativa; rotação de segredo do app registration. **Segredos sempre em cofre**, nunca em `appsettings`/`.env` versionado.

⚠️ **Risco de aposentar o mock (P2):** sem o mock, não há login local offline — o ambiente de desenvolvimento passa a depender do tenant Azure (e de conectividade). Antes do P2, decidir se o dev continua com o mock permanentemente ou se haverá um tenant Azure de desenvolvimento.

### Esforço estimado: **S** (config-swap; multi-provider fora de escopo)

---

## Feature 3 — Dashboard e APIs de administração

### Objetivo

Uma UI de administrador + backend para gerir membros, tags/permissões e salas — ou seja, implementar o contrato `AdminInterface` com persistência própria, tornando as trocas de permissão gerenciáveis dentro do produto.

### Realidade técnica

O `play` **não tem banco de usuários**. Sem Admin API, tags só vêm do token OIDC — não há onde persistir uma permissão atribuída por uma tela. Um dashboard de verdade = construir o componente "admin" que o SaaS tem, in-house:

- Novo serviço **`admin-api`** (Clean Architecture: Domain → Application → Infrastructure/API) implementando os endpoints que o pusher espera (o Swagger em `play.workadventu.re/swagger-ui/` e a interface `play/src/pusher/services/AdminInterface.ts`).
- Persistência **PostgreSQL** (membros, tags, mundos, salas, bans).
- Ligação: o pusher chama o `admin-api` via `ADMIN_API_URL` + Bearer `ADMIN_API_TOKEN` (responde 403 se não autenticar).
- Dashboard: front separado (ex. Next.js) autenticado só para administradores.

### Endpoints centrais (do `AdminInterface`)

`/api/map` (mapeia URL→mapa e decide acesso), `/api/room/access` (dados/autorização do membro na sala), `/api/woka/list` (avatares), além de `fetchMemberDataByUuid/ByToken`, `banUserByUuid`, `reportPlayer`, `saveName/saveTextures/saveCompanionTexture`, `getCapabilities`, `searchMembers/searchTags`, `getMember`, `getUrlRoomsFromSameWorld`. A gestão de tags/permissões (CRUD de membro + atribuição de tag) é o que faz `canEdit` e os direitos de área passarem a funcionar de fato.

### Relação com as outras features

- **F2 fornece identidade (AuthN); F3 fornece autorização (AuthZ).** Separação limpa: Azure diz *quem é*; `admin-api` diz *o que pode*.
- Com `ADMIN_API_URL` definido, `MAP_EDITOR_ALLOW_ALL_USERS` é ignorado — o `admin-api` passa a controlar o editor. Esta feature **substitui** a abordagem por env var.
- **F4 depende** desta para persistir dono e estado de trava da sala.

### Plano faseado

- **P0 — Mínimo viável:** `admin-api` implementando só os 3 endpoints centrais (`/api/map`, `/api/room/access`, `/api/woka/list`) servindo de Postgres, plugado no pusher. Login e mapa continuam funcionando.
- **P1 — Membros + tags:** CRUD de membros e atribuição de tags + UI do dashboard.
- **P2 — Moderação:** ban/report, busca, mundos.
- **P3 — Endurecimento:** log de auditoria, RBAC no próprio dashboard, threat model (STRIDE).

### Riscos

Precisa satisfazer **exatamente** o contrato que o pusher espera (o Swagger) — divergência quebra login/mapa. É a maior feature. Segurança: o `admin-api` detém identidade/autorização → threat model obrigatório. Atenção à licença (AGPL + Commons Clause).

### Esforço estimado: **L–XL**

---

## Feature 4 — Dono da área abre/fecha sua área

> **Correção de escopo (2026-07-23):** a versão inicial deste spec assumiu "sala" = mapa/URL própria. **Está errado.** Aqui, "sala" é uma **área dentro de um mapa único**, e cada usuário é dono da sua. Isso muda a camada de implementação e **reduz bastante** o esforço — a maior parte já existe como primitiva.

### Objetivo

O usuário dono de uma **área** (seu escritório virtual dentro do mapa compartilhado) pode **fechar** e **reabrir** essa área quando quiser — trava **persistente**, controlada pelo dono.

### Realidade técnica — três primitivas que já existem

| Primitiva | O que já faz | O que falta |
|---|---|---|
| **Área pessoal** (`personalAreaPropertyData`) | Já é exatamente "cada usuário dono da sua área": tem `ownerId`, e `accessClaimMode` `dynamic` (reivindica andando, gated por tag) ou `static` (dono atribuído). Documentada como *"the user's virtual office space"*. | Nada — a **propriedade já existe**. |
| **Área com trava** (`lockableAreaPropertyData`) | Trancar/destrancar bloqueando a entrada por colisão na borda; quem sai não reentra enquanto trancada. | É **efêmera** (destranca sozinha ao esvaziar) e controlada por **qualquer um dentro**, não pelo dono. |
| **Variáveis de propriedade de área** (`areaPropertyVariableMessage`) | Estado por área+propriedade, sincronizado pelo servidor a todos os clientes. **O estado da trava atual já vive aqui** (ver comentário em `types.ts:216`). | Nada — é a **persistência pronta**. |

**Conclusão:** o F4 não é construir trava do zero. É **casar as duas propriedades de área existentes** — propriedade (personal area) + trava (lockable area) — trocando a semântica de *efêmera/qualquer-um* para *persistente/só-o-dono*.

### Decisão de design

| Aspecto | Proposta |
|---|---|
| **Quem é "dono"** | O `ownerId` da **área pessoal**, que já existe. ⚠️ *Ver "Revisão da decisão #4" abaixo.* |
| **Estado da trava** | **Variável de propriedade de área** (mecanismo já usado pela trava atual), com semântica **persistente** — sem auto-destravar ao esvaziar. |
| **Quem pode trancar** | **Somente o dono** da área (hoje é qualquer um dentro, opcionalmente gated por tag). |
| **UI** | Controle "Fechar/Abrir minha área" para o dono — mesma família do botão de trava que já aparece na barra de ação ao entrar numa área com trava. |
| **Override de admin** | ✅ **Decidido: não.** Administradores não furam a trava. |
| **Quem já está dentro** | ✅ **Decidido: fica.** Fechar bloqueia novos entrantes; não expulsa. |

### ⚠️ Revisão necessária da decisão #4

A decisão #4 dizia que o dono viria do **`admin-api` (F3)**, tornando o F3 pré-requisito rígido. Com "sala = área", isso **precisa ser revisto**: a área pessoal **já persiste `ownerId`** e o modo `dynamic` permite o usuário reivindicar a área sozinho, **sem** `admin-api`.

Duas leituras possíveis — **decidir no ADR**:

- **(a) Standalone:** a propriedade fica na área (como hoje). O F4 **deixa de depender do F3** e pode ser feito a qualquer momento. Mais barato e mais rápido.
- **(b) Via `admin-api`:** o F3 vira a fonte de verdade da propriedade (útil se você quer atribuir/revogar áreas pelo dashboard, com auditoria). Mantém a dependência.

*Recomendação: (a) para entregar, (b) como evolução — o dashboard pode gerir a propriedade depois, sem bloquear a feature agora.*

### Semântica de "fechar"

Fechar ≠ esvaziar. A área fechada é um **portão de entrada**: quem está dentro permanece até sair; quem está fora não entra.

### Comportamento com a área fechada (revisado 2026-07-24)

Para quem **não é o dono**:

| Situação | Comportamento |
|---|---|
| Está dentro e quer sair | **Anda para fora** — a colisão só barra entrada, não saída |
| Nunca esteve dentro | Barrado na borda (colisão), como a trava atual já faz |
| Reconexão | Tratada como qualquer entrada: se ainda trancada e não é dono, barrado na borda — **sem carência** |

Com a área **aberta**, nada disso se aplica.

> **Corte de escopo (2026-07-24):** removidos o **botão "Sair da área"**, a **carência de reconexão** e o **teleporte/reposicionamento**. O usuário **não fica preso** — anda para fora. Detalhe completo no [ADR-0001](../adr/0001-area-owner-lock.pt-BR.md).

#### Sinalização visual

Enquanto trancada, a área ganha uma **tinta vermelha semi-transparente persistente** (a mesma cor do flash de colisão, sem fade) — afordância de "fechada" para todos. Implementado em `Area.setLockedHighlight`, dirigido pelo `AreasManager`.

### Plano faseado (revisado)

- **P0** ✅ — Schema (`lockMode`; `doorGapTiles`/`gracePeriodSeconds` reservados) + validador (owner exige área pessoal).
- **P1** ✅ — Trava persistente: `back` não auto-destrava no modo `owner`.
- **P2** ✅ — Restrição ao dono nos dois lados (`canToggleAreaLock`).
- **P3** ✅ — Tinta vermelha persistente enquanto trancada.
- ~~P4~~ ❌ — Carência/reposicionamento/botão sair: **cortado**.
- **P5** — Docs bilíngues (usuário e desenvolvedor).

### Riscos

Não quebrar a **trava efêmera existente**, que é outra feature em uso — se estendermos a mesma propriedade, o modo atual precisa continuar funcionando (teste de regressão obrigatório). O risco de **bloqueio permanente** (dono some com a área fechada) permanece: mitigar com reatribuição de propriedade — o que a área pessoal **já suporta** ("revoke access" pelo editor, ver doc de área pessoal), sem precisar do F3.

### Esforço estimado: **S** (revisado para baixo — antes S–M no desenho errado de sala=mapa; as três primitivas centrais já existem)

---

## Sequenciamento e dependências

```
F4 (trava de área do dono) ── ✅ entregue (P0–P3 + toggle; falta P5 docs)  [1º]
F3 (admin-api) ──► fundação de AuthZ — PRÓXIMA                             [2º]
      └── F2 liga identidade Azure sobre o F3;
             após o F3 completo, mock aposentado                            [3º]
F5 (ejeção pelo dono) ── standalone; E0 pronta; posição após o F3          [4º]
F1 (entidade animada) ── independente, sem dependências                     [5º]
```

**Ordem definida: F4 ✅ → F3 → F2 → F5 → F1** *(revisada 2026-07-29: F4 entregue; ejeção promovida a F5, posição ajustável).*

Razão: o F4 foi confirmado **standalone** (propriedade na área, sem `admin-api`) e é o mais barato do roadmap — propriedade, trava, persistência e reposicionamento já existem como primitivas. Entrega valor perceptível cedo. Em seguida o F3, fundação de autorização e destino do mapeamento de tags do F2; depois o F2; e o F1 por último, sem risco de bloqueio por não depender de nada.

**Histórico das ordens:** o spec sugeriu inicialmente F1 → F3 → F2 → F4; depois foi definida F3 → F2 → F4 → F1 (fundação primeiro), cujo ponto fraco era adiar todo valor visível até o F3. A correção de escopo do F4 (sala = **área**, não mapa) o tornou barato e independente, resolvendo esse ponto fraco — daí a ordem atual.

## Itens transversais (padrão do projeto)

- **ADR por feature** em `docs/adr/` antes de codar (F1, F3 e o multi-provider do F2 merecem ADR).
- **Docs bilíngues** (en-US + pt-BR) em lockstep.
- **Testes**: unidade + integração; regressão obrigatória por bug fix; harness de conversão do GIF (F1) com casos rotulados.
- **Segurança**: threat model STRIDE para F2/F3/F4; segredos em cofre; PII tagueada e redigida em log.
- **Observabilidade**: logs estruturados, métricas e tracing nas chamadas externas (pusher↔admin-api, conversão de GIF).

## Decisões tomadas (2026-07-23)

| # | Questão | Decisão | Impacto |
|---|---|---|---|
| 1 | **F1** — conversão do GIF no servidor ou no cliente? | **No servidor (map-storage)** | Controle central de limites (frames, dimensão, tamanho) e consistência entre clientes. |
| 2 | **F2** — os dois provedores coexistem no mesmo ambiente? | **Não.** Dev = mock / prod = Azure; **após o F3 completo, só Azure** | Multi-provider sai do escopo. Esforço do F2 cai de **L para S**. |
| 3 | **F3** — PostgreSQL dedicado ao `admin-api`? | **Sim, aprovado** | Sem integração com banco/IdP corporativo nesta fase. |
| 4 | **F4** — origem do "dono" da área? | ✅ **RESOLVIDA: fica na área (standalone).** Usa o `ownerId` do `personalAreaPropertyData`, sem `admin-api` | O F4 **deixa de depender do F3** e foi promovido a 1º da fila. Detalhes no [ADR-0001](../adr/0001-area-owner-lock.pt-BR.md). |
| 5 | Ordem de execução | ✅ **REVISADA: F4 → F3 → F2 → F1** | O F4 virou standalone e barato (S), então entrega valor visível primeiro; ver *Sequenciamento*. |
| 6 | **F4** — admins sobrepõem a trava do dono? | **Não** | Trava soberana. Gera risco de bloqueio permanente → mitigar com reatribuição de dono. |
| 7 | **F4** — quem já está dentro quando fecha? | **Fica** | Fechar barra novos entrantes; não expulsa. |
| 8 | **F4** — reconexão e saída (área fechada) | **Simplificado (2026-07-24):** sem botão de sair, sem carência, sem teleporte — o usuário anda para fora. Enquanto trancada, tinta vermelha persistente | O usuário não fica preso; a colisão só barra entrada. Ver [ADR-0001](../adr/0001-area-owner-lock.pt-BR.md). |
| 9 | **F4** — escopo de "sala" | **Área dentro de um mapa único**, não mapa próprio | Correção de premissa. Esforço do F4 cai para **S**; três primitivas centrais já existem. |

## Pendências remanescentes

1. **F2/P2** — o ambiente de desenvolvimento fica com o mock permanentemente, ou haverá um tenant Azure de dev? (decidir antes de aposentar o mock)
2. **F3** — modelo de dados do `admin-api`: confirmar entidades e relacionamentos (membros, tags, mundos, salas, bans) no ADR.
3. ~~**F4** — origem da propriedade, posição de saída, valor de N, estender vs. nova propriedade, arte da porta~~ → **todas resolvidas** no [ADR-0001](../adr/0001-area-owner-lock.pt-BR.md). Sem dependência de arte: paredes procedurais com abertura padronizada ao sul. **Nenhum ponto pendente bloqueia o início.**
4. **Melhoria (sugerida 2026-07-29)** — no editor, o campo "Usuário permitido" da área pessoal (modo estático) é inútil sem Admin API: o `searchMembers` do `LocalAdmin` rejeita. Proposta: **listar os usuários online** como fallback, permitindo atribuir dono diretamente pelo editor. Encaixe natural: junto do F3 (que traz busca real de membros) ou como item pequeno standalone no pusher.

## Próximos artefatos

- **ADR do F3** (`docs/adr/`) — desenho do `admin-api`: contrato, modelo de dados, autenticação, faseamento. É o próximo documento a escrever.
- ADR do F1 quando a fila chegar nele.
