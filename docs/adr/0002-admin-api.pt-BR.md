# ADR-0002: Admin API própria (`admin-api`) para membros, tags e permissões

- **Status:** Proposto
- **Data:** 2026-07-29
- **Decisores:** Equipe VirtualOffice
- **Idiomas:** este arquivo (pt-BR) + [0002-admin-api.md](0002-admin-api.md) (en-US), em lockstep.
- **Spec de origem:** [Spec 0001 — Roadmap de Features](../specs/0001-feature-roadmap.pt-BR.md), Feature 3.

## Contexto

Hoje o `play` **não tem banco de usuários**. Sem uma Admin API, as tags (`admin`, `editor`, …) vêm exclusivamente da claim OIDC — não há onde persistir uma permissão atribuída por uma tela. Foi exatamente o bloqueio que originou este roadmap: *"não consigo arrumar as tags"*.

O pusher já sabe conversar com uma Admin API: quando `ADMIN_API_URL` está definido, ele deixa de usar o stub [`LocalAdmin.ts`](../../play/src/pusher/services/LocalAdmin.ts) e passa a chamar HTTP via [`AdminApi.ts`](../../play/src/pusher/services/AdminApi.ts). **Nós não escolhemos o contrato — ele já existe.** Nosso trabalho é implementá-lo do outro lado.

> ⚠️ **Risco central desta feature:** o contrato é consumido em runtime com validação `zod`. Um campo faltando ou com tipo errado em `/api/map` ou `/api/room/access` **quebra o login e o carregamento do mapa**. Por isso este ADR documenta o contrato **verificado no código**, não a documentação (que está incompleta).

### Efeito colateral importante

Com `ADMIN_API_URL` definido, `MAP_EDITOR_ALLOW_ALL_USERS` passa a ser **ignorado** — o `admin-api` assume o controle do acesso ao editor de mapa. Ou seja: **no dia em que ligarmos o `admin-api`, a configuração atual por env var deixa de valer.** O `canEdit` passa a vir da nossa resposta.

## Contrato verificado (fonte: `AdminApi.ts`)

### Autenticação — a primeira armadilha

```
Authorization: <ADMIN_API_TOKEN>
```

O token vai **cru, sem o prefixo `Bearer`** (`headers: { Authorization: \`${ADMIN_API_TOKEN}\` }`). Um servidor que exija `Bearer <token>` rejeita todas as chamadas. Também é enviado `Accept-Language` com o locale do usuário.

### Endpoints

| Endpoint | Método | Criticidade | Papel |
|---|---|---|---|
| `/api/capabilities` | GET | **Negociação** | Retorna as capabilities suportadas. **404 é aceitável** — o pusher assume o conjunto padrão. É o que permite implementar por fases. |
| `/api/map` | GET | 🔴 **Bloqueante** | `?playUri&userId?&accessToken?` → `MapDetailsData` \| `RoomRedirect` \| `ErrorApiData`. Sem isso, nenhum mapa carrega. |
| `/api/room/access` | GET | 🔴 **Bloqueante** | `?userIdentifier&playUri&ipAddress&characterTextureIds&companionTextureId&accessToken&isLogged&chatID` → dados do membro (inclui `tags` e `canEdit`). Sem isso, ninguém entra. |
| `/api/woka/list` | GET | 🔴 **Bloqueante** | Lista de avatares (Wokas) do mundo. |
| `/api/companion/list` | GET | 🟡 | Lista de companions. |
| `/api/members`, `/api/members/{uuid}` | GET | 🟡 | Busca e detalhe de membro. |
| `/api/world/tags`, `/api/room/tags` | GET | 🟡 | Tags disponíveis (alimenta os seletores do editor). |
| `/api/ban`, `/api/report` | GET/POST | 🟡 | Moderação. |
| `/api/save-name`, `/api/save-textures`, `/api/save-companion-texture` | POST | ⚪ Opcional | Gated por capability. |
| `/api/room/same`, `/api/chat/members`, `/api/login-url/{token}` | GET | ⚪ Opcional | Mundos, chat, login por token. |

### Formatos de resposta (campos exatos)

