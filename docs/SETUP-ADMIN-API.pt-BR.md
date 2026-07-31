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
