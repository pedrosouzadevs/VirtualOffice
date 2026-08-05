# ADR-0001: Trava persistente de área controlada pelo dono, com tinta vermelha

- **Status:** Aceito (implementado e validado em campo em 2026-07-29)
- **Data:** 2026-07-23
- **Decisores:** Equipe ArqueumSpace
- **Idiomas:** este arquivo (pt-BR) + [0001-area-owner-lock.md](0001-area-owner-lock.md) (en-US), em lockstep.
- **Spec de origem:** [Spec 0001 — Roadmap de Features](../specs/0001-feature-roadmap.pt-BR.md), Feature 4.

## Contexto

No ArqueumSpace, cada usuário é dono de uma **área** dentro de um **mapa único compartilhado** — seu escritório virtual. O objetivo é permitir que o dono **feche e reabra** sua área quando quiser, com uma trava **persistente**, e que a trava tenha **representação visual** — uma tinta vermelha semi-transparente sobre a área enquanto trancada.

> ⚠️ Premissa corrigida durante o desenho: "sala" aqui é **área dentro de um mapa**, não um mapa/URL próprio. Isso descartou o uso de `RoomRedirect` (que troca de mapa) e o gate em `/api/room/access` (que é nível de mapa).

### O que já existe (verificado no código)

| Primitiva | Onde | Comportamento atual |
|---|---|---|
| **Área pessoal** | `personalAreaPropertyData` em [`libs/map-editor/src/types.ts`](../../libs/map-editor/src/types.ts) | Tem `ownerId` e `accessClaimMode` (`dynamic` = reivindica andando com a tag; `static` = dono atribuído). A doc a descreve como *"the user's virtual office space"*. **A propriedade de dono já existe e já persiste.** |
| **Área com trava** | `lockableAreaPropertyData` | Trava/destrava; bloqueio de entrada por **colisão** na borda. |
| **Estado da trava** | Variável de propriedade de área, chave `"lock"` (booleana) | Escrita por `setAreaPropertyLockState(areaId, propertyId, locked)` ([`AreaPropertyVariablesStore.ts`](../../play/src/front/Stores/AreaPropertyVariablesStore.ts)); lida por `AreasManager.isAreaLocked()`, que dispara `updateAreaCollision()` ([`AreasManager.ts`](../../play/src/front/Phaser/Game/GameMap/AreasManager.ts)). Sincronizada pelo servidor a todos os clientes. |
| **Auto-destravar** | **No `back`**, no evento de saída de usuário | Comentários em `AreasManager.ts:262` e `AreasPropertiesListener.ts:353`: *"unlock when empty is handled by the back on user leave"*. **É aqui que mora a semântica efêmera.** |
| **Reposicionar avatar** | `CurrentPlayer.teleportTo(x, y)` ([`GameScene.ts:3566`](../../play/src/front/Phaser/Game/GameScene.ts)) | Já usado por `WA.player.teleport`. Move o avatar **dentro do mesmo mapa**. |
| **Coordenadas de área** | `AreaData` = `{x, y, width, height}` | Em **pixels**. Conversão para tiles: `area.x / tilewidth`, com `tilewidth ?? 32` ([`GameMapFrontWrapper.ts:543`](../../play/src/front/Phaser/Game/GameMap/GameMapFrontWrapper.ts)). |

**Conclusão do contexto:** não é preciso construir trava, propriedade nem persistência. Tudo existe. O que falta é **trocar a semântica** (efêmera→persistente, qualquer-um→só-dono) e **desenhar as paredes**.

## Decisão

### 1. Estender `lockableAreaPropertyData` (não criar propriedade nova)

Acrescentar um **modo**, mantendo o default no comportamento atual:

```ts
export const LockableAreaPropertyData = PropertyBase.extend({
    type: z.literal("lockableAreaPropertyData"),
    allowedTags: z.array(z.string()).optional(),
    // NOVOS:
    lockMode: z.enum(["ephemeral", "owner"]).default("ephemeral"),
    ownerCanEject: z.boolean().optional(), // F5, ver §8
});
```

