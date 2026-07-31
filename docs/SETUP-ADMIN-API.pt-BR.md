# Setup — `admin-api`

**TL;DR.** O `admin-api` é o serviço do VirtualOffice que decide quem entra no mundo, com quais tags, e quem pode
editar o mapa. Com o `ADMIN_API_URL` definido, o `play` deixa de usar o stub `LocalAdmin` embutido e passa a perguntar
para nós. Um `docker compose up -d` já sobe tudo ligado; este documento cobre como verificar, como conceder permissões
e como voltar atrás.

**Público.** Quem roda o VirtualOffice localmente, e quem for operá-lo depois.

**Idiomas.** Este arquivo (pt-BR) + [SETUP-ADMIN-API.md](SETUP-ADMIN-API.md) (en-US), em lockstep.

**Desenho.** [ADR-0002](adr/0002-admin-api.pt-BR.md).

---

## Pré-requisitos

- Docker e Docker Compose.
- Um `.env` na raiz do repositório: `cp .env.template .env`. Os valores padrão já apontam o `play` para o `admin-api`.
- **No Windows**, uma linha no `C:\Windows\System32\drivers\etc\hosts` (exige privilégio de administrador), junto das
  entradas que os outros serviços já têm:

  ```
  127.0.0.1 admin-api.workadventure.localhost
  ```

  Navegadores e o `curl` resolvem `*.localhost` por conta própria, então a aplicação funciona sem ela. O Node não
  resolve, então a suíte de ponta a ponta e qualquer script que use `fetch` falham com `ENOTFOUND` até a linha
  existir. Resolvedores Linux tratam `*.localhost` nativamente, e por isso a CI não precisa de nada.

## O que é provisionado

| Serviço | Papel |
|---|---|
| `admin-api` | API HTTP que o pusher chama. Porta 3000 dentro da rede, `http://admin-api.workadventure.localhost` pelo navegador. |
| `admin-api-db` | PostgreSQL 17 próprio. Não compartilhado com nenhum outro serviço: este detém identidade e autorização. |

Os dados ficam no volume nomeado `admin-api-db-data`, então `docker compose down` preserva membros e tags. Só o
`docker compose down -v` descarta.

## Subindo

```bash
docker compose up -d play
```

O `play` espera o `admin-api` ficar saudável antes de iniciar, e o `admin-api` espera o Postgres. Essa ordem não é
enfeite — veja *Solução de problemas*.

Na primeira subida o `admin-api` aplica as migrations e roda um **bootstrap idempotente**: cria as tags `admin` e
`editor` e concede `admin` para o `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL`. Rodar de novo não muda nada, e é por isso que ele
pode rodar em todo boot em vez de ser um script que alguém precisa lembrar de executar.

## Verificação

Vivacidade, e prontidão (que consulta o Postgres de verdade):

```bash
curl -s http://admin-api.workadventure.localhost/readyz
```

Negociação de capabilities. Este endpoint é público de propósito — o pusher o chama sem header `Authorization`:

```bash
curl -s http://admin-api.workadventure.localhost/api/capabilities
```

Todo o resto exige o token, então isto **tem** que responder `403`:

```bash
curl -i -s http://admin-api.workadventure.localhost/api/room/access | head -1
```

Confirme que o pusher conectou. Você procura por `Remote admin api connection successful`:

```bash
docker compose logs play | grep -a "admin api"
```

Depois abra `http://play.workadventure.localhost`, entre com `User1` / `pwd` e verifique se **Map editor** aparece no
menu do mapa.

> Não existe página em `/`. O `admin-api` serve apenas `/api/*`, `/healthz` e `/readyz`, então um `404` com
> `ADMIN_API_NOT_FOUND` ali está correto. E `http://admin-api:3000` é nome da rede Docker — alcançável de outros
> containers, nunca do seu navegador.

## Gerenciando permissões

