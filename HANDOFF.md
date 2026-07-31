# HANDOFF

Feature 3 do [Spec 0001](docs/specs/0001-feature-roadmap.pt-BR.md) — a Admin API própria (`admin-api`).
Branch **`feature/admin-api`**, 18 commits à frente de `master`.

Este documento não depende de nada que tenha sido dito em conversa. Tudo o que é preciso para continuar está aqui ou
nos documentos linkados.

---

## Current Status

**P0 e P1 entregues, verificados e commitados. P2 desenhada e aprovada, sem implementação.**

O `play` já consome o `admin-api` de verdade: tags e `canEdit` vêm do Postgres, e não mais da claim OIDC. O ambiente
de desenvolvimento sobe ligado por padrão (`ADMIN_API_URL` está no `docker-compose.yaml` versionado).

| Fase | Escopo | Estado |
|---|---|---|
| P0 (E1–E6) | 4 endpoints bloqueantes, Postgres, bootstrap idempotente, `play` ligado | ✅ entregue |
| P1 (F0–F3) | `/api/members*`, `/api/*/tags`, CLI de gestão, docs, e2e | ✅ entregue |
| P2 (G0–G4) | Dashboard de administração | 📐 ADR aceito, **zero código** |

**Verificação atual:** 109 testes unitários, 53 de integração (Postgres real), 7 e2e (Playwright, executados contra a
stack rodando). `typecheck`, `eslint` e `prettier` limpos.

### Onde a leitura deve começar

Nesta ordem, e não pule o ADR-0002 — ele é o contrato:

1. [`docs/adr/0002-admin-api.pt-BR.md`](docs/adr/0002-admin-api.pt-BR.md) — o contrato verificado no código, as três
   armadilhas, e o que muda ao ligar o serviço
2. [`docs/adr/0003-member-and-tag-management.pt-BR.md`](docs/adr/0003-member-and-tag-management.pt-BR.md) — a P1
3. [`docs/adr/0004-admin-dashboard.pt-BR.md`](docs/adr/0004-admin-dashboard.pt-BR.md) — a P2, **próximo trabalho**
4. [`admin-api/AGENTS.md`](admin-api/AGENTS.md) — as convenções do pacote
5. [`docs/SETUP-ADMIN-API.pt-BR.md`](docs/SETUP-ADMIN-API.pt-BR.md) — subir, verificar, gerir permissões, rollback

---

## Completed

### P0 — o esqueleto que responde certo

Quatro endpoints servidos a partir do Postgres, com o `play` funcionando ponta a ponta:

| Endpoint | Papel |
|---|---|
| `GET /api/capabilities` | Negociação. **Sempre 200**, e **sem exigir token** |
| `GET /api/map` | Porte fiel do `LocalAdmin.fetchMapDetails` |
| `GET /api/room/access` | Onde as tags do banco viram `canEdit` |
| `GET /api/woka/list`, `GET /api/companion/list` | Catálogos, fonte única com a resolução de texturas |

Mais: Postgres dedicado (`admin-api-db`), migrations forward-only com Drizzle, bootstrap idempotente do primeiro
admin, e `/healthz` + `/readyz`.

### P1 — membros e tags

`GET /api/members`, `GET /api/members/{id}`, `GET /api/world/tags`, `GET /api/room/tags`, e uma CLI:

```bash
docker compose exec admin-api npm run member:list
docker compose exec admin-api npm run member:grant    -- alguem@empresa.com editor
docker compose exec admin-api npm run member:revoke   -- alguem@empresa.com editor
docker compose exec admin-api npm run member:set-name -- alguem@empresa.com "Nome"
docker compose exec admin-api npm run tag:list
```

Efeito visível: o campo "usuário permitido" da área pessoal (modo estático) **passou a funcionar** — era a pendência
#4 do Spec 0001, e é o que torna a propriedade de área do F4 atribuível por tela.

### Correções de contrato encontradas lendo o código

Seis afirmações da documentação do WorkAdventure não correspondem ao código. Estão detalhadas no ADR-0002; as duas
que mais custam:

- **404 no `/api/capabilities` pendura o pusher.** O `initialise()` faz retry sem limite, o `app.init()` o aguarda, e
  o `server.ts` aguarda o `init()` **antes** de escutar. O `play` não cai — ele nunca abre a porta.
- **O `/api/capabilities` é chamado sem header `Authorization`.** Protegê-lo dá 403 e cai no mesmo laço.

---

## Pending

### P2 — o dashboard (próximo trabalho)

