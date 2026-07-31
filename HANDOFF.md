# HANDOFF

Feature 3 do [Spec 0001](docs/specs/0001-feature-roadmap.pt-BR.md) — a Admin API própria (`admin-api`).
Branch **`feature/admin-api`**, 18 commits à frente de `master`.

Este documento não depende de nada que tenha sido dito em conversa. Tudo o que é preciso para continuar está aqui ou
nos documentos linkados.

---

## Current Status

**P0, P1 e a fatia G0 da P2 entregues, verificados e commitados.**

O `play` já consome o `admin-api` de verdade: tags e `canEdit` vêm do Postgres, e não mais da claim OIDC. O ambiente
de desenvolvimento sobe ligado por padrão (`ADMIN_API_URL` está no `docker-compose.yaml` versionado).

| Fase | Escopo | Estado |
|---|---|---|
| P0 (E1–E6) | 4 endpoints bloqueantes, Postgres, bootstrap idempotente, `play` ligado | ✅ entregue |
| P1 (F0–F3) | `/api/members*`, `/api/*/tags`, CLI de gestão, docs, e2e | ✅ entregue |
| **P2 / G0** | Espinha de segurança do dashboard: login OIDC, sessão, barreira, CSRF | ✅ entregue |
| P2 (G1–G4) | `/admin/api/*`, UI Svelte, visão de salas, auditoria | 📐 ADR aceito, **zero código** |

**Verificação atual:** 188 testes unitários, 53 de integração (Postgres real), 7 e2e (Playwright, executados contra a
stack rodando). `typecheck`, `eslint` e `prettier` limpos. O fluxo de login foi exercido ponta a ponta no navegador
contra o mock OIDC real, incluindo revogar a tag pela CLI e ver a sessão aberta ser negada na requisição seguinte.

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

### G0 — a espinha de segurança do dashboard

`/admin/*` existe, é protegido por padrão, e não tem UI de propósito. Quatro rotas: `GET /admin/login` (com limite de
taxa), `GET /admin/callback`, `POST /admin/logout` e `GET /admin/me`. As três primeiras são allowlist explícita
dentro da barreira, do mesmo jeito que o `/api/capabilities`.

O que sustenta a fatia:

- **Sessão em JWT assinado (`jose`)**, cookie `HttpOnly` + `SameSite=Lax` + `Path=/admin`, `Secure` derivado do
  esquema do `ADMIN_API_PUBLIC_URL`. Uma hora deslizante, renovada quando resta menos da metade, teto absoluto de 12h.
- **A tag `admin` é relida do Postgres a cada requisição.** O cookie responde *quem*; nunca *o que pode*.
- **CSRF por token no header `X-CSRF-Token`**, comparado com uma claim dentro do JWT. O cookie `admin_csrf` existe só
  para o G2 conseguir ler o valor.
- **O dashboard é opcional.** Configuração faltando desliga `/admin/*` com 503 e não encosta no `/api/*` — porque
  matar o `admin-api` pendura o `play`.

Dependências novas no `admin-api`: `jose`, `openid-client`, `cookie-parser` — todas já presentes no monorepo.

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

| Fatia | Escopo | Estado |
|---|---|---|
| **G0** | Espinha de segurança: login OIDC, callback, cookie de sessão assinado, barreira da tag `admin`, `/admin/logout`, `GET /admin/me` | ✅ entregue |
| **G1** | `/admin/api/*`: membros, tags, nome. Handlers finos sobre os repositórios do P1 | ✅ entregue |
| **G2** | UI em Svelte 5 + Vite em `admin-api/src-ui/`, seguindo o `map-storage/src-ui` | ✅ entregue |
| **G3** | Visão de salas, lendo o `/maps` do `map-storage`. **Único item aberto da P2.** | pendente |
| **G4** | Log de auditoria, docs bilíngues, e2e de login → conceder → tag valendo no `play` | ✅ entregue |

**Os dez testes obrigatórios do ADR-0004 estão cobertos.** A dívida que o G1 abriu — mutações sem log — foi paga no
G4, e o log é escrito pelo serviço compartilhado, então a CLI também registra.

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