O `default("ephemeral")` é o ponto central: **mapas existentes continuam funcionando sem migração**, porque o zod preenche o modo atual. Nenhuma trava efêmera em uso muda de comportamento.

**Nota histórica (2026-07-29):** o P0 também introduziu `doorGapTiles` e `gracePeriodSeconds`, para os desenhos de porta/carência que foram depois **descartados** (§3 e §6). Ficaram órfãos e foram **removidos do schema**. Mapas salvos no intervalo ainda carregam essas chaves; como o schema não é `.strict()`, o zod as descarta no parse — sem migração necessária.

### 2. Dono vem da área (standalone, sem `admin-api`)

Com `lockMode: "owner"`, o dono é o `ownerId` do `personalAreaPropertyData` **da mesma área**. Isso torna o F4 **independente do F3**.

**Regra de validação:** `lockMode: "owner"` exige que a área também tenha `personalAreaPropertyData`. Sem isso, a configuração é inválida — o editor deve impedir, e o runtime deve degradar para `ephemeral` em vez de quebrar.

### 3. Sinalização visual: tinta vermelha persistente enquanto trancada (revisado 2026-07-24)

**Revisão de escopo (2026-07-24):** os desenhos anteriores — arte de porta e, depois, **paredes procedurais com abertura ao sul** — foram **descartados** após teste em runtime. Motivo: o usuário viu que (a) uma área trancada já reage visualmente ao toque (fica vermelha, via `flashBlockedArea`) e (b) **ninguém fica preso** — quem está dentro simplesmente anda para fora. Paredes e "porta de saída" eram complexidade desnecessária.

**Decisão:** enquanto a área está trancada, aplicar uma **tinta vermelha semi-transparente persistente** sobre a área — a mesma cor do flash de colisão (`0xff6b6b` a `0.25`), mas **sem fade**, durando o tempo da trava. É a afordância "esta área está fechada", visível para **todos**, inclusive quem está dentro.

Implementação: `Area.setLockedHighlight(locked)` ([Area.ts](../../play/src/front/Phaser/Entity/Area.ts)) pinta/limpa a tinta; dirigido por [`AreasManager.updateAreaCollision`](../../play/src/front/Phaser/Game/GameMap/AreasManager.ts), que já observa a variável `"lock"` e é chamado em toda mudança de estado. **Sem paredes, sem Phaser Graphics novo, sem cálculo de coordenada de saída.**

#### Enforcement continua sendo a colisão existente

A colisão de acesso **não muda**: é **binária por cliente** — quem está **fora** recebe colisão (não entra); quem está **dentro não recebe** e anda para fora livremente (`AreasManager` linhas 275-278: *"Users already inside can still exit"*). A tinta é puramente **visual**; não altera acesso.

#### Escopo da tinta

Aplica-se a **qualquer** área trancada (owner **e** efêmera). Para locks efêmeros (salas de reunião), a área também fica vermelha enquanto trancada — melhora a afordância, mas é uma mudança visual de um recurso já existente. Restringir a `lockMode: "owner"` é uma linha, caso se prefira não tocar no visual do lock efêmero.

### 4. Persistência: o `back` não auto-destrava no modo `owner`

A mudança de comportamento é **um ponto no `back`**: no evento de saída de usuário, o auto-destravar passa a ser condicional — só ocorre quando `lockMode === "ephemeral"`. No modo `owner`, a variável `"lock"` permanece como está até que **o dono** a altere.

### 5. Quem pode travar

- Modo `ephemeral`: comportamento atual (qualquer um dentro, opcionalmente gated por `allowedTags`). **Inalterado.**
- Modo `owner`: **somente o dono**. O botão de trava fica desabilitado para os demais.

### 6. Comportamento com a área fechada (não-donos)

**Revisão de escopo (2026-07-24):** removidos o botão **"Sair da área"**, a **carência de reconexão** e o **teleporte** (`RoomRedirect`/reposicionamento). Motivo: o usuário **não fica preso** — a colisão barra apenas a *entrada*; quem está dentro anda para fora normalmente. Saída assistida era desnecessária.