Enquanto o dashboard não chega (ADR-0002, P2), as permissões são geridas por uma CLI que roda dentro do container.
Ela usa as credenciais de banco do próprio serviço e não acrescenta superfície de rede — é justamente por isso que é
CLI e não endpoint HTTP (ADR-0003, decisão #3).

Duas tags já vêm prontas: `admin` e `editor`. Qualquer uma libera o editor de mapa, e só em salas `/~/` — mapas
externos `/_/` nunca são editáveis.

Ver quem tem o quê:

```bash
docker compose exec admin-api npm run member:list
```

Conceder uma tag. Idempotente — rodar duas vezes não é erro:

```bash
docker compose exec admin-api npm run member:grant -- alguem@exemplo.com editor
```

Revogar:

```bash
docker compose exec admin-api npm run member:revoke -- alguem@exemplo.com editor
```

Definir o nome que o seletor de membros do editor mostra no lugar do e-mail cru:

```bash
docker compose exec admin-api npm run member:set-name -- alguem@exemplo.com "Fulano de Tal"
```

Listar o catálogo de tags:

```bash
docker compose exec admin-api npm run tag:list
```

A mudança vale no **próximo login** da pessoa: o `canEdit` é resolvido quando ela entra na sala, não continuamente.

Três comportamentos que vale conhecer:

- **E-mails são gravados e comparados em minúsculo**, então `Alguem@Exemplo.com` e `alguem@exemplo.com` são a mesma
  pessoa.
- **O `member:grant` cria a tag se ela não existir**, porque os seletores do editor de mapa aceitam texto livre e uma
  tag arbitrária é coisa legítima para restringir uma área. Ele imprime um aviso listando as tags que já existiam,
  então um typo como `editr` é pego no prompt e não no login de alguém dias depois.
- **O `member:set-name` recusa membro inexistente** em vez de criar um — um typo ali produziria uma conta em que
  ninguém nunca loga. Conceda uma tag antes, ou deixe a pessoa logar uma vez.

Não existe `member:delete`. Remover membro é destrutivo e raro o bastante para merecer ser feito deliberadamente em
SQL:

```bash
docker compose exec -T admin-api-db psql -U admin_api -d admin_api -c "DELETE FROM member WHERE email=lower('alguem@exemplo.com');"
```

### Qual e-mail?

O que o provedor de identidade coloca no token — é o que o pusher nos envia. Com o mock OIDC de desenvolvimento:

| Login | Senha | E-mail |
|---|---|---|
| `User1` | `pwd` | `john.doe@example.com` |
| `User2` | `pwd` | `alice.doe@example.com` |

O `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL` tem `john.doe@example.com` como padrão exatamente por isso: um clone novo já vem
com administrador funcionando, sem ninguém editar arquivo.

## Dashboard de administração (ADR-0004)

Abra `http://admin-api.workadventure.localhost/admin/`, entre pelo provedor de identidade, e gerencie membros pela
tela. O que segue documenta como está ligado.

| Rota | Método | Quem |
|---|---|---|
| `/admin/login` | GET | qualquer um (com limite de taxa) |
| `/admin/callback` | GET | o provedor de identidade |
| `/admin/logout` | POST | qualquer um; exige o token CSRF quando há sessão |
| `/admin/me` | GET | um administrador |
| todo o resto sob `/admin` | — | um administrador |

### Configuração

Quatro variáveis, todas com padrão funcional de desenvolvimento no `docker-compose.yaml`:

| Variável | Padrão | Observação |
|---|---|---|
| `ADMIN_API_PUBLIC_URL` | `http://admin-api.workadventure.localhost` | O endereço que o **navegador** usa. Vazio desliga o dashboard. |
| `ADMIN_API_SESSION_SECRET` | um valor só de desenvolvimento | No mínimo 32 caracteres. **Troque fora do ambiente local.** |
| `ADMIN_API_TRUST_PROXY` | `1` | Use `false` se o `admin-api` for exposto sem proxy na frente. |
| `OPENID_CLIENT_ID` / `_SECRET` / `_ISSUER` | o client do mock | O mesmo provedor que o `play` usa. |

O segredo de sessão deliberadamente **não** é o `ADMIN_API_TOKEN`. Aquele é compartilhado com o pusher, e um segredo
que ao mesmo tempo serve máquinas e emite sessões de gente transforma um único vazamento em personificação completa.

Faltando qualquer parte, o `/admin/*` responde `503 ADMIN_DASHBOARD_DISABLED` e o log de inicialização diz o que
está ausente. O serviço sobe do mesmo jeito e o `/api/*` fica intacto — configuração errada do dashboard nunca pode
virar indisponibilidade do `play`.

### A tela (G2)

Svelte 5 + Vite em [`admin-api/src-ui/`](../admin-api/src-ui), construída em `dist-ui` e servida pelo mesmo serviço
sob `/admin/` — uma unidade de deploy, uma origem, nenhum CORS. Segue o [`map-storage/src-ui`](../map-storage/src-ui),
o precedente que o ADR-0004 nomeia.

```bash
# Construir uma vez
docker compose exec admin-api npm run ui:build

# Typecheck da metade Svelte (a metade node é o `npm run typecheck`)
docker compose exec admin-api npm run ui:check
```

Em desenvolvimento o `npm run start:dev` já roda `vite build --watch` junto da API, então um arquivo salvo é
reconstruído e um refresh mostra. **Sem `--kill-others-on-fail`**: um build de UI quebrado nunca pode derrubar a API
junto. As imagens de produção constroem a UI no `Dockerfile`, então um front quebrado falha o build da imagem, e não
a subida do container.

O `dist-ui` é gerado e está no gitignore. Sem ele, o serviço roda exatamente como rodava antes de a tela existir — o
`/admin/` responde 404 em JSON e o resto fica igual.

A interface está em **en-US e pt-BR**, escolhida pelo idioma do navegador. As strings vivem em
[`src-ui/lib/i18n.ts`](../admin-api/src-ui/lib/i18n.ts); o tipo é derivado do catálogo em inglês, então uma chave
adicionada em um idioma quebra o build até o outro tê-la.

### Verificação

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://admin-api.workadventure.localhost/admin/me
```

Espere `302` para `/admin/login?returnTo=%2Fadmin%2Fme`. Depois abra
`http://admin-api.workadventure.localhost/admin/` no navegador e entre como `User1` / `pwd`. Você deve cair na lista
de membros, com a sua própria linha mostrando a tag `admin`.

Duas propriedades que valem conferir na mão, porque são o objetivo desta fatia:

```bash
# O token do pusher não abre o dashboard: continua redirecionando para o login.
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: $ADMIN_API_TOKEN" \
  http://admin-api.workadventure.localhost/admin/me

# Um administrador revogado é recusado na requisição seguinte, com o mesmo cookie.
docker compose exec admin-api npm run member:revoke -- john.doe@example.com admin
# recarregue /admin/me no navegador -> 403 ADMIN_FORBIDDEN
docker compose exec admin-api npm run member:grant  -- john.doe@example.com admin
# recarregue de novo -> 200
```

### Endpoints de gestão (G1)

Atrás da barreira, então toda chamada precisa do cookie de sessão, e toda mutação precisa também do token CSRF — o do
cookie `admin_csrf`, enviado no header `X-CSRF-Token`.

| Endpoint | Método | Responde |
|---|---|---|
| `/admin/api/members` | GET | todo membro com suas tags; `?search=` filtra, tags incluídas |
| `/admin/api/members/{email}` | GET | um membro |
| `/admin/api/members/{email}` | PATCH | `{ "username": "…" \| null }` — define ou limpa o nome de exibição |
| `/admin/api/members/{email}/tags` | POST | `{ "tag": "…" }` — concede; responde `{ member, createdTag }` |
| `/admin/api/members/{email}/tags/{tag}` | DELETE | revoga; responde `{ member, wasHeld }` |
| `/admin/api/tags` | GET | o catálogo de tags |

Três comportamentos são deliberados e compartilhados com a CLI, porque os dois chamam o mesmo serviço de Application:

- **Conceder cria o que falta.** Um membro que nunca entrou é criado, e uma tag que ninguém usou também. Preparar
  acesso antes do primeiro login é justamente o objetivo.
- **`createdTag: true` é um aviso, não um detalhe de sucesso.** Tags são texto livre e sensíveis a maiúsculas, então
  `Admin` é um rótulo novo em folha que não concede nada. Essa flag é como o erro aparece no clique.
- **Revogar uma tag que o membro nunca teve dá certo**, com `wasHeld: false`. *Membro* desconhecido ou *tag*
  desconhecida são 404, e os dois são reportados separadamente.

Pelo console do navegador em `/admin/`, que é também como as telas do G2 vão chamar:

```js
const csrf = document.cookie.split('; ').find(c => c.startsWith('admin_csrf='))?.split('=')[1];
await fetch('/admin/api/members/someone@example.com/tags', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
  body: JSON.stringify({ tag: 'editor' }),
}).then(r => r.json());
```

### Ficou trancado do lado de fora?

Remover a própria tag `admin` é permitido, inclusive sendo o último administrador. O bootstrap roda em **toda**
inicialização, então reiniciar restaura o `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL`:

```bash
docker compose restart admin-api
```

## Voltando atrás

Esvazie o `ADMIN_API_URL` no seu `.env` e recrie o `play`. O pusher volta ao `LocalAdmin` na hora:

```bash
docker compose up -d --force-recreate play
```

Nada se perde — membros e tags continuam no Postgres, ociosos, até você religar.

## O que muda quando é ligado

Esta é a parte que costuma surpreender.

- **As tags do OIDC deixam de valer.** O pusher não repassa a claim para nós. Quem tinha `admin` ou `editor` só pelo
  OIDC e não tem registro de membro perde o acesso ao editor até receber a tag.
- **`MAP_EDITOR_ALLOW_ALL_USERS` e `MAP_EDITOR_ALLOWED_USERS` saem de cena.** A autorização passa a ser trabalho do
  banco, de propósito: uma permissão precisa ser concedível por tela, não por variável de ambiente.
- **Mais ~28 variáveis de ambiente mudam de dono.** O `/api/map` é montado a partir do **nosso** ambiente, então
  `ENABLE_CHAT*`, `START_ROOM_URL`, `DISABLE_ANONYMOUS`, `SKIP_CAMERA_PAGE` e companhia passam a ser lidas pelo
  `admin-api`, e as cópias do `play` deixam de valer para esses campos. O compose interpola os dois serviços do mesmo
  `.env` da raiz para que não divirjam.

## Solução de problemas

**`invalid_request / Invalid redirect_uri` na página de erro do provedor ao entrar no dashboard.** Parece configuração
errada nossa e não é. O wildcard do mock de desenvolvimento, `http://*.workadventure.localhost`, **não casa com hífen
no hostname** — `adminapi` é aceito, `admin-api` e `map-storage` não, qualquer que seja o caminho. É por isso que
`http://admin-api.workadventure.localhost/admin/callback` está registrado explicitamente em
[`contrib/oidc-server-mock/clients-config.json`](../contrib/oidc-server-mock/clients-config.json). Se você mudar o
`ADMIN_API_PUBLIC_URL`, acrescente o novo callback lá e recrie o mock:

```bash
docker compose up -d --force-recreate oidc-server-mock
```

**`503 ADMIN_DASHBOARD_DISABLED` em toda rota `/admin`.** Falta configuração, ou ela está incompleta. O log de
inicialização diz qual:

```bash
docker compose logs admin-api | grep "dashboard is disabled"
```

**502 Bad Gateway logo após subir.** Quase sempre ainda é boot: o `play` leva minutos (só o Vite pode gastar 150 s) e
o Traefik fica sem upstream até o pusher escutar. Acompanhe `docker compose logs -f play` esperando por
`WorkAdventure Pusher web-server started`.

**502 que não passa.** Verifique se o pusher chegou a terminar de subir:

```bash
docker compose logs play | grep -a "web-server started"
```

Se essa linha não aparece mas `Admin api is enabled at ...` aparece, o pusher travou negociando capabilities. O
`AdminApi.initialise()` faz retry **sem limite** e o `play` o aguarda *antes* de abrir a porta, então qualquer erro
persistente ali — 404, 403, conexão recusada — pendura o `play` em silêncio. Confirme que o `admin-api` responde:

```bash
docker compose exec play node -e "fetch('http://admin-api:3000/api/capabilities').then(async r=>console.log(r.status, await r.text()))"
```

**Logado, mas sem editor de mapa.** O e-mail do seu token não tem registro com `admin`/`editor`. Liste os membros
(acima) e compare com o e-mail que seu provedor emite. Lembre que a mudança só vale depois de um login novo.

**Avatares em branco.** Significa que o `characterTextures` voltou vazio. Veja o que o endpoint devolve para os ids
que o front manda:

```bash
docker compose exec play node -e "const a=require('/usr/src/app/node_modules/axios'); a.get('http://admin-api:3000/api/room/access',{params:{userIdentifier:'john.doe@example.com',playUri:'http://play.workadventure.localhost/~/maps/areas.wam',characterTextureIds:['male1','body1']},headers:{Authorization:process.env.ADMIN_API_TOKEN}}).then(r=>console.log(JSON.stringify(r.data.characterTextures)))"
```

**Migrations falharam no boot.** O `admin-api` se recusa a servir em vez de responder sobre um schema não migrado,
já que erros aqui alimentam o laço de retry do pusher. Leia o motivo:

```bash
docker compose logs admin-api | grep -iA5 "failed to start"
```

## Rodando os testes

Testes de unidade e de contrato não precisam de infraestrutura:

```bash
docker compose run --rm admin-api npm test -- --run
```

Os de integração precisam do Postgres. Eles criam o próprio banco `*_test` em vez de tocar nos seus dados:

```bash
docker compose run --rm admin-api npm run test:integration -- --run
```

Ponta a ponta. O Playwright roda do host, contra a stack no ar — veja [`tests/AGENTS.md`](../tests/AGENTS.md) para o
`npx playwright install --with-deps` que se faz uma vez:

```bash
cd tests && npm run test -- tests/admin_api.spec.ts --project=chromium
```

## Referências

- [ADR-0002 — Admin API própria](adr/0002-admin-api.pt-BR.md)
- [`admin-api/AGENTS.md`](../admin-api/AGENTS.md) — convenções para trabalhar dentro do serviço
- [`play/src/pusher/services/LocalAdmin.ts`](../play/src/pusher/services/LocalAdmin.ts) — o comportamento que o `admin-api` substitui