**`/api/room/access`** → `status: "ok"` mais:
```
email, username?, userUuid, tags[], visitCardUrl,
isCharacterTexturesValid, characterTextures, isCompanionTextureValid, companionTexture,
messages, userRoomToken, activatedInviteUser, applications, canEdit, world, chatID, canRecord
```
`canEdit` é o campo que **libera o editor de mapa** — é aqui que a gestão de tags vira efeito prático.

**`/api/map`** → `MapDetailsData` (~45 campos: `mapUrl`, `wamUrl`, `group`, `authenticationMandatory`, `editable`, `enableChat*`, `metatags`, `modules`, …), **ou** `RoomRedirect` (`{ redirectUrl }`), **ou** `ErrorApiData`.

> O volume de campos do `MapDetailsData` é a razão de o P0 abaixo existir: acertar esse payload é metade do trabalho de integração.

## Decisão

### 1. Serviço novo `admin-api`, Clean Architecture, PostgreSQL dedicado

Domain → Application → Infrastructure/API. Postgres próprio (decisão #3 do spec), sem integração com banco corporativo nesta fase.

### 2. Faseamento guiado pelas capabilities

O `/api/capabilities` permite entregar **incrementalmente sem quebrar o `play`**: implementamos o núcleo bloqueante primeiro e declaramos só o que existe.

### 3. Dashboard separado

Front próprio (Next.js), autenticado só para administradores, consumindo a API do `admin-api` — **não** os endpoints que o pusher usa.

### 4. Contrato antes de features

O P0 é um "esqueleto que responde certo": os 3 endpoints bloqueantes servindo dados do Postgres, com o `play` funcionando ponta a ponta. Só então vêm membros/tags/UI.

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
| **P0 — Esqueleto que responde certo** | `admin-api` + Postgres + os 3 endpoints bloqueantes (`/api/map`, `/api/room/access`, `/api/woka/list`) + `/api/capabilities` declarando o mínimo. Meta: `ADMIN_API_URL` ligado e o `play` funcionando como hoje. |
| **P1 — Membros e tags** | CRUD de membros, atribuição de tags, `canEdit` derivado das tags. Endpoints `/api/members*`, `/api/world/tags`, `/api/room/tags`. |
| **P2 — Dashboard** | UI de administrador: listar/buscar membros, atribuir tags, ver salas. |
| **P3 — Moderação** | `/api/ban`, `/api/report`, mundos, `/api/room/same`. |
| **P4 — Endurecimento** | Log de auditoria, RBAC no próprio dashboard, threat model STRIDE, rotação de segredos. |

### Testes obrigatórios

1. **Teste de contrato** por endpoint bloqueante: a resposta valida contra o mesmo schema `zod` que o pusher usa (`isMapDetailsData`, `isFetchMemberDataByUuidSuccessResponse`). *Reusar os schemas de `@workadventure/messages` — não redigitar.*
2. Login ponta a ponta com `ADMIN_API_URL` ligado.
3. `canEdit` verdadeiro/falso conforme as tags do membro.
4. `/api/capabilities` ausente (404) não derruba o `play`.
5. Token errado → 403 em todos os endpoints.

## Pontos a validar antes do código

1. **Fonte de identidade:** o `userIdentifier` que chega no `/api/room/access` é o e-mail (confirmado no dev). O modelo de membro deve casar por e-mail, ou por `sub` do OIDC? Impacta a chave primária.
2. **Bootstrap do primeiro admin:** como o primeiro administrador ganha acesso ao dashboard antes de existir alguém para lhe dar a tag? (seed inicial ou variável de ambiente).
3. **Mundos:** modelamos `world` desde o P0 (o campo existe na resposta) ou assumimos mundo único por ora?

## Referências

- [`play/src/pusher/services/AdminApi.ts`](../../play/src/pusher/services/AdminApi.ts) — **a fonte da verdade do contrato**
- [`play/src/pusher/services/AdminInterface.ts`](../../play/src/pusher/services/AdminInterface.ts) — interface TypeScript
- [`play/src/pusher/services/LocalAdmin.ts`](../../play/src/pusher/services/LocalAdmin.ts) — comportamento padrão sem Admin API
- [Doc oficial: implementar sua própria Admin API](../others/self-hosting/adminAPI.md)
- Swagger de referência: `https://play.workadventu.re/swagger-ui/`
- [Spec 0001 — Roadmap](../specs/0001-feature-roadmap.pt-BR.md) (Feature 3)
