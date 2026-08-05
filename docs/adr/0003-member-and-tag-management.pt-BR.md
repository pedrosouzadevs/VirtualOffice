# ADR-0003: Gestão de membros e tags (Admin API, P1)

- **Status:** Aceito
- **Data:** 2026-07-31
- **Decisores:** Equipe ArqueumSpace
- **Idiomas:** este arquivo (pt-BR) + [0003-member-and-tag-management.md](0003-member-and-tag-management.md) (en-US), em lockstep.
- **Origem:** [ADR-0002](0002-admin-api.pt-BR.md), fase P1. Spec [0001 — Roadmap de Features](../specs/0001-feature-roadmap.pt-BR.md), Feature 3.

## Contexto

O P0 está entregue e rodando: o `play` conversa com o `admin-api`, as tags vêm do Postgres e o `canEdit` as segue.
Restam duas lacunas, e as duas são visíveis para quem usa o produto.

**Conceder uma permissão significa escrever SQL na mão.** É o bloqueio original deste roadmap com roupa nova: as tags
estão persistidas, mas mudar uma continua não sendo algo que uma pessoa faz por tela.

**O campo "usuário permitido" da área pessoal está morto.** O [`MemberAutocomplete.svelte`](../../play/src/front/Components/Input/MemberAutocomplete.svelte)
alimenta o `PersonalAreaPropertyEditor` e chama o `searchMembers`, que não implementamos. É a pendência #4 do Spec
0001, e é o campo que permitiria que a propriedade de área do **F4** fosse *atribuída* por um administrador, em vez de
apenas *reivindicada* por quem chegar primeiro.

A P1 fecha as duas. O dashboard em si é P2 e está explicitamente **fora** deste escopo.

## Contrato verificado

Quatro endpoints, lidos do [`AdminApi.ts`](../../play/src/pusher/services/AdminApi.ts) e não da documentação — a
prática que o ADR-0002 adotou depois que cinco comportamentos documentados se revelaram inexistentes.

| Endpoint | Query | Resposta | O pusher valida? |
|---|---|---|---|
| `/api/members` | `playUri`, `searchText` | `MemberData[]` | ✅ `MemberData.array().parse` |
| `/api/members/{uuid}` | — | `MemberData` | ❌ **não** |
| `/api/world/tags` | `playUri`, `searchText` | `string[]` | ❌ **não** |
| `/api/room/tags` | `roomUrl` | `string[]` | ✅ `z.string().array().parse` |

O `MemberData` é `{ id, name (nullable), email (nullable), visitCardUrl?, chatID? }`.

### A armadilha: o `MemberData.id` precisa ser o e-mail

Devolver nossa chave primária interna aqui pareceria organizado e **quebraria o F4**, que já está entregue. A cadeia:

```
MemberAutocomplete            → value: member.id
  → setOwnerId()              → property.ownerId = selectedOwner.value
    → MapEditorModeManager:523  compara ownerId !== userUUID
      → userUUID = localUser.uuid = userUuid do /api/room/access = o e-mail
```

Um dono atribuído pelo seletor seria gravado com um identificador que nunca casa com a pessoa em runtime: a área
ficaria com dono fantasma, que ninguém consegue exercer. O inverso também vale — o `/api/members/{uuid}` recebe o
`property.ownerId`, então aquele segmento de caminho é um **e-mail**, apesar do nome.

É a decisão #5 do ADR-0002 pela terceira vez: **a chave primária interna nunca sai do banco.** Ela já quase vazou pelo
`userUuid` (P0/E5) e agora pelo `MemberData.id`. Merece teste explícito, não comentário.

### Dois endpoints que o pusher não valida

O `getMember` e o `searchTags` devolvem `response.data` direto do axios, sem `zod`. Uma resposta malformada nossa
falha, portanto, lá adiante em vez de na fronteira, com mensagem de erro muito pior. **Nós validamos a própria saída
nesses dois**, para que a falha caia do nosso lado da linha, onde dá para diagnosticar.

