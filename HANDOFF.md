# HANDOFF

Feature 3 do [Spec 0001](docs/specs/0001-feature-roadmap.pt-BR.md) — a Admin API própria (`admin-api`).
Branch **`feature/admin-api`**, 25 commits à frente de `master`.

Este documento não depende de nada que tenha sido dito em conversa. Tudo o que é preciso para continuar está aqui ou
nos documentos linkados.

---

## Current Status

**O F3 inteiro está entregue: P0, P1, P2 e P3, verificadas e commitadas.** O que resta antes de uso real não é código
de feature — está em [Antes de qualquer uso real](#antes-de-qualquer-uso-real).

O `play` já consome o `admin-api` de verdade: tags e `canEdit` vêm do Postgres, e não mais da claim OIDC. O ambiente
de desenvolvimento sobe ligado por padrão (`ADMIN_API_URL` está no `docker-compose.yaml` versionado).

| Fase | Escopo | Estado |
|---|---|---|
| P0 (E1–E6) | 4 endpoints bloqueantes, Postgres, bootstrap idempotente, `play` ligado | ✅ entregue |
| P1 (F0–F3) | `/api/members*`, `/api/*/tags`, CLI de gestão, docs, e2e | ✅ entregue |
| P2 (G0–G4) | Dashboard: barreira de sessão, API, UI Svelte, salas e áreas, auditoria | ✅ entregue |
| P3 (H0–H3) | Moderação: ban, report, `sameWorld`, telas, CLI e docs | ✅ entregue |

**Verificação atual:** 329 testes unitários, 93 de integração (Postgres real), 9 e2e (Playwright, executados contra a
stack rodando). `typecheck`, `svelte-check`, `eslint` e `prettier` limpos. O fluxo foi exercido ponta a ponta no
navegador contra o mock OIDC real: login, conceder tag, ver o `canEdit` mudar no `/api/room/access`, e a entrada de
auditoria nomeando quem concedeu.

### Onde a leitura deve começar

Nesta ordem, e não pule o ADR-0002 — ele é o contrato:

1. [`docs/adr/0002-admin-api.pt-BR.md`](docs/adr/0002-admin-api.pt-BR.md) — o contrato verificado no código, as três
   armadilhas, e o que muda ao ligar o serviço
2. [`docs/adr/0003-member-and-tag-management.pt-BR.md`](docs/adr/0003-member-and-tag-management.pt-BR.md) — a P1
3. [`docs/adr/0004-admin-dashboard.pt-BR.md`](docs/adr/0004-admin-dashboard.pt-BR.md) — a P2, com a **revisão da
   decisão #8** no fim dela: o `admin` só se atribui por SQL
4. [`docs/adr/0005-moderation.pt-BR.md`](docs/adr/0005-moderation.pt-BR.md) — a P3, com as **oito correções de
   contrato** e a decisão #2, que diz o que o ban *não* faz
5. [`docs/security/threat-model.pt-BR.md`](docs/security/threat-model.pt-BR.md) — o STRIDE e o que continua aberto
6. [`admin-api/AGENTS.md`](admin-api/AGENTS.md) — as convenções do pacote
7. [`docs/SETUP-ADMIN-API.pt-BR.md`](docs/SETUP-ADMIN-API.pt-BR.md) — subir, verificar, gerir permissões, rollback

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

Seis afirmações da documentação do ArqueumSpace não correspondem ao código. Estão detalhadas no ADR-0002; as duas
que mais custam:

- **404 no `/api/capabilities` pendura o pusher.** O `initialise()` faz retry sem limite, o `app.init()` o aguarda, e
  o `server.ts` aguarda o `init()` **antes** de escutar. O `play` não cai — ele nunca abre a porta.
- **O `/api/capabilities` é chamado sem header `Authorization`.** Protegê-lo dá 403 e cai no mesmo laço.

---

### P2 — o dashboard

Desenho completo e aprovado no [ADR-0004](docs/adr/0004-admin-dashboard.pt-BR.md). Fatias:

| Fatia | Escopo | Estado |
|---|---|---|
| **G0** | Espinha de segurança: login OIDC, callback, cookie de sessão assinado, barreira da tag `admin`, `/admin/logout`, `GET /admin/me` | ✅ entregue |
| **G1** | `/admin/api/*`: membros, tags, nome. Handlers finos sobre os repositórios do P1 | ✅ entregue |
| **G2** | UI em Svelte 5 + Vite em `admin-api/src-ui/`, seguindo o `map-storage/src-ui` | ✅ entregue |
| **G3** | Salas e as áreas dentro delas — donos das áreas pessoais, silenciosas, de reunião | ✅ entregue |
| **G4** | Log de auditoria, docs bilíngues, e2e de login → conceder → tag valendo no `play` | ✅ entregue |

**Os dez testes obrigatórios do ADR-0004 estão cobertos.** A dívida que o G1 abriu — mutações sem log — foi paga no
G4, e o log é escrito pelo serviço compartilhado, então a CLI também registra.

### P3 — moderação, o conserto

Desenho no [ADR-0005](docs/adr/0005-moderation.pt-BR.md), **aceito**. Não era feature nova: banir e reportar estavam
quebrados desde o P0/E6, porque essas rotas não passam por capability e o pusher as chamava incondicionalmente contra
o nosso 404. No `handleBanPlayerMessage` o `emitBan` vem *depois* do `await`, então o usuário nem era expulso.

| Fatia | Escopo | Estado |
|---|---|---|
| **H0** | Tabela `ban`, `POST /api/ban` com auditoria, `GET /api/ban` respondendo os dois campos | ✅ entregue |
| **H1** | Tabela `report` e `POST /api/report`, corpo JSON com `reportWorldSlug` | ✅ entregue |
| **H2** | `GET /api/room/sameWorld` sobre o `RoomCatalogue` do G3 | ✅ entregue |
| **H3** | Telas de moderação, `ban:list` e `report:list`, docs bilíngues, e2e do ban | ✅ entregue |

**Os dez testes obrigatórios do ADR-0005 estão cobertos**, incluindo o #10: o e2e dirige a UI real — o administrador
expulsa alguém pela caixa de vídeo, a vítima cai na tela `BANNED`, e o `GET /api/ban` confirma o registro.

**Descoberta que o ADR-0005 não previa: o `play` não tem UI de ban.** O `#kickoff-user` do menu da caixa de vídeo
expulsa a pessoa da *reunião* (um evento privado de space), e o `ActionMediaBox.svelte` tem um `ban()` comentado com
`TODO: implement ban user`. O único remetente de `banPlayerMessage` é o evento `banUser` da API de scripting — é por
lá que o e2e do #10 dispara. Essa descoberta é o que originou o ADR-0006, abaixo.

### ADR-0006 — bans emitidos pela dashboard

Decisão de produto (2026-08-04): **a dashboard é a superfície que emite bans** — o botão do `play` fica de fora.
[ADR-0006](docs/adr/0006-dashboard-issued-bans.pt-BR.md), aceito e entregue, revisando a decisão #2 do ADR-0005 e a
regra só-leitura do H3. Um ban da dashboard faz três coisas, nesta ordem:

1. **Registra** — `banIdentifier`, o mesmo serviço do caminho do pusher, com auditoria nomeando o administrador
   **logado** (atribuição melhor que a do `byUserUuid`).
2. **Fecha a porta** — o `/api/room/access` responde `ErrorApiData` (`USER_BANNED`, HTTP **200**) para identificador
   banido. O pusher recusa a conexão e o login; **o ban sobrevive à reconexão sem nenhuma mudança no `play`** e sem
   chamador para o `verifyBanUser`.
3. **Expulsa, best-effort** — pelo `/ws/admin/rooms` do próprio pusher, que estava dormente porque ninguém nunca
   setou o `ADMIN_SOCKETS_TOKEN`. O JWT é HS256 sobre esse token compartilhado; salas agrupadas por
   `roomId.split("/")[5]`, a esquisitice do pusher, presa por teste. Falha responde `kicked: false` e não desfaz
   nada.

Config nova (padrões de dev no compose): `ADMIN_SOCKETS_TOKEN`, `PLAY_URL`, `INTERNAL_PLAY_URL` — **este último é a
porta 3001**, o app de WebSocket do pusher, não a 3000 do HTTP.

Continuam de fora, deliberadamente e por escrito:

- **Reports não notificam ninguém.** Tabela e telas; o `AdminAlerter` é a costura pronta para quando houver dono da
  triagem.
- **Não há como levantar um ban pela aplicação.** SQL direto, documentado no setup — o que "levantar" significa
  continua sem decisão, e um botão decidiria sem querer. **Atenção nos e2e:** com a porta fechada, um ban esquecido
  no banco tranca o usuário de teste de todas as suítes seguintes; os specs limpam com `deleteBansFor` no
  finally/afterEach.

### Fora do F3, em aberto no roadmap

- **F2 (Azure Entra ID)** — o config swap está entregue (ver Next Step); falta a validação em staging com tenant
  real.
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

**F2 (Azure Entra ID) está entregue do lado que dá para entregar sem tenant: o config swap.** Os valores OIDC do
`docker-compose.yaml` deixaram de ser hardcoded — interpolam do `.env` com o mock como padrão, então um clone limpo
continua logando sem configurar nada, e produção troca de provedor preenchendo cinco variáveis. O
[`docs/SETUP-CLOUD-AZURE.pt-BR.md`](docs/SETUP-CLOUD-AZURE.pt-BR.md) tem o passo a passo (scriptado e manual) e o
[`docs/index/setup-entra-id.ps1`](docs/index/setup-entra-id.ps1) provisiona o app registration idempotente.

**O que resta do F2 precisa de um tenant real: a validação em staging** (F2/P0 do spec) — o checklist está na seção
"Verificação" do setup doc. O mapeamento de tags que o spec previa ficou **obsoleto**: o F3 moveu autorização para o
Postgres, então o Entra só fornece identidade. Aposentar o mock (F2/P2) fica deliberadamente para depois — sem ele
não há login offline em dev.

**O caminho de produção está pronto (VPS Hostinger, decidido 2026-08-04):** o
[`contrib/docker/docker-compose.prod.yaml`](contrib/docker/docker-compose.prod.yaml) agora **builda as cinco imagens
do fork** (as do Docker Hub não têm o F4 nem o admin-api), inclui `admin-api` + `admin-api-db` com a cadeia de
healthcheck, e serve o dashboard em `/admin` **no mesmo domínio** — um A record, um certificado, portas 80/443. O
`.env.prod.template` foi atualizado (era o do upstream e nem tinha as variáveis novas), o compose valida com
`docker compose config`, e a imagem de produção do `admin-api` **builda** (verificado). O passo a passo do VPS —
DNS, endurecimento, segredos, Entra, coturn, backups, upgrade, rollback — está em
[`docs/SETUP-DEPLOY.pt-BR.md`](docs/SETUP-DEPLOY.pt-BR.md) (bilíngue). A validação de staging do F2 acontece
naturalmente no primeiro deploy seguindo esse guia.

### Antes de qualquer uso real

O **modelo de ameaças STRIDE** está escrito em [`docs/security/threat-model.pt-BR.md`](docs/security/threat-model.pt-BR.md)
e tem a lista completa. O resumo:

- **F7 — o `ADMIN_API_SESSION_SECRET` ainda é o padrão de desenvolvimento.** Quem o tiver forja sessão para qualquer
  e-mail. `openssl rand -base64 48`. **É o único achado de severidade alta ainda aberto.**
- ~~F1~~ — **fechado.** O `admin` agora só é atribuído por SQL direto; nem o dashboard nem a CLI concedem. A decisão
  #8 do ADR-0004 foi revisada e o teste obrigatório #10 substituído. **Custo consciente: uma concessão legítima de
  `admin` não deixa rastro nenhum**, porque o SQL contorna o log de auditoria.
- **HTTPS e `Secure` no cookie.** Já automáticos quando o `ADMIN_API_PUBLIC_URL` começa com `https://`, mas ninguém
  verificou num deploy de verdade.
- **`ADMIN_API_TRUST_PROXY`** batendo com a topologia: `false` se não houver proxy na frente, ou o limite de taxa do
  login é contornável com `X-Forwarded-For` forjado.

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

10. **O `admin` só se atribui por SQL direto.** O `MemberAdministrationService` recusa, e as duas superfícies passam
    por ele. Fecha o F1 do modelo de ameaças. **Revogar continua permitido** pelas duas, e o bootstrap continua
    concedendo no restart porque escreve pelo repositório — é a recuperação de lockout.

11. **Os schemas `zod` são importados de `@workadventure/messages`, nunca redigitados.** O do `/api/room/access` foi
    movido para lá justamente para isso, e é re-exportado do `AdminApi.ts` — **nenhum import do `play` mudou**.

12. **O `ADMIN_API_TOKEN` não abre `/admin/*`, e o cookie de sessão não abre `/api/*`.** Nos dois sentidos, cada um
    com teste. A barreira do `/admin` **nunca** lê o header `Authorization`; é isso que garante o primeiro sentido.

13. **A tag `admin` é relida do banco a cada requisição, nunca do token.** É o que faz um administrador revogado
    perder acesso no clique seguinte em vez de uma hora depois — e é o que torna a sessão deslizante segura.

14. **O `ADMIN_API_SESSION_SECRET` não é o `ADMIN_API_TOKEN`.** Reaproveitar o segredo do pusher para assinar sessão
    faz um vazamento virar personificação de qualquer administrador.

15. **O cookie de sessão é `SameSite=Lax`, não `Strict`.** Parece o contrário do certo, e não é: navegadores retêm
    cookies `Strict` em requisições que chegam por cadeia de redirect cross-site, que é exatamente a volta do
    provedor de identidade. `Strict` produz um login que parece funcionar e volta ao provedor em laço. A defesa CSRF
    é o token no header, não o atributo do cookie.

16. **`/admin/*` sem configuração responde 503 e o processo sobe assim mesmo.** Fazer o `admin-api` morrer por causa
    do dashboard pendura o `play` — é o item 1 desta lista por outro caminho.

17. **O `GET /api/ban` responde `is_banned` *e* `message`, sempre.** O `AdminBannedData` exige os dois, e o caminho
    de quem **não** está banido é o de todo usuário em toda conexão. Responder só `{is_banned:false}` quebra o parse
    para todo mundo.

18. **O `GET /api/ban` lê o usuário do parâmetro `token`.** O comentário OpenAPI do próprio pusher chama de "o uuid
    do usuário"; o código manda `token`. Ler o nome documentado responde "não banido" para todo mundo, em silêncio.

19. **O `POST /api/ban` e o `POST /api/report` só exigem quem banir/denunciar.** Tudo o mais tem padrão seguro. O
    pusher aguarda essas chamadas antes de agir e engole a falha no Sentry — recusar aqui reproduz exatamente o bug
    que o P3 consertou.

20. **A tabela `ban` não tem coluna de IP, e as tabelas `ban` e `report` não têm chave estrangeira.** O IP é decisão
    #3 do ADR-0005 (LGPD), com teste de integração contra o schema real. A ausência de FK é o que permite banir um
    visitante anônimo e o que impede apagar a conta de levantar o ban.

21. **O `/api/room/sameWorld` responde 502 ou 501 quando não consegue ler as salas — nunca lista vazia.** Lista vazia
    é mentira em formato de sucesso: a mensagem global não chega a ninguém e o administrador vê sucesso.

22. **A porta do ban responde HTTP 200 com `ErrorApiData` — nunca 4xx.** O axios do pusher lança em não-2xx e troca
    a resposta por um "Connection error" genérico: a pessoa banida perderia a mensagem escrita para ela e o log
    culparia conectividade. E **banido ≠ desconhecido** — a invariante #9 continua: desconhecido não-banido entra.

23. **A expulsão é best-effort e nunca falha o ban.** O registro e a porta vêm antes; o kick responde
    `kicked: false` quando não dá. O inverso deixaria um soluço do pusher des-registrar uma moderação.

24. **O `INTERNAL_PLAY_URL` aponta para a porta 3001** — o app de WebSocket do pusher. A 3000 é o HTTP; o
    `/ws/admin/rooms` não existe lá, e o kick degradaria para `false` silenciosamente em todo ban.

25. **O agrupamento do kick usa `roomId.split("/")[5]`, literalmente.** É o filtro do próprio pusher
    (`IoSocketController`), esquisitice inclusa: para `/~/maps/x.wam` cai no nome do arquivo. Há teste fixando isso;
    "consertar" o parsing aqui quebra a entrega do kick sem nenhum erro visível.

### Também não mexer sem conversar

- **`docker-compose.yaml`:** o `play` depende do healthcheck do `admin-api`, que depende do Postgres. Essa cadeia
  existe para evitar a armadilha do item 1 na subida.
- **`play/src/pusher/services/AdminApi.ts`, `play/src/pusher/services/ShortMapDescription.ts`,
  `libs/messages/src/index.ts`, `libs/map-editor/src/types.ts` e `libs/shared-utils/src/SharedAdminApi.ts`:** foram
  tocados **só** para mover schemas para o `@workadventure/messages` e re-exportar de onde estavam. Nenhum import de
  nenhum pacote mudou. O typecheck do `play` tem **436 erros pré-existentes** (matrix-js-sdk, sentry, grpc) — esse é
  o baseline, medido nas duas árvores. O `map-storage` tem **7**, todos de tipagem do `@grpc/grpc-js`. Qualquer
  número diferente disso é regressão.
- **O `auditLog` e o `roomCatalogue` são dependências de topo do `createServer`, não do dashboard.** Os dois ganharam
  um segundo leitor/escritor fora do `/admin/*` no P3 (`POST /api/ban` e `GET /api/room/sameWorld`). Devolvê-los para
  dentro do `adminDashboard` quebra os dois endpoints quando o dashboard está desligado — sem erro visível.
