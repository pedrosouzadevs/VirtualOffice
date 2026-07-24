# ADR-0001: Trava persistente de área controlada pelo dono, com paredes visuais

- **Status:** Proposto
- **Data:** 2026-07-23
- **Decisores:** Equipe VirtualOffice
- **Idiomas:** este arquivo (pt-BR) + [0001-area-owner-lock.md](0001-area-owner-lock.md) (en-US), em lockstep.
- **Spec de origem:** [Spec 0001 — Roadmap de Features](../specs/0001-feature-roadmap.pt-BR.md), Feature 4.

## Contexto

No VirtualOffice, cada usuário é dono de uma **área** dentro de um **mapa único compartilhado** — seu escritório virtual. O objetivo é permitir que o dono **feche e reabra** sua área quando quiser, com uma trava **persistente**, e que essa trava tenha **representação visual pelas paredes** — retângulo fechado (travada) ou com abertura ao sul (destravada).

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
    doorGapTiles: z.number().min(1).default(2),  // largura da abertura ao sul, em tiles
    gracePeriodSeconds: z.number().min(0).max(300).default(300),
});
```

O `default("ephemeral")` é o ponto central: **mapas existentes continuam funcionando sem migração**, porque o zod preenche o modo atual. Nenhuma trava efêmera em uso muda de comportamento.

**Sem `DoorData` configurável:** a porta é **sempre no sul, centralizada** (ver decisão #3). Só a largura da abertura (`doorGapTiles`) é parametrizável, com default de 2 tiles.

### 2. Dono vem da área (standalone, sem `admin-api`)

Com `lockMode: "owner"`, o dono é o `ownerId` do `personalAreaPropertyData` **da mesma área**. Isso torna o F4 **independente do F3**.

**Regra de validação:** `lockMode: "owner"` exige que a área também tenha `personalAreaPropertyData`. Sem isso, a configuração é inválida — o editor deve impedir, e o runtime deve degradar para `ephemeral` em vez de quebrar.

### 3. Paredes procedurais + abertura padronizada ao sul (sem arte)

**Decisão do usuário (2026-07-23):** não depender de asset de porta. Em vez de uma arte de porta, desenhar **paredes procedurais** ao redor da área e sinalizar o estado pela **abertura**:

- **Fechada (travada):** retângulo de paredes **completo** — os quatro lados.
- **Aberta (destravada):** o mesmo retângulo, mas com uma **abertura na parede sul**, sempre — largura `doorGapTiles` (default 2), centralizada.

Isso dá a afordância que o usuário queria (retângulo fechado vs. retângulo com vão) **sem nenhum asset**. O desenho usa **Phaser Graphics** (procedural), na mesma família do highlight/flash que a área já usa hoje.

#### Separação crítica: paredes são **visuais**, o enforcement é a colisão existente

A colisão de acesso **não muda**. Verificado em [`AreasManager.updateAreaCollision`](../../play/src/front/Phaser/Game/GameMap/AreasManager.ts): a colisão é **binária por cliente** — quem está **fora** recebe colisão na área (não entra); quem já está **dentro não recebe** e circula/sai livremente (linhas 275-278: *"Users already inside can still exit"*).

**Consequência ótima:** o requisito "quem está dentro fica" **já é satisfeito de graça** pelo mecanismo atual. As paredes procedurais são apenas o **desenho** por cima; elas não implementam colisão "perímetro-menos-vão" (que seria caro). Enforcement = a colisão binária de sempre; afordância = o desenho.

#### Cálculo da coordenada de saída (sempre ao sul)

Como a abertura é sempre ao sul e centralizada, a saída é determinística. Dada a área `{x, y, width, height}` (px) e o tile `T = map.tilewidth ?? 32`:

```
saída = ( x + width / 2 ,  y + height + T / 2 )
```

Ou seja: **um tile abaixo da parede sul, centralizado** — exatamente onde fica a abertura. O `T/2` centraliza o avatar no tile de destino.

Sem fallback de porta ausente: a saída **sempre existe** (é padronizada), eliminando o caso de erro do desenho anterior.

### 4. Persistência: o `back` não auto-destrava no modo `owner`

A mudança de comportamento é **um ponto no `back`**: no evento de saída de usuário, o auto-destravar passa a ser condicional — só ocorre quando `lockMode === "ephemeral"`. No modo `owner`, a variável `"lock"` permanece como está até que **o dono** a altere.

### 5. Quem pode travar

- Modo `ephemeral`: comportamento atual (qualquer um dentro, opcionalmente gated por `allowedTags`). **Inalterado.**
- Modo `owner`: **somente o dono**. O botão de trava fica desabilitado para os demais.

### 6. Comportamento com a área fechada (não-donos)

| Situação | Comportamento |
|---|---|
| Está dentro e quer sair | Botão **"Sair da área"** → `teleportTo(abertura ao sul)` |
| Caiu a conexão, voltou **dentro** de N | Reentra normalmente |
| Caiu a conexão, voltou **depois** de N | Reposicionado para a abertura ao sul |
| Nunca esteve dentro | Barrado na borda por colisão (**comportamento atual, sem mudança**) |
| Administrador | **Sem exceção** — não fura a trava |

`N = gracePeriodSeconds`, **máximo 300s (5 min)**, imposto pelo schema (`.max(300)`).

**Rastreio da carência:** feito pelo **`back`**, que já observa entrada/saída de usuário na área (é onde vive o auto-destravar). Token `(userId, areaId)` com TTL ≤ 300s. Emitido a quem estava dentro no momento do fechamento.

### 7. Fechar ≠ esvaziar

Fechar a área é um **portão de entrada**: bloqueia novos entrantes, não expulsa ninguém. Quem está dentro permanece até sair por vontade própria (ou pelo botão).

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

| Fase | Escopo |
|---|---|
| **P0** | Schema: `lockMode`, `door`, `gracePeriodSeconds` + validação (owner exige área pessoal). |
| **P1** | `back`: auto-destravar condicional ao `lockMode`. **Teste de regressão do modo efêmero primeiro.** |
| **P2** | Front: restringir trava ao dono no modo `owner`; UI "Fechar/Abrir minha área". |
| **P3** | Paredes procedurais (Phaser Graphics): retângulo completo quando fechada, abertura ao sul quando aberta + cálculo da saída ao sul. |
| **P4** | Carência no `back` (TTL ≤ 300s) + botão "Sair da área" + reposicionamento. |
| **P5** | Testes de regressão completos + docs bilíngues (usuário e desenvolvedor). |

### Testes de regressão obrigatórios

1. **Modo efêmero inalterado** — trava, esvazia, destrava sozinha. *(O mais importante: é a feature em produção.)*
2. Modo `owner`: **não** destrava ao esvaziar.
3. Só o dono trava/destrava; botão desabilitado para os demais.
4. Novo entrante barrado com a área fechada.
5. Quem está dentro permanece ao fechar.
6. Administrador **não** entra.
7. Reconexão **dentro** da carência reentra; **depois** é reposicionada.
8. Botão "Sair" reposiciona para a abertura ao sul.
9. Saída teleporta para o tile ao sul, centralizado na abertura.
10. `lockMode: "owner"` sem área pessoal → degrada para `ephemeral`, não quebra.
11. Render: fechada desenha retângulo completo; aberta desenha abertura ao sul de `doorGapTiles`.

## Pontos confirmados (2026-07-23)

1. ✅ **Sem arte** — paredes procedurais (Phaser Graphics), abertura padronizada ao sul. Sem dependência de asset.
2. ✅ **Só áreas retangulares** — não há caso de área composta para salas pessoais. O modelo `{x,y,width,height}` cobre 100%.
3. ✅ **Uma porta por sala** — basta uma, sempre ao sul. Múltiplas portas fora de escopo.

Nenhum ponto pendente bloqueia o início da implementação.

## Referências

- [Spec 0001 — Roadmap de Features](../specs/0001-feature-roadmap.pt-BR.md) (Feature 4)
- [`libs/map-editor/src/types.ts`](../../libs/map-editor/src/types.ts) — `LockableAreaPropertyData`, `PersonalAreaPropertyData`, `AreaData`
- [`play/src/front/Phaser/Game/GameMap/AreasManager.ts`](../../play/src/front/Phaser/Game/GameMap/AreasManager.ts) — `isAreaLocked`, colisão
- [`play/src/front/Stores/AreaPropertyVariablesStore.ts`](../../play/src/front/Stores/AreaPropertyVariablesStore.ts) — `setAreaPropertyLockState`
- [Doc de área pessoal](../map-building/inline-editor/area-editor/personal-area.md)
- [Doc de área com trava](../map-building/inline-editor/area-editor/lockable-area.md)