| Situação | Comportamento |
|---|---|
| Está dentro e quer sair | Anda para fora — a colisão só barra entrada, não saída (comportamento atual) |
| Nunca esteve dentro | Barrado na borda por colisão (comportamento atual) |
| Reconexão | Tratada como qualquer entrada: se ainda trancada e não é dono, é barrado na borda — **sem carência** |
| Administrador | **Sem exceção** — não fura a trava |

Consequência: os campos de schema `doorGapTiles` e `gracePeriodSeconds` (introduzidos no P0 para os desenhos abandonados) ficaram órfãos e foram **removidos do schema** em 2026-07-29. Só `lockMode` (e o `ownerCanEject` do F5) têm efeito.

### 7. Fechar ≠ esvaziar

Fechar a área é um **portão de entrada**: bloqueia novos entrantes, não expulsa ninguém. Quem está dentro permanece até sair andando por vontade própria.

### 8. Ejeção de ocupantes pelo dono (adicionado 2026-07-24)

O dono pode **ejetar** ocupantes da sua área — o complemento ativo do "portão de entrada" (a trava barra quem chega; a ejeção tira quem já está). Decidido em 2026-07-24 com **dois modos** e bloqueio por **flag por área**.

#### O que o dono faz

- **Ejetar todos:** um clique move para fora **todos os não-donos** dentro da área.
- **Ejetar específico:** o dono vê a lista de ocupantes (não-donos) e remove pessoas individualmente.

O front do dono computa a lista localmente (jogadores cuja posição cai dentro do retângulo da área). A **ejeção em si é mediada pelo servidor** — o dono não move o cliente alheio diretamente.

#### Mecanismo (reusa primitiva existente)

`MoveToPositionMessage` já existe: o back a envia a um usuário e o front dele executa `GameScene.moveTo(position)` ([RoomConnection.ts:687](../../play/src/front/Connection/RoomConnection.ts)). É a primitiva de "reposicionar o alvo". Falta apenas uma mensagem de **requisição** dono→pusher→back (`EjectFromAreaMessage { areaId, targetUserId? }`; sem `targetUserId` = todos os não-donos), espelhando o fluxo de `SetAreaPropertyVariableMessage`.

Fluxo: dono clica → front envia `EjectFromAreaMessage` → back **valida** (requisitante é o dono via `personalAreaPropertyData.ownerId`, e `ownerCanEject` está ligada) → back acha os alvos dentro da área e envia `MoveToPositionMessage` (para uma coordenada fora da borda) a cada um.

#### Bloqueio pelo admin (flag por área)

Novo campo `ownerCanEject: boolean` (**default `true`**) na `lockableAreaPropertyData`, editável **só pelo map editor** — que já é restrito a `admin`/`editor`. Como o dono (membro comum) **não** abre o map editor, ele não reverte o bloqueio. O admin abre a área daquele dono e desliga. Granular por dono, **sem depender do F3**.

Enforcement **nos dois lados** (defense-in-depth, como no P2): o front esconde/desabilita o botão quando `ownerCanEject === false`; o back **rejeita** a requisição, então um cliente forjado não burla.

#### Precondições e destino

- Requer `personalAreaPropertyData` na área (fonte do dono) — mesma precondição do owner-lock. Sem dono, sem ejeção.
- Destino da ejeção: coordenada **fora da borda** da área (reposicionamento no mesmo mapa, via `moveTo`). Não é `RoomRedirect` (que troca de mapa).
- Ejeção **não exige** que a área esteja trancada. O combo natural é ejetar e depois trancar, para não voltarem.

### 9. Bolhas de voz não atravessam a borda trancada (adicionado 2026-07-29)

Descoberto em teste de campo: a formação de bolha de proximidade era puramente por distância — alguém colado na borda, por fora, iniciava chat de voz com quem estava dentro da sala trancada, anulando a privacidade.