### Nomes nunca chegam até nós

O `/api/room/access` não recebe nome nenhum — só `userIdentifier`, `playUri`, `ipAddress`, texturas e o token. Nossa
coluna `member.username` nunca é preenchida pelo fluxo normal, e o `MemberData.name` fica `null`. Veja a decisão #2
para o porquê de mantermos assim, e o que isso custa.

## Decisões

### 1. O `MemberData.id` é o e-mail do membro

Mesmo identificador do `userUuid` no `/api/room/access`, pelo motivo acima. Nosso `member.id` (uuid) continua interno.

O custo é que nosso identificador público muda se o e-mail de alguém mudar — mas isso já vale para o `userUuid`, e as
áreas pessoais já guardam o e-mail. Nada piora; a chave interna segue como âncora estável de tags, concessões e
futuros registros de propriedade.

### 2. **Não** declarar a capability `api/save-name`

Declará-la preencheria o `member.username` com o nome que o usuário digita, o que seria conveniente. Também faz o
front **ignorar por completo a política de nome do woka** — [`ConnectionManager.ts:636`](../../play/src/front/Connection/ConnectionManager.ts):

```ts
if (hasCapability("api/save-name")) {
    gameManager.setPlayerName(username);   // opidWokaNamePolicy nunca é consultada
} else {
    // só aqui force_opid / allow_override_opid são respeitadas
}
```

Queremos o `allow_override_opid` — o provedor de identidade fornece um nome padrão, e a pessoa pode trocar. É
exatamente o que a capability desligaria, então a deixamos sem declarar e o `opidWokaNamePolicy` continua sendo o
mecanismo. Já servimos esse campo pelo `/api/map` (P0/E3).

Há ainda um risco não resolvido na direção oposta: o `username` que o front aplica vem do **token OIDC**
(`AuthenticateController.ts:318` → `MeResponse`), não do nosso banco. Com a capability declarada, um nome editado pelo
usuário poderia plausivelmente ser sobrescrito pelo valor do provedor no login seguinte. Não perseguimos isso até o
fim porque a decisão acima torna a questão irrelevante.

> **Custo, dito com todas as letras:** o `MemberData.name` fica `null`, então o autocomplete de membros mostra apenas
> endereços de e-mail. Mitigado por um comando `member:set-name` na CLI abaixo, suficiente para as poucas pessoas que
> aparecem nesses seletores. A solução real chega com o dashboard, na P2.

### 3. Gerenciar membros e tags por CLI, não por API HTTP

A P1 precisa de um jeito de conceder tag sem SQL. Ela **não** precisa de uma API HTTP de gestão — o único consumidor
de uma seria o dashboard, que é P2.

Entregar essa API agora significaria protegê-la com o token que o `admin-api` já compartilha com o pusher, e esse
token passaria a conferir também o poder de dar qualquer permissão a qualquer pessoa. Alargar um segredo
máquina-a-máquina para um segredo que concede privilégio, meses antes de existir consumidor, não compra nada.

A CLI roda dentro do container com as credenciais de banco do próprio serviço, não acrescenta superfície de rede e é
scriptável para trabalho em lote. A superfície HTTP chega na P2, autenticada por OIDC e restrita à tag `admin` — a
circularidade que a decisão #6 do ADR-0002 (bootstrap) existe para romper.

### 4. `OPID_WOKA_NAME_POLICY=allow_override_opid`

Definido no `.env.template` para que a intenção fique registrada, e não subentendida. Não tem efeito enquanto um
provedor de identidade não emitir de fato uma claim de username — o mock OIDC de desenvolvimento emite `name`,
enquanto o `OPENID_USERNAME_CLAIM` tem padrão `username` — então isto é preparação para o **F2 (Azure Entra ID)**,
onde a claim será apontada para `name` ou `preferred_username`.

## Alternativas consideradas

