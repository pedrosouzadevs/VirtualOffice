# HANDOFF

O projeto **ArqueumSpace** — fork do WorkAdventure. Branch **`master`**, tudo mergeado.

Este documento não depende de nada que tenha sido dito em conversa. Tudo o que é preciso para continuar está aqui ou
nos documentos linkados.

---

## Current Status

**O F3 inteiro está entregue (P0–P3), o F2 virou config swap, o projeto foi rebatizado, e existe uma produção rodando
por túnel.** O que resta antes de uso real de verdade não é código de feature — está em
[Antes de qualquer uso real](#antes-de-qualquer-uso-real).

O `play` consome o `admin-api`: tags e `canEdit` vêm do Postgres, não da claim OIDC. O ambiente de desenvolvimento
sobe ligado por padrão (`ADMIN_API_URL` está no `docker-compose.yaml` versionado).

| Fase | Escopo | Estado |
|---|---|---|
| P0 (E1–E6) | 4 endpoints bloqueantes, Postgres, bootstrap idempotente, `play` ligado | ✅ entregue |
| P1 (F0–F3) | `/api/members*`, `/api/*/tags`, CLI de gestão, docs, e2e | ✅ entregue |
| P2 (G0–G4) | Dashboard: barreira de sessão, API, UI Svelte, salas e áreas, auditoria | ✅ entregue |
| P3 (H0–H3) | Moderação: ban, report, `sameWorld`, telas, CLI e docs | ✅ entregue |
| ADR-0006 | Ban emitido pela dashboard, porta no `/api/room/access`, expulsão pelo canal admin | ✅ entregue |
| F2 | Entra ID como troca de configuração; falta só validar em staging | ✅ config entregue |
| Rebrand | `WorkAdventure`/`VirtualOffice` → `ArqueumSpace`; domínios de dev → `arqueum.localhost` | ✅ entregue |
| Deploy | Compose de produção com `admin-api`, guias VPS / Cloudflare / túnel | ✅ entregue |
| ADR-0007 | Editor estrutural (tiles) gated por `adminMap`: overlay no `.wam`, UI de pisos/paredes/borracha, export consolidado | ✅ entregue e validado (e2e 2/2 verde + smoke manual em dev, 2026-08-06); pende só o deploy em produção — ver [Next Step](#next-step) |

**Verificação atual:** 355 testes unitários, 93 de integração (Postgres real), 10 e2e (Playwright, contra a stack
rodando). `typecheck`, `svelte-check`, `eslint` e `prettier` limpos. O `play` mantém seus **436 erros de typecheck
pré-existentes** — esse é o baseline; qualquer número diferente é regressão.

### A produção que existe hoje (piloto por ngrok)

Roda **na máquina do desenvolvedor**, publicada por túnel ngrok com domínio estático. Não é canal 24/7 — é piloto.

| Item | Valor |
|---|---|
| URL | `https://unintrusted-loblolly-londa.ngrok-free.dev` |
| Dashboard | `/admin/` — mesma URL, sufixo `/admin/` (com barra) |
| Mundo | `/` redireciona para `/~/maps/office.wam` |
| Upload de mapas | `/map-storage/` (basic auth) |
| Compose | `contrib/docker/docker-compose.prod.yaml` + `docker-compose.tunnel.yaml` |
| `.env` | `contrib/docker/.env` — **gitignored**, com segredos gerados |
| Login | Azure Entra ID, tenant `7ac12efa-2494-4ee4-88b7-26bfeaa77a48`, app `ArqueumSpace` |
| Admin do bootstrap | `pedro.henrique@arqueum.com` |
| Mapa | `maps/office.wam` + `maps/conference.wam`, já subidos |

Para subir de novo, a partir de `contrib/docker`:

```bash
docker compose -f docker-compose.prod.yaml -f docker-compose.tunnel.yaml --env-file .env up -d
ngrok http --url=unintrusted-loblolly-londa.ngrok-free.dev 80
```

O passo a passo completo (e as letras miúdas do plano gratuito) está em
[`docs/SETUP-TUNNEL.pt-BR.md`](docs/SETUP-TUNNEL.pt-BR.md).

> **Truque útil:** o Traefik roteia por `Host`, então dá para exercitar a produção **sem o túnel**, direto do host:
> `curl -H "Host: unintrusted-loblolly-londa.ngrok-free.dev" http://localhost/...`. Foi assim que o upload dos mapas
> foi feito com o ngrok offline.

### O portão de quem entra

Não há verificação de domínio no nosso código. Quem entra é decidido pelo Entra: o app registration é
**`signInAudience: AzureADMyOrg`** (single-tenant), então só contas do tenant da Arqueum autenticam, e
`DISABLE_ANONYMOUS=true` impede visitante anônimo. **A brecha seria convidar um guest B2B** para o tenant — ele
entraria com e-mail externo.

### Onde a leitura deve começar

Nesta ordem, e não pule o ADR-0002 — ele é o contrato:

1. [`docs/adr/0002-admin-api.pt-BR.md`](docs/adr/0002-admin-api.pt-BR.md) — o contrato verificado no código, as três
   armadilhas, e o que muda ao ligar o serviço
2. [`docs/adr/0003-member-and-tag-management.pt-BR.md`](docs/adr/0003-member-and-tag-management.pt-BR.md) — a P1
3. [`docs/adr/0004-admin-dashboard.pt-BR.md`](docs/adr/0004-admin-dashboard.pt-BR.md) — a P2, com a **revisão da
   decisão #8** no fim dela: o `admin` só se atribui por SQL
4. [`docs/adr/0005-moderation.pt-BR.md`](docs/adr/0005-moderation.pt-BR.md) — a P3, com as **oito correções de
   contrato** e a decisão #2, que diz o que o ban *não* faz
5. [`docs/adr/0007-tile-overlay-map-editing.pt-BR.md`](docs/adr/0007-tile-overlay-map-editing.pt-BR.md) — o editor
   estrutural: overlay vs `.tmj`, `adminMap` sem override, o fluxo de commit manual
6. [`docs/security/threat-model.pt-BR.md`](docs/security/threat-model.pt-BR.md) — o STRIDE e o que continua aberto
7. [`admin-api/AGENTS.md`](admin-api/AGENTS.md) — as convenções do pacote
8. [`docs/SETUP-ADMIN-API.pt-BR.md`](docs/SETUP-ADMIN-API.pt-BR.md) — subir, verificar, gerir permissões, rollback

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

### Rebrand para ArqueumSpace (2026-08-05)

Feito em dois commits, mais um de CI. **"ArqueumSpace" é uma palavra só, de propósito** — um nome com espaço não
caberia em identificador (`ArqueumSpaceComponent`) e deixaria duas grafias para manter em sincronia.

- **1402 ocorrências** de `WorkAdventure`/`VirtualOffice` em 352 arquivos: strings de UI nos dois idiomas, manifest
  PWA, títulos, tela de `BANNED`, todos os ADRs e guias, e identificadores de código.
- **634 domínios** de dev → `arqueum.localhost`, mais os dois arquivos do Synapse cujo nome carrega o homeserver.
- **4 arquivos renomeados em disco** para acompanhar imports que a troca já havia reescrito — foi o que o primeiro
  typecheck pegou (441 contra o baseline 436, três "cannot find module").

**Não foi tocado, e cada item por um motivo:**

| Item | Motivo |
|---|---|
| Escopo npm `@workadventure/*` | Exige ser dono do escopo npm e mata o merge com o upstream. **E:** aquele escopo mistura nossos pacotes com externos que consumimos (`design-system`, `tiled-map-type-guard`, `simple-peer`, `noise-suppression`) — o rename cego apontou 4 dependências para pacotes inexistentes. Revertido depois de provado. |
| Links `workadventu.re` e repo upstream | Renomeados viram 404. |
| `LICENSE.txt` e `NOTICE.txt` | O texto é declaração legal sobre obra de terceiros. |
| Objeto global `WA` da API de scripting | Todo script de mapa depende dele. Só o `short_name` do PWA virou `AS`. |
| 4 imagens `Workadventure.gif`, `icon-workadventure-white.png` | Grafadas com "a" minúsculo. São o logo antigo — trocar o nome do arquivo sem trocar a arte não adianta. **Quando houver arte do ArqueumSpace, arquivo e referência mudam juntos.** |

### Fora do F3, em aberto no roadmap

- **F2 (Azure Entra ID)** — o config swap está entregue; falta a validação em staging com tenant real, que acontece
  naturalmente no primeiro deploy seguindo o guia.
- **`MemberData.name` fica nulo** no fluxo normal — o `/api/room/access` não recebe nome do pusher. Contornável pelo
  `member:set-name`. Decisão registrada no ADR-0003 (#2).
- **Sem `member:delete`** na CLI. Removido por SQL; documentado no setup.
- **Não há "convidar membro" na dashboard.** A tela só concede tag a quem já aparece na lista. Ficou dispensável
  depois que a chegada autenticada passou a criar a linha (invariante #6 refinada, abaixo), mas ainda seria o
  caminho para **preparar acesso antes** da primeira entrada de alguém. Decisão de produto (2026-08-05): não fazer,
  porque todo mundo que pode entrar já tem conta no tenant.
- **Sujeira no banco de dev:** `dev@arqueum.com`, `pedro.henrique@arqueum.com` e `fulano@empresa.com` existem sem
  tags. Inofensivos. **O banco de produção é outro** e nasceu limpo.

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

Custou tempo e o ADR-0004 afirmava o contrário. O `RedirectUris: ["http://*.arqueum.localhost"]` do mock **não
casa hostname com hífen** — `adminapi` passa, `admin-api` e `map-storage` não, qualquer que seja o caminho. Aparece
como `invalid_request / Invalid redirect_uri` na página de erro do próprio provedor, o que parece erro nosso.

O callback do dashboard está registrado explicitamente em `contrib/oidc-server-mock/clients-config.json`. **Mudou o
`ADMIN_API_PUBLIC_URL`? Registre o novo callback lá e recrie o mock.** A correção está anotada no ADR-0004.

### Pré-requisitos que não são óbvios

- **Entrada no hosts** (já adicionada nesta máquina): `127.0.0.1 admin-api.arqueum.localhost`. Navegadores e
  `curl` resolvem `*.localhost` sozinhos; o node não. Sem ela, todo `fetch` do e2e falha com `ENOTFOUND`.
  **Serviço novo = entrada nova no hosts.**
- **`map-storage/tests/assets.zip`** é artefato gerado e não versionado; **nenhum** teste de map_editor roda sem ele.
  O `Compress-Archive` do PowerShell produz zip com `\` que o `unzipper` rejeita — precisa ser zip POSIX (use
  `adm-zip`, que está no `node_modules`).
- **O `play` leva minutos para subir** (só o Vite gasta ~150 s). O 502 do Traefik durante esse período é normal.
- **O `pwsh` não existe num Windows padrão** — é o PowerShell 7, pacote à parte. O
  [`setup-entra-id.ps1`](docs/index/setup-entra-id.ps1) é compatível com o **5.1** de propósito (ASCII puro, sem
  sintaxe de 7), mas precisa ser chamado como
  `powershell -NoProfile -ExecutionPolicy Bypass -File <caminho>` — a política padrão do Windows cliente é
  `Restricted`, e sem `-File` o conteúdo do script pode ser exibido em vez de executado.
- **O `ConvertFrom-Json` do PowerShell 5.1 não desempacota array.** `@($json | ConvertFrom-Json)` sobre um `[]` do
  `az` devolve **um** elemento (o próprio array vazio), não zero — foi o que fez o script dizer "Found existing app
  registration ()" num tenant sem nenhum. Filtrar pelo pipe (`| Where-Object { $_.appId }`) força a enumeração nas
  duas versões. O PowerShell 7 enumera, então isso só quebra no shell padrão do Windows.
- **`Compress-Archive` gera zip com `\` nos caminhos.** Para qualquer coisa que o Linux vá descompactar (upload de
  mapa, por exemplo), use zip POSIX — `docker run --rm -v "...:/m" alpine sh -c "apk add zip && zip -r ..."`.
- **Instalar o Azure CLI não atualiza o PATH da sessão aberta.** Depois do `winget install`, é preciso **abrir um
  terminal novo**; senão o `az` "não existe" mesmo instalado.

### Riscos do produto

- **Ligar o `admin-api` move 40 variáveis de ambiente.** O `/api/map` passa a ser montado do ambiente *dele*, e as
  cópias no `play` deixam de valer para esses campos. O compose interpola os dois do mesmo `.env` da raiz — se
  divergirem, o sintoma é "o chat sumiu", não um erro.
- **Quem tinha tag só pela claim OIDC perde o acesso** ao ligar. É para isso que existe o bootstrap.
- **Rollback é imediato:** esvaziar `ADMIN_API_URL` no `.env` e recriar o `play`. Nada se perde.

---

## Next Step

O piloto está **no ar e funcionando**. O que vem agora é escolha de rumo, não trabalho pendente de código.

**1. Promover o piloto para algo permanente.** O túnel gratuito não é canal 24/7: tem página interstitial, franquia
de banda (~1 GB/mês, e um escritório virtual é WebSocket o dia inteiro), sem UDP para TURN, e depende da máquina do
desenvolvedor ficar ligada. Os dois caminhos, ambos com guia pronto:

- **VPS** (decidido 2026-08-04: Hostinger, 4 vCPU/16 GB) — [`docs/SETUP-DEPLOY.pt-BR.md`](docs/SETUP-DEPLOY.pt-BR.md).
  O mesmo `.env` acompanha; muda o `DOMAIN` e a história de certificados.
- **Domínio próprio + Cloudflare** (~R$40/ano) — [`docs/SETUP-CLOUDFLARE.pt-BR.md`](docs/SETUP-CLOUDFLARE.pt-BR.md),
  com os quatro ajustes obrigatórios (SSL Full strict, DNS-01, TURN em nuvem cinza, IPs reais).

**2. TURN (coturn), quando alguém estiver em rede corporativa.** Nenhum túnel carrega UDP, então hoje o vídeo é 100%
P2P. Em rede restritiva ele falha. A seção 8 do guia de deploy tem a configuração com static secret.

**3. Recortar o mapa.** O `office.tmj` tem 405 KB para 1.394 tiles desenhados, porque é declarado 144×128 e o desenho
ocupa 31×21 — 3,5%. Recortar no Tiled corta ~96%. Fica no Tiled de propósito: recortar desloca coordenadas, e a
camada de objetos tem spawn, as duas zonas Jitsi, a zona silenciosa e as duas saídas. **Atenção pós-ADR-0007:** o
canvas vazio agora é espaço útil do editor estrutural — recortar também exigiria transpor o overlay de tiles;
consolide e limpe o overlay antes de qualquer recorte.

**4. Arte do ArqueumSpace.** Quatro imagens do logo antigo continuam no repositório (ver seção do rebrand).

**5. Levar o editor estrutural à produção (a única pendência real da feature).** O e2e
[`tile_editor.spec.ts`](tests/tests/map_editor/tile_editor.spec.ts) passou 2/2 e o smoke manual em dev validou
piso, parede com colisão, borracha e persistência (2026-08-06). **A produção está DERRUBADA agora** (desceu para a
janela de teste dev) e as imagens buildadas hoje **NÃO contêm o fix do import do Phaser** — o build foi antes dele.
O playbook da troca, nesta ordem, a partir da raiz e de `contrib/docker`:

```bash
docker compose down                                                                   # derruba o dev (raiz)
docker compose -f docker-compose.prod.yaml --env-file .env build play                 # rebuild SÓ o play (fix)
docker compose -f docker-compose.prod.yaml -f docker-compose.tunnel.yaml --env-file .env up -d
ngrok http --url=unintrusted-loblolly-londa.ngrok-free.dev 80
docker compose -f docker-compose.prod.yaml --env-file .env exec admin-api npm run member:grant -- pedro.henrique@arqueum.com adminMap
```

Depois do grant, **logout/login** no mundo (tags valem por sessão de login, não por reconexão — regra descoberta
no smoke e documentada no guia). Sobrou opcional: o spike S0 de performance (2k tiles batched, critério <100 ms)
nunca foi medido formalmente — o uso real com dezenas de células não mostrou hitch perceptível. Guia de operação:
[`docs/MAP-STRUCTURAL-EDITING.pt-BR.md`](docs/MAP-STRUCTURAL-EDITING.pt-BR.md).

Três armadilhas operacionais descobertas em 2026-08-06, para não redescobrir:

- **Tags grudam na sessão de login.** Conceder/revogar qualquer tag (inclusive `adminMap`) só surte efeito após
  logout/login; F5 não basta. O e2e deleta o storage state do Playwright entre fases por isso.
- **O Vite do container dev não enxerga edições feitas no Windows** (bind mount não propaga watch): mudou código
  do `play` em dev, `docker compose restart play` — senão ele serve o transform velho e o bug "não existe".
- **O Docker Desktop caiu sob a carga de duas stacks + builds + e2e.** Se o diálogo de erro dele aparecer:
  Restart/reabrir, ou reiniciar o Windows. **Nunca "Reset to factory defaults"** — apaga os volumes, e o banco da
  produção do piloto (membros/tags/bans) vive num volume.

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

26. **O `PUSHER_URL` não pode terminar com barra.** O `play` monta o callback OIDC concatenando
    `PUSHER_URL + "/openid-callback"`; uma barra final produz `//openid-callback`, que o Entra recusa com
    `AADSTS50011`. O compose de produção do upstream vinha com a barra — corrigido, mas é o tipo de coisa que volta
    num merge com o upstream.

27. **A chegada autenticada cria a linha de membro; a anônima não.** Refinamento da invariante #6 do ADR-0002
    (2026-08-05): quem entra pelo provedor de identidade e ainda não tem linha ganha uma, **sem tag nenhuma** — é
    registro de chegada, não permissão. O sinal é o `accessToken`, presente só quando houve login OIDC; visitante
    anônimo é identificado por uuid e criar linhas para ele encheria a tabela de entradas inúteis. A escrita só
    acontece quando não existe linha, então uma reconexão nunca sobrescreve tag ou nome concedido.

28. **Comandos de tile só passam com a tag `adminMap` — `admin` e `editor` não têm override.** Decisão de produto
    do ADR-0007, checada autoritativamente no map-storage por `canEditTiles` (o predicado único em
    `libs/map-editor/src/Utils.ts`), com throw ANTES do enfileiramento — nunca o padrão Sentry-e-break do
    `EntityPermissions`, que ecoa comando recusado como sucesso. O e2e pina que usuário `admin` não vê a ferramenta.

29. **O overlay de tiles guarda gid cru (flip flags inclusas) e `0` é apagamento explícito.** Chave ausente =
    sem override; `0` = célula apagada que sobrevive à consolidação. As chaves de camada são os nomes ACHATADOS
    (`walls/walls1`). Mascarar gids na escrita ou tratar `0` como ausência corrompe o export consolidado.

30. **Limpar o overlay descarrega o WAM para o storage ANTES do `uploadDetector.refresh`.** O refresh faz os
    backs chamarem `clearAfterUpload`, que descarta a cópia em memória SEM salvar — sem o
    `flushMapToStorage`, um clear mais novo que o autosave de 15s ressuscita do arquivo velho.

31. **O export consolidado (`<wam>?consolidated-tmj`) é público e pendurado na URL do próprio wam.** É o único
    endereço válido em toda topologia de deploy, e o overlay já é transmitido a todo cliente conectado — mover
    para rota autenticada quebraria o botão de download sem ganhar sigilo nenhum.

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