Desenho completo e aprovado no [ADR-0004](docs/adr/0004-admin-dashboard.pt-BR.md). Fatias:

| Fatia | Escopo |
|---|---|
| **G0** | Espinha de segurança: login OIDC, callback, cookie de sessão assinado, barreira da tag `admin`, `/admin/logout`, `GET /admin/me`. **Sem UI de propósito.** |
| **G1** | `/admin/api/*`: membros, tags, nome. Handlers finos sobre os repositórios do P1. |
| **G2** | UI em Svelte 5 + Vite em `admin-api/src-ui/`, seguindo o `map-storage/src-ui` |
| **G3** | Visão de salas, lendo o `/maps` do `map-storage` |
| **G4** | Log de auditoria, docs bilíngues, e2e de login → conceder → tag valendo no `play` |

### Fora da P2, em aberto no roadmap

- **F2 (Azure Entra ID)** — o `OPID_WOKA_NAME_POLICY=allow_override_opid` já está preparado no `.env.template`, mas
  só tem efeito quando um provedor emitir claim de username. O mock emite `name`, e o `OPENID_USERNAME_CLAIM` tem
  padrão `username`.
- **`MemberData.name` fica nulo** no fluxo normal — o `/api/room/access` não recebe nome do pusher. Contornável pelo
  `member:set-name`. Decisão registrada no ADR-0003 (#2).
- **Sem `member:delete`** na CLI. Removido por SQL; documentado no setup.
- **Sujeira no banco de dev:** `dev@arqueum.com`, `pedro.henrique@arqueum.com` e `fulano@empresa.com` existem sem
  tags. Inofensivos.

---

## Risks

### Ambiente Windows — quatro armadilhas que já custaram tempo

1. **O hook de pre-commit não roda.** Os `node_modules/.bin/*` são symlinks POSIX criados de dentro do container; o
   node do Windows recebe `EACCES`. Falha nos 8 diretórios que o `.husky/pre-commit` percorre.
   **Acordado com o usuário:** commitar com `--no-verify` e rodar os checks manualmente no container.

2. **A ferramenta de edição às vezes grava CRLF**, o que reescreve o arquivo inteiro no diff.
   **Sempre** conferir `git diff --stat` antes de commitar e normalizar:
   ```bash
   node -e "const fs=require('fs');const f='ARQUIVO';const b=fs.readFileSync(f,'utf8');fs.writeFileSync(f,b.replace(/\r\n/g,'\n'))"
   ```
   O `Path.write_text` do Python tem o mesmo problema — use `open(..., newline="")`.

3. **Nada roda no host.** O node é 20.9.0 e o Vitest 4 exige ≥ 20.12; o eslint não resolve os symlinks de workspace.
   **Tudo pelo container:**
   ```bash
   docker compose run --rm admin-api sh -c 'npm run typecheck && npm run lint && npm run pretty-check && npx vitest run && npx vitest run --config vitest.integration.config.ts'
   ```

4. **O `npx playwright` não funciona** (faltam os shims `.cmd`). Invoque por node:
   ```bash
   cd tests && node ../node_modules/@playwright/test/cli.js test tests/admin_api.spec.ts --project=chromium --reporter=list
   ```

### Pré-requisitos que não são óbvios

- **Entrada no hosts** (já adicionada nesta máquina): `127.0.0.1 admin-api.workadventure.localhost`. Navegadores e
  `curl` resolvem `*.localhost` sozinhos; o node não. Sem ela, todo `fetch` do e2e falha com `ENOTFOUND`.
  **Serviço novo = entrada nova no hosts.**
- **`map-storage/tests/assets.zip`** é artefato gerado e não versionado; **nenhum** teste de map_editor roda sem ele.
  O `Compress-Archive` do PowerShell produz zip com `\` que o `unzipper` rejeita — precisa ser zip POSIX (use
  `adm-zip`, que está no `node_modules`).
- **O `play` leva minutos para subir** (só o Vite gasta ~150 s). O 502 do Traefik durante esse período é normal.

### Riscos do produto

- **Ligar o `admin-api` move 40 variáveis de ambiente.** O `/api/map` passa a ser montado do ambiente *dele*, e as
  cópias no `play` deixam de valer para esses campos. O compose interpola os dois do mesmo `.env` da raiz — se
  divergirem, o sintoma é "o chat sumiu", não um erro.
- **Quem tinha tag só pela claim OIDC perde o acesso** ao ligar. É para isso que existe o bootstrap.
- **Rollback é imediato:** esvaziar `ADMIN_API_URL` no `.env` e recriar o `play`. Nada se perde.

---

## Next Step

**G0 — a espinha de segurança do dashboard.** Primeiro e sem UI de propósito: a fronteira deve existir e estar
testada antes de haver qualquer coisa atrás dela.

Entregar:

1. Rotas `/admin/login`, `/admin/callback`, `/admin/logout` — não autenticadas, por allowlist explícita, do mesmo
   jeito que o `/api/capabilities` já é tratado em
   [`adminApiTokenAuthentication.ts`](admin-api/src/api/middlewares/adminApiTokenAuthentication.ts)
2. Cliente OIDC com `openid-client@5.7.1` (já é dependência do `play`; ver
   [`OpenIDClient.ts`](play/src/pusher/services/OpenIDClient.ts)). Em dev **não precisa registrar client novo** — o
   mock tem `RedirectUris: ["http://*.workadventure.localhost"]`
3. Sessão em JWT assinado, cookie `HttpOnly` + `SameSite` + `Secure` em produção. **1 hora deslizante, teto absoluto
   de 12 horas**
4. Barreira que **reverifica a tag `admin` a cada requisição**, sem confiar na cópia dentro do token
5. `GET /admin/me`
6. Testes obrigatórios #1 a #5 e #8 a #9 do ADR-0004 — em especial: **o `ADMIN_API_TOKEN` não abre `/admin/*` e o
   cookie de sessão não abre `/api/*`**, nos dois sentidos

---

## Do Not Change Without Approval

Cada item abaixo tem teste de regressão. Se um deles quebrar, **não ajuste o teste** — o teste está certo.

1. **`/api/capabilities` responde 200 e não exige token.** 404 ou 403 penduram o `play`, que nunca abre a porta.

2. **O `userUuid` do `/api/room/access` é o identificador que o pusher enviou** — o e-mail — e **nunca** o
   `member.id` interno. O front grava esse valor no `personalAreaPropertyData.ownerId`, e trocá-lo órfãa **todas** as
   áreas pessoais já reivindicadas, quebrando o F4 que já está entregue.

3. **O `MemberData.id` é o e-mail**, pelo mesmo motivo, um nível acima: o seletor de membros grava esse valor como
   dono da área.

4. **A chave primária interna nunca sai do banco.** Os itens 2 e 3 são a mesma regra (decisão #5 do ADR-0002). Já
   quase vazou três vezes.

5. **O `/api/room/access` resolve texturas na ordem de `wokaPartNames`**, não na ordem pedida. O front empilha as
   camadas na ordem do array — devolver a ordem do pedido pinta cabelo embaixo do corpo.

6. **O `characterTextureIds` chega com colchetes** (`characterTextureIds[]=...`), porque o axios serializa arrays
   assim. O parser `extended` do Express é o que dobra isso de volta. Sem ele o avatar sai em branco **e o usuário
   não é redirecionado** — a falha é silenciosa.

7. **A capability `api/save-name` continua sem declarar.** Declará-la faz o front ignorar o `opidWokaNamePolicy`, e
   com ele a escolha `allow_override_opid` (o Azure fornece o nome, a pessoa pode trocar). Decisão #2 do ADR-0003.

8. **O `canEdit` não honra `MAP_EDITOR_ALLOW_ALL_USERS` nem `MAP_EDITOR_ALLOWED_USERS`.** Reproduzi-los devolveria a
   autorização a uma variável de ambiente que ninguém muda por tela, que é o oposto do objetivo da feature.

9. **Membro desconhecido no `/api/room/access` entra com `tags: []` e `canEdit: false`** — nunca erro. Falhar ali
   significaria que nenhum visitante novo consegue entrar no mundo.

10. **Os schemas `zod` são importados de `@workadventure/messages`, nunca redigitados.** O do `/api/room/access` foi
    movido para lá justamente para isso, e é re-exportado do `AdminApi.ts` — **nenhum import do `play` mudou**.

### Também não mexer sem conversar

- **`docker-compose.yaml`:** o `play` depende do healthcheck do `admin-api`, que depende do Postgres. Essa cadeia
  existe para evitar a armadilha do item 1 na subida.
- **`play/src/pusher/services/AdminApi.ts` e `libs/messages/src/index.ts`:** foram tocados para mover o schema. O
  typecheck do `play` tem **436 erros pré-existentes** (matrix-js-sdk, sentry, grpc) — esse é o baseline, medido nas
  duas árvores. Qualquer número diferente disso é regressão.