**Decisão:** enquanto a área está trancada (qualquer modo — dono ou efêmero), **a bolha não cruza a borda**. Quem está do mesmo lado (ambos dentro, ou ambos fora) conversa normalmente. Implementado no **servidor** (`GameRoom.searchClosestAvailableUserOrGroup` consulta `arePositionsSeparatedByLockedArea`), então um cliente forjado não burla.

**Limite conhecido (v1):** uma bolha que já atravessava a borda no momento do trancamento não é desfeita — ela se dissolve quando os participantes se afastam. O que a trava impede é a **formação** de novas bolhas atravessadas.

## Alternativas consideradas

### A. Criar uma propriedade nova (`ownerLockableAreaPropertyData`)
- **Prós:** isolamento total; zero risco à trava efêmera.
- **Contras:** duplica o conceito de "área trancável"; dois sistemas de trava para manter, dois editores, duas telas; o usuário precisaria entender a diferença.
- **Rejeitada:** o `lockMode` com default preserva o comportamento antigo com muito menos duplicação.

### B. Propriedade do dono vinda do `admin-api` (F3)
- **Prós:** gestão centralizada e auditada; atribuir/revogar áreas pelo dashboard.
- **Contras:** cria dependência rígida do F3, que é a maior feature do roadmap — adiaria o F4 por semanas.
- **Adiada, não rejeitada:** a área pessoal já persiste `ownerId`. O dashboard pode gerir propriedade depois, como evolução, sem bloquear agora.

### C. `RoomRedirect` para "teleportar para fora"
- **Rejeitada:** `RoomRedirect` troca o usuário de **mapa/URL**. Aqui ele deve permanecer no mesmo mapa. Camada errada.

### D. Coordenada de saída livre (sem porta)
- **Prós:** mais simples de implementar.
- **Contras:** sem affordance visual — o usuário não vê que a área está fechada nem por onde se entra/sai.
- **Rejeitada:** as paredes com abertura ao sul resolvem UX e determinismo da saída de uma vez.

### E. Porta como asset de arte configurável (4 paredes, posição livre)
- **Prós:** flexível; porta em qualquer parede.
- **Contras:** exige produzir arte (aberta/fechada) — dependência externa; e colisão perímetro-menos-vão, cara.
- **Rejeitada (decisão do usuário):** paredes procedurais com vão fixo ao sul entregam o mesmo valor visual sem arte e sem tocar no modelo de colisão.

## Consequências

### Positivas
- **Barato:** reaproveita propriedade, trava, persistência e reposicionamento já existentes. Esforço **S**.
- **Retrocompatível:** `lockMode` default `"ephemeral"` → mapas atuais intactos, sem migração.
- **Destrava o roadmap:** F4 deixa de depender do F3 e pode ser entregue primeiro — dando valor visível cedo, que era o ponto fraco da ordem anterior.
- **Affordance clara:** a porta comunica o estado sem UI extra.
- **Saída para o bloqueio permanente já existe:** a área pessoal suporta *"revoke access"* pelo editor, sem precisar do F3.

### Negativas
- **Duas semânticas numa propriedade só:** o editor precisa deixar claro qual modo está ativo, sob risco de confundir.
- **Toca o `back`:** o auto-destravar vira condicional; é o ponto de maior risco de regressão.
- **Bloqueio permanente é real:** sem override de admin, dono sumido = área fechada. Mitigado pelo *revoke* da área pessoal, mas exige ação manual.
- **Novo desenho procedural:** as paredes exigem código de render (Phaser Graphics), embora barato e sem arte.

### Neutras
- Carência vive no `back` (não no front nem no `admin-api`).
- **Sem dependência de arte** — resolvido pela decisão de paredes procedurais.
- Paredes são puramente visuais; o enforcement é a colisão binária já existente.

## Plano de implementação