### A. Declarar o `api/save-name` para preencher o `username`
- **Prós:** nomes aparecem no autocomplete sem trabalho extra; o nome acompanha a pessoa entre dispositivos.
- **Contras:** desliga o `opidWokaNamePolicy`, que é o mecanismo do comportamento `allow_override_opid` escolhido;
  possível sobrescrita da edição do usuário a cada login.
- **Rejeitada** — troca controle, pedido explicitamente pela equipe, por um confortozinho de UI.

### B. API HTTP de gestão já na P1, com token próprio
- **Prós:** adianta a P2; scriptável pela rede.
- **Contras:** endpoint que concede privilégio protegido por segredo compartilhado, sem consumidor por meses.
- **Rejeitada** para a P1; é o que a P2 constrói, com autenticação de verdade.

### C. Continuar gerenciando tags por SQL
- **Prós:** trabalho zero.
- **Contras:** deixa o bloqueio original do roadmap resolvido pela metade.
- **Rejeitada.**

## Consequências

### Positivas
- O seletor de dono de área pessoal passa a funcionar, tornando a propriedade do **F4** atribuível e não apenas
  reivindicável.
- A gestão de tags deixa de exigir SQL.
- Nenhuma superfície de autenticação nova, e nenhuma mudança no comportamento de nome.

### Negativas
- O `MemberData.name` fica `null` até a P2, então os seletores mostram e-mails.
- A CLI só é alcançável por quem consegue `exec` no container — proposital, mas significa nenhuma gestão remota até a
  P2.

### Neutras
- O `api/save-name` e o `api/save-textures` continuam sem declarar. O segundo nunca esteve no escopo: persistiria
  trajes no servidor e mexe justamente na resolução de texturas consertada no P0.

## Plano de implementação

| Fatia | Escopo |
|---|---|
| **F0** | `/api/members` e `/api/members/{id}`, com `id` = e-mail. Teste de regressão de que casa com o `userUuid`. Destrava o seletor de dono. |
| **F1** | `/api/world/tags` e `/api/room/tags`, lidos da tabela `tag`. |
| **F2** | CLI: `member:list`, `member:grant`, `member:revoke`, `member:set-name`, `tag:list`. |
| **F3** | `OPID_WOKA_NAME_POLICY` no `.env.template`, docs bilíngues, e2e do seletor de dono. |

## Testes obrigatórios

1. **Teste de contrato** por endpoint contra o `MemberData` importado de `@workadventure/messages` — nunca redigitado.
2. **O `MemberData.id` é igual ao `userUuid` devolvido pelo `/api/room/access` para a mesma pessoa.** É o teste de
   regressão da armadilha acima; comentário não basta, já quase aconteceu duas vezes.
3. Membro sem tags é devolvido, não omitido: ausência de tags não é ausência do membro.
4. A busca casa por e-mail independentemente do casing, coerente com o armazenamento em minúsculo do P0/E4.
5. Membro desconhecido em `/api/members/{id}` → `404` com corpo de erro tipado, nunca HTML.
6. Todo comando da CLI é idempotente: conceder duas vezes, revogar duas vezes, nenhum dos dois é erro.
7. Token errado → 403, tanto nos endpoints novos quanto nos existentes.

## Referências

- [ADR-0002 — Admin API própria](0002-admin-api.pt-BR.md) — o contrato, suas armadilhas e o P0
- [`play/src/pusher/services/AdminApi.ts`](../../play/src/pusher/services/AdminApi.ts) — fonte da verdade dos quatro endpoints
- [`play/src/front/Components/Input/MemberAutocomplete.svelte`](../../play/src/front/Components/Input/MemberAutocomplete.svelte) — o consumidor que torna o `MemberData.id` crítico
- [`play/src/front/Connection/ConnectionManager.ts`](../../play/src/front/Connection/ConnectionManager.ts) — onde o `api/save-name` sobrepõe a política de nome
- [Setup — `admin-api`](../SETUP-ADMIN-API.pt-BR.md)