5. **O `npm install` do host não funciona no `admin-api`.** O mount 9p do Windows força `uid=0`, e a `node_modules` da
   raiz é root. Instalar dependência exige `-u root` e cache fora do bind mount; depois é preciso devolver a
   permissão, ou o Vitest morre com `EACCES` ao escrever `.vite-temp`:
   ```bash
   docker compose exec -T -u root admin-api sh -c 'cd /usr/src/app/admin-api && npm install --cache /tmp/npm-cache'
   docker compose exec -T -u root admin-api chmod -R a+rwX /usr/src/app/admin-api/node_modules
   ```

### O wildcard do mock OIDC não casa com hífen

Custou tempo e o ADR-0004 afirmava o contrário. O `RedirectUris: ["http://*.workadventure.localhost"]` do mock **não
casa hostname com hífen** — `adminapi` passa, `admin-api` e `map-storage` não, qualquer que seja o caminho. Aparece
como `invalid_request / Invalid redirect_uri` na página de erro do próprio provedor, o que parece erro nosso.

O callback do dashboard está registrado explicitamente em `contrib/oidc-server-mock/clients-config.json`. **Mudou o
`ADMIN_API_PUBLIC_URL`? Registre o novo callback lá e recrie o mock.** A correção está anotada no ADR-0004.

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

**G3 — a visão de salas**, e com ela a P2 fecha. Lendo o `/maps` do `map-storage`, que o `admin-api` ainda não
consome: hoje ele só conhece o `PUBLIC_MAP_STORAGE_URL` para montar o `wamUrl` do `/api/map`.

Duas perguntas a responder antes de escrever código:

1. **Como o `admin-api` se autentica no `map-storage`?** O `map-storage` usa basic auth na UI dele e um bearer
   (`MAP_STORAGE_API_TOKEN`) na API. O `play` recebe esse token; o `admin-api` não. Ou passa a receber, ou a visão de
   salas é servida pelo front chamando o `map-storage` direto — e aí volta a questão de CORS que o ADR-0004 evitou.
2. **A visão é só leitura?** O ADR diz "ver salas". Se virar edição, é outra fronteira de permissão e merece decisão
   registrada.

### Antes de qualquer uso real

- **Modelo de ameaça STRIDE** (decisão #7 do ADR-0004): antecipado para *antes* do go-live, e ainda não escrito.
- **HTTPS e `Secure` no cookie.** Já são automáticos quando o `ADMIN_API_PUBLIC_URL` começa com `https://`, mas
  ninguém verificou isso num deploy de verdade.
- **`ADMIN_API_SESSION_SECRET`** ainda é o padrão de desenvolvimento no `.env.template`.

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

11. **O `ADMIN_API_TOKEN` não abre `/admin/*`, e o cookie de sessão não abre `/api/*`.** Nos dois sentidos, cada um
    com teste. A barreira do `/admin` **nunca** lê o header `Authorization`; é isso que garante o primeiro sentido.

12. **A tag `admin` é relida do banco a cada requisição, nunca do token.** É o que faz um administrador revogado
    perder acesso no clique seguinte em vez de uma hora depois — e é o que torna a sessão deslizante segura.

13. **O `ADMIN_API_SESSION_SECRET` não é o `ADMIN_API_TOKEN`.** Reaproveitar o segredo do pusher para assinar sessão
    faz um vazamento virar personificação de qualquer administrador.

14. **O cookie de sessão é `SameSite=Lax`, não `Strict`.** Parece o contrário do certo, e não é: navegadores retêm
    cookies `Strict` em requisições que chegam por cadeia de redirect cross-site, que é exatamente a volta do
    provedor de identidade. `Strict` produz um login que parece funcionar e volta ao provedor em laço. A defesa CSRF
    é o token no header, não o atributo do cookie.

15. **`/admin/*` sem configuração responde 503 e o processo sobe assim mesmo.** Fazer o `admin-api` morrer por causa
    do dashboard pendura o `play` — é o item 1 desta lista por outro caminho.

### Também não mexer sem conversar

- **`docker-compose.yaml`:** o `play` depende do healthcheck do `admin-api`, que depende do Postgres. Essa cadeia
  existe para evitar a armadilha do item 1 na subida.
- **`play/src/pusher/services/AdminApi.ts` e `libs/messages/src/index.ts`:** foram tocados para mover o schema. O
  typecheck do `play` tem **436 erros pré-existentes** (matrix-js-sdk, sentry, grpc) — esse é o baseline, medido nas
  duas árvores. Qualquer número diferente disso é regressão.