| Fase | Escopo | Status |
|---|---|---|
| **P0** | Schema: `lockMode` + validação (owner exige área pessoal). | ✅ feito |
| **P1** | `back`: auto-destravar condicional ao `lockMode`. Teste de regressão do modo efêmero primeiro. | ✅ feito |
| **P2** | Front + back: restringir trava ao dono no modo `owner` (função pura `canToggleAreaLock`, enforcement nos dois lados). | ✅ feito |
| **P3** | Front: **tinta vermelha persistente** enquanto trancada (`Area.setLockedHighlight`, dirigido pelo `AreasManager`). | ✅ feito |
| ~~P4~~ | ~~Carência + botão sair + teleporte~~ — **removido** (usuário não fica preso; anda para fora). | ❌ cortado |
| **P5** | Docs (seção "Owner mode" na doc de usuário da área bloqueável; ADR aceito). | ✅ feito |
| **P6** | Endurecimento de campo: flash vs. tinta, passe do dono, degradação sem dono, sem bypass de admin, tinta auto-regenerativa, isolamento de bolhas (§9). | ✅ feito |

### Fases da ejeção (§8, adicionado 2026-07-24)

> **Nota (2026-07-29):** a ejeção foi **promovida a feature própria (F5)** no [roadmap](../specs/0001-feature-roadmap.pt-BR.md), executada após o F3. O design continua sendo este §8; a E0 está entregue.

| Fase | Escopo | Status |
|---|---|---|
| **E0** | Schema `ownerCanEject` (default `true`) na `lockableAreaPropertyData` + toggle no `LockableAreaPropertyEditor` (só admin/editor via map editor). | pendente |
| **E1** | Protobuf `EjectFromAreaMessage { areaId, targetUserId? }` (front→pusher→back) + regenerar messages. | pendente |
| **E2** | `back`: handler + validação (dono via `ownerId` **e** `ownerCanEject`) + achar ocupantes na área + enviar `MoveToPositionMessage` para fora da borda. | pendente |
| **E3** | Front: botão de ejeção (só dono, gated por `ownerCanEject`) com "ejetar todos" + lista de ocupantes para ejeção individual. | pendente |
| **E4** | Testes (validação de dono/flag no back; função pura de "pode ejetar") + docs. | pendente |

### Testes de regressão obrigatórios

1. **Modo efêmero inalterado** — trava, esvazia, destrava sozinha. *(O mais importante: é a feature em produção.)* ✅
2. Modo `owner`: **não** destrava ao esvaziar. ✅
3. Só o dono trava/destrava; botão desabilitado para os demais. ✅
4. `lockMode: "owner"` sem área pessoal → degrada para `ephemeral`, não quebra. ✅
5. Novo entrante barrado com a área fechada; quem está dentro anda para fora (colisão só barra entrada). *(comportamento existente)*
6. Tinta vermelha aparece ao trancar e some ao destrancar. *(visual Phaser — verificação manual no app; difícil em unidade)*

> Itens de reconexão/carência/teleporte/porta foram **removidos** com o corte de escopo do P3/P4.

## Pontos confirmados

1. ✅ **Sem arte, sem paredes** — reusa a tinta vermelha do flash de colisão, persistente.
2. ✅ **Só áreas retangulares** — sem caso de área composta para salas pessoais.
3. ✅ **Ninguém fica preso** — a colisão só barra a entrada; a saída é andar para fora.

Nenhum ponto pendente bloqueia a implementação.

## Referências

- [Spec 0001 — Roadmap de Features](../specs/0001-feature-roadmap.pt-BR.md) (Feature 4)
- [`libs/map-editor/src/types.ts`](../../libs/map-editor/src/types.ts) — `LockableAreaPropertyData`, `PersonalAreaPropertyData`, `AreaData`
- [`play/src/front/Phaser/Game/GameMap/AreasManager.ts`](../../play/src/front/Phaser/Game/GameMap/AreasManager.ts) — `isAreaLocked`, colisão
- [`play/src/front/Stores/AreaPropertyVariablesStore.ts`](../../play/src/front/Stores/AreaPropertyVariablesStore.ts) — `setAreaPropertyLockState`
- [Doc de área pessoal](../map-building/inline-editor/area-editor/personal-area.md)
- [Doc de área com trava](../map-building/inline-editor/area-editor/lockable-area.md)
