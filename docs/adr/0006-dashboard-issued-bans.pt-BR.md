# ADR-0006: Bans emitidos pela dashboard

- **Status:** Aceito
- **Data:** 2026-08-04
- **Decisores:** Equipe ArqueumSpace
- **Idiomas:** este arquivo (pt-BR) + [0006-dashboard-issued-bans.md](0006-dashboard-issued-bans.md) (en-US), em lockstep
- **Origem:** o H3 do [ADR-0005](0005-moderation.pt-BR.md) entregou a moderação como telas de leitura e descobriu que
  o `play` não tem botão de banir. Este ADR responde a pergunta que essa descoberta abriu. Ele **revisa** a decisão
  #2 do ADR-0005 e a regra de leitura do H3; ambas apontam para cá.

## Contexto

O P3 consertou o encanamento do ban: o `POST /api/ban` registra, a expulsão voltou a funcionar, o `GET /api/ban`
responde. Aí o teste ponta a ponta expôs o que o ADR tinha assumido sem verificar: **nenhuma UI do `play` emite
ban.** O `#kickoff-user` do menu da caixa de vídeo tira a pessoa da *reunião*, e o `ActionMediaBox.svelte` tem um
`ban()` comentado com `TODO: implement ban user`. O único remetente de `banPlayerMessage` é o evento `banUser` da
API de scripting.

Era preciso decidir: construir o botão que falta no `play`, ou fazer da dashboard — que já lista os bans — a
superfície que os emite. **A decisão de produto (2026-08-04) é a dashboard.** Uma superfície de moderação só, ao
lado da evidência sobre a qual age, atrás da barreira de sessão que já relê o `admin` a cada requisição.

Dois fatos de código tornam isso barato, e os dois foram verificados em vez de assumidos:

1. **O pusher rejeita a conexão cuja resposta do `/api/room/access` não seja `status: "ok"`.** O
   `IoSocketController` recusa o upgrade do WebSocket com o payload de erro, e o `AuthenticateController` expõe a
   mesma resposta no login. O schema da resposta é uma união com `ErrorApiData` — que já importamos. Responder a
   variante de erro para um identificador banido fecha a porta **pelo nosso próprio endpoint, sem mudar o `play`**.
2. **O pusher já tem um canal de expulsão para administrações: o WebSocket `/ws/admin/rooms`.** O ramo
   `user-message`/`banned` dele chama exatamente o `emitBan` que o conserto do P3 reativou. Ele só é montado quando
   o `ADMIN_SOCKETS_TOKEN` está setado — o que nada nunca setou, então estava dormente. O JWT que ele exige é
   assinado por HMAC com esse mesmo token, e o `admin-api` já depende do `jose`.

## Decisão 1 — A dashboard é a superfície que emite bans

`POST /admin/api/bans` — sessão + CSRF, como toda mutação da dashboard. Escreve pelo mesmo serviço `banIdentifier`
que o `POST /api/ban` do pusher usa, então as duas superfícies não conseguem discordar do que banir significa, e a
entrada de auditoria nomeia o **administrador logado** — atribuição melhor que a do caminho do pusher, cujo ator é o
que o `byUserUuid` disser.

O `ban()` comentado do `play` continua comentado. O evento `banUser` da API de scripting continua: é superfície
genérica do próprio `play`, e o teste ponta a ponta do P3 o exercita.

**Levantar um ban continua SQL direto.** Emitir é uma ação de moderação com significado claro; levantar ainda não
tem (o que acontece com o registro? com a trilha de auditoria?), e o raciocínio do P3 se mantém: um botão decidiria
isso sem querer.

## Decisão 2 — A porta fecha no `/api/room/access` (revisa a #2 do ADR-0005)

Um identificador banido pedindo acesso à sala recebe **HTTP 200 com `ErrorApiData`** — `type: "error"`, código
`USER_BANNED`, a mensagem gravada do ban como texto. O pusher recusa a conexão e o login; o front mostra a tela de
erro. Um ban, portanto, **sobrevive à reconexão** — que era exatamente o que a decisão #2 do ADR-0005 dizia, com
todas as letras, que ele não fazia.

O que a #2 de fato adiou foi "o pusher precisa chamar o `verifyBanUser` na conexão", uma mudança no `play`. Isto é a
mesma aplicação sem essa mudança: a verificação vive dentro do endpoint que o pusher já chama em toda conexão. O
`verifyBanUser` segue sem chamador e o `GET /api/ban` segue respondível (a armadilha da correção #7 do ADR-0005
continua guardada).

Três bordas que são o contrato, não detalhes:

- **200, nunca 4xx.** O axios do pusher lança em qualquer não-2xx e substitui por um "Connection error" genérico —
  a pessoa banida perderia a mensagem que um administrador escreveu para ela, e o log culparia conectividade.
- **Banido ≠ desconhecido.** A invariante #9 do ADR-0002 — membro desconhecido entra com `tags: []`, nunca erro —
  fica intacta. A consulta de ban é um ramo separado e explícito.
- **A decisão do IP não é reaberta.** A porta lê só o identificador; o `ipAddress` continua aceito-e-descartado
  (ADR-0005 #3).

## Decisão 3 — A expulsão vai pelo canal admin do próprio pusher, best-effort

Num ban da dashboard, o `admin-api` conecta em `ws://play:3000/ws/admin/rooms`, apresenta um JWT HS256 de vida curta
assinado com o `ADMIN_SOCKETS_TOKEN` compartilhado, e envia o evento `user-message`/`banned` para as salas do mundo.
O pusher executa o `emitBan` — a mesma expulsão de um ban de dentro do mundo. Setar o `ADMIN_SOCKETS_TOKEN` (nunca
setado até agora) é o que liga o canal, para os dois lados de uma vez, do mesmo `.env` da raiz.

**Best-effort, por contrato.** O ban é o registro mais a porta fechada; a expulsão é a cortesia de não esperar a
próxima reconexão da vítima. Uma falha na expulsão — canal não configurado, pusher reiniciando — responde
`kicked: false` à dashboard e não falha nada. O inverso deixaria um soluço do pusher des-registrar um ban.

Uma esquisitice do pusher é deliberadamente honrada em vez de "consertada": o canal filtra salas pelo **sexto
segmento da URL da sala** (`roomId.split("/")[5] === world`). O `admin-api` agrupa as salas do catálogo pela mesma
expressão e envia uma mensagem por grupo. É o contrato do pusher; re-derivar isso em outro lugar seria redigitar
contrato à mão.

## Alternativas consideradas

### A. Implementar o botão de ban no `play` (`ActionMediaBox.ban()`)
- **Prós:** moderação onde o administrador já está; o TODO do próprio upstream.
- **Contras:** uma segunda superfície emissora com atribuição mais fraca; toca o `play`; a dashboard continuaria
  precisando da listagem de qualquer jeito.
- **Rejeitada** por decisão de produto: uma superfície, a dashboard.

### B. Ligar o `verifyBanUser` no fluxo de conexão do pusher
- **Prós:** o conserto no formato do upstream; torna o `GET /api/ban` portador de carga.
- **Contras:** mudança no `play`, no caminho quente de conexão, para obter uma aplicação que a porta já fornece do
  nosso lado do contrato.
- **Rejeitada** como redundante aqui; continua sendo o movimento certo se o upstream um dia ligar por conta.

### C. Ban da dashboard só-registro (sem expulsão, sem porta)
- **Rejeitada** sem muita cerimônia: um ban que nem remove nem barra é mentira em formato de sucesso — a mesma
  classe de falha que o ADR-0005 existe para remover.

### D. Um endpoint HTTP novo de expulsão no pusher
- **Rejeitada:** superfície nova que o upstream não tem, quando um canal dormente e feito para isso já existe.

## Consequências

### Positivas
- Um ban agora significa o que todo mundo assumia no ADR-0005: sai agora, e fica fora. O desconforto da decisão #2
  se aposenta.
- Bans são emitidos ao lado da evidência, com atribuição verdadeira de ator, atrás da barreira mais forte do
  sistema.
- Nenhum código do `play` mudou. A feature inteira é `admin-api` + configuração.

### Negativas
- O `ADMIN_SOCKETS_TOKEN` vira segredo vivo: quem o tiver expulsa qualquer um (não bane — o registro exige a
  dashboard). O modelo de ameaças o ganha como ativo.
- A expulsão acopla o `admin-api` a uma esquisitice de parsing de URL do pusher (`split("/")[5]`), presa por teste.
- Testes ponta a ponta que banem precisam limpar a linha, ou a porta recusa o usuário compartilhado de teste em
  toda suíte seguinte.

### Neutras
- A aba de moderação da dashboard deixa de ser só-leitura para bans. Denúncias continuam sendo, por inteiro.
- A nota da UI "um ban não sobrevive à reconexão" fica errada e é trocada pela afirmação oposta.

## Testes obrigatórios

1. O `POST /admin/api/bans` exige sessão e CSRF; o `ADMIN_API_TOKEN` do pusher não o abre.
2. Um ban da dashboard escreve a entrada de auditoria nomeando o administrador **logado**.
3. Um identificador banido recebe `ErrorApiData` do `/api/room/access` — **HTTP 200**, validando contra a
   mesmíssima união `isFetchMemberDataByUuidResponse` que o pusher parseia, carregando a mensagem gravada.
4. Um identificador desconhecido e não banido continua entrando com `tags: []` — a invariante #9 sobrevive à porta.
5. O ban é normalizado: banir `Trouble@Example.COM` fecha a porta para `trouble@example.com`.
6. Uma falha de expulsão (ou canal não configurado) responde `kicked: false` e o ban vale mesmo assim.
7. A mensagem de expulsão agrupa salas exatamente por `roomUrl.split("/")[5]` e assina com o `ADMIN_SOCKETS_TOKEN`.
8. Ponta a ponta: um administrador bane pela dashboard; a vítima no mundo cai na tela de erro, e um reload a mantém
   fora. O teste apaga suas linhas de ban ao final.

## Referências

- [ADR-0005 — moderação](0005-moderation.pt-BR.md) — a fase cujo laço isto fecha; as notas de revisão apontam para cá
- [ADR-0004 — o dashboard](0004-admin-dashboard.pt-BR.md) — a barreira de sessão e o CSRF reaproveitados
- [`play/src/pusher/controllers/IoSocketController.ts`](../../play/src/pusher/controllers/IoSocketController.ts) —
  a recusa de conexão e o canal `/ws/admin/rooms`, ambos verificados no código
- [Modelo de ameaças](../security/threat-model.pt-BR.md) — o `ADMIN_SOCKETS_TOKEN` como ativo novo
