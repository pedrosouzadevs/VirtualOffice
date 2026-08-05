# ADR-0005: Moderação (Admin API, P3)

- **Status:** Aceito
- **Data:** 2026-08-04
- **Decisores:** Equipe ArqueumSpace
- **Idiomas:** este arquivo (pt-BR) + [0005-moderation.md](0005-moderation.md) (en-US), em lockstep
- **Origem:** [ADR-0002](0002-admin-api.pt-BR.md), fase P3. Última fase do F3 antes do F2.

## Contexto

P0, P1 e P2 estão entregues. A tabela de fases do ADR-0002 descreve o que falta em uma linha: *"P3 — Moderação:
`/api/ban`, `/api/report`, mundos, `/api/room/same`."*

Ler o pusher em vez dessa linha muda a fase de forma substancial. **Isto não é funcionalidade nova — é conserto.**

### Esses endpoints não passam por capability

O [`CapabilitiesData.ts`](../../libs/messages/src/JsonMessages/CapabilitiesData.ts) declara oito capabilities.
Nenhuma delas cobre ban, report ou `sameWorld`. O pusher, portanto, chama esses endpoints **incondicionalmente**
sempre que o `ADMIN_API_URL` está setado — não há negociação nem como optar por fora, diferente dos catálogos de woka
e companion.

O `ADMIN_API_URL` está setado desde o P0/E6.

### Ou seja: duas funcionalidades estão quebradas agora

```ts
// SocketManager.handleBanPlayerMessage
await adminService.banUserByUuid(...);   // 404 nosso → o axios lança
await this.emitBan(...);                 // nunca executa
```

Banir hoje: um administrador clica em banir, respondemos 404, o `await` lança, e o `emitBan` — a parte que de fato
expulsa a pessoa — nunca é alcançado. A falha é engolida por um `try/catch` que loga no Sentry. **O administrador não
vê nada acontecer, e o usuário nem é expulso.**

Reportar tem a mesma forma, menos o segundo efeito: o `handleReportMessage` captura, loga, e o report se perde.

Ligar o `ADMIN_API_URL` causou isso. É o quarto item da lista de "efeitos colaterais importantes" do ADR-0002 que
ninguém escreveu, e é o motivo de o P3 não dever esperar o F2.

## O que o código realmente diz

Oito correções à descrição da fase e aos próprios comentários OpenAPI do pusher. Cada uma é um defeito que um
implementador embarcaria sem perceber.

| # | A documentação diz | O código faz |
|---|---|---|
| 1 | `/api/ban` é um endpoint | **Dois endpoints no mesmo caminho.** `GET` verifica, `POST` bane. Formas completamente diferentes. |
| 2 | O `GET /api/ban` recebe "o uuid do usuário" | O parâmetro se chama **`token`**, não `userUuid`. |
| 3 | Os parâmetros do `/api/report` são `in: "query"` | São **corpo JSON**, e o `roomUrl` é renomeado para **`reportWorldSlug`**. |
| 4 | A rota é `/api/room/same` | É **`/api/room/sameWorld`**. |
| 5 | — | `tags` é **string separada por vírgula**, não parâmetro repetido — o oposto do `characterTextureIds`. |
| 6 | O `AdminBannedData` exige `is_banned` | Exige **`is_banned` *e* `message`**. Responder só `{is_banned:false}` falha o parse — no caminho comum. |
| 7 | — | **Nada chama o `verifyBanUser`.** Existe na interface e nas duas implementações, e não tem nenhum chamador no repositório. |
| 8 | — | **Nenhuma capability protege nada disso**, então tudo é chamado no instante em que o `ADMIN_API_URL` é setado. |

As correções 1, 2, 3 e 6 produzem falha silenciosa cada uma. A 6 é a pior: quebra o caminho de quem **não** está
banido, que é todo mundo.

## Decisão 1 — O ban é global ao membro, e registra onde foi aplicado

O contrato manda `playUri`. O que fazemos com ele é escolha nossa.

Existe um mundo só (ADR-0002, decisão #7), então um ban por sala seria uma distinção sem consequência e sem tela para
expressá-la. O ban é guardado contra o membro, com a URL da sala mantida como **evidência, não como escopo** — a
mesma forma que o log de auditoria usa, e o mesmo caminho de evolução que as tags têm quando mundos chegarem.

**Contra o membro, não contra o `member.id`.** Implementar isto tornou a diferença concreta: o pusher nomeia a pessoa
banida com o que ele tem em mãos no `socketData.userUuid`, que é um e-mail para quem fez login e um uuid anônimo para
o visitante que não fez. Uma chave estrangeira obrigaria o visitante anônimo a virar uma conta em que ninguém nunca
consegue entrar, e o `on delete cascade` faria apagar o membro levantar o ban dele — exatamente o contrário. Então a
tabela de ban guarda um snapshot do identificador e não tem nenhuma chave estrangeira, que é a regra do log de
auditoria e não uma exceção a ela. O mesmo vale para o `report`.

## Decisão 2 — Um ban continua não sobrevivendo à reconexão, e o P3 não muda isso

Esta é a decisão incômoda, e precisa ser dita com todas as letras.

A correção #7 significa que nada lê o ban. Implementar o `GET /api/ban` com perfeição não muda nada sozinho: o pusher
nunca pergunta. Um ban, portanto, faz o que já faz hoje — expulsa a pessoa da sessão em andamento — e ela pode
reconectar imediatamente.

Fazer o ban colar exige que o pusher chame o `verifyBanUser` na conexão. Isso é mudança no `play`, não no
`admin-api`, e está **fora do escopo do F3**, que o ADR-0002 delimitou como "a nossa própria Admin API".

**O que o P3 entrega é, portanto, honesto e limitado:** o ban é *registrado*, a expulsão *volta a funcionar*, e a
verificação fica *respondível*. Aplicar o ban na reconexão vira um trabalho separado e pequeno contra o `play` — que
merece entrada própria no roadmap, e merece não ser fingido como incluído aqui.

Implementamos o `GET /api/ban` mesmo assim, por dois motivos: é uma consulta a uma tabela que o P3 constrói de
qualquer jeito, e um 404 num caminho que a própria interface do pusher declara é uma armadilha para quem ligar aquele
chamador depois.

> **Revisada em 2026-08-04 pelo [ADR-0006](0006-dashboard-issued-bans.pt-BR.md).** Um ban agora *sobrevive* à
> reconexão — não pelo pusher chamar o `verifyBanUser`, mas pelo nosso próprio `/api/room/access` responder
> `ErrorApiData` para identificador banido, que o pusher já transforma em conexão recusada. No fim nenhuma mudança
> no `play` foi necessária, e a decisão do IP (#3) não foi reaberta. O que esta seção diz permaneceu verdade durante
> todo o P3.

## Decisão 3 — Endereços de IP são aceitos e não são guardados

O `GET /api/ban` recebe `ipAddress`. Guardá-lo permitiria que o ban seguisse um dispositivo em vez de uma conta.

Não guardamos. IP é dado pessoal sob a LGPD, identifica uma casa e não uma pessoa, e é o único campo aqui com
obrigação de retenção junto. O parâmetro é aceito, não é usado para nada, e é descartado.

Se ban por IP for desejado algum dia, é uma feature deliberada com política de retenção própria — não uma coluna que
apareceu porque uma query string a ofereceu.

## Decisão 4 — Reports são guardados, e no P3 não notificam ninguém

Um report vai para uma tabela append-only, legível pelo dashboard e pela CLI, como o log de auditoria.

Deliberadamente sem e-mail, sem webhook, sem fila. Ainda não sabemos o volume, e um canal de notificação que ninguém
combinou acompanhar é exatamente o modo de falha que o log de auditoria já nos ensinou — o alerta do F1 do modelo de
ameaças existe justamente porque gravar uma linha não é a mesma coisa que avisar alguém.

Quando houver dono para a triagem, o `AdminAlerter` já é a costura pronta.

## Decisão 5 — O `/api/room/sameWorld` reaproveita o catálogo de salas do G3

O G3 já lê o `/maps` do `map-storage` atrás do `RoomCatalogue`, e o `LocalAdmin.getUrlRoomsFromSameWorld` é a
especificação executável da forma. Isto é um mapeamento sobre o que existe, não uma integração nova.

Dois detalhes de contrato a honrar: o `ShortMapDescription` faz merge do `WAMMetadata`, então os campos de metadata
viajam em cada entrada; e `tags` chega separada por vírgula, com `bypassTagFilter` como string `"true"`/`"false"`.

**O filtro por tag é onde há uma decisão escondida.** O parâmetro existe para um mundo esconder salas de quem não tem
uma tag. Nada no nosso modelo de dados expressa "esta sala exige aquela tag" — isso vive no mapa. O P3, portanto,
**ignora `tags` e devolve todas as salas**, que é o que o `LocalAdmin` faz hoje, e registra a lacuna aqui em vez de
inventar uma regra que o editor de mapas não consegue expressar.

## Decisão 6 — Nenhuma capability nova é declarada

Não há o que declarar: a correção #8 mostra que a lista de capabilities não tem chave para nenhum desses. Declarar as
não relacionadas que já pulamos continua fora de escopo — o `api/save-name` em particular segue não declarado pelo
motivo da decisão #2 do ADR-0003.

## Alternativas consideradas

### A. Esperar o F2 e fazer moderação depois
- **Prós:** o F2 destrava aposentar o mock, que o roadmap quer mais cedo.
- **Contras:** deixa banir e reportar quebrados nesse meio-tempo, e eles estão quebrados *por causa da nossa própria
  mudança*.
- **Rejeitada.** Consertar algo que quebramos vem antes da próxima feature.

### B. Implementar só o `POST /api/ban` e o `/api/report`, pular o resto
- **Prós:** a menor fatia que conserta as duas funcionalidades quebradas.
- **Contras:** deixa o `/api/room/sameWorld` respondendo 404 num caminho que o pusher chama incondicionalmente, que é
  a mesma classe de quebra silenciosa que este ADR existe para consertar.
- **Rejeitada**, embora seja uma primeira fatia razoável — ver o plano.

### C. Também alterar o `play` para aplicar o ban na reconexão
- **Prós:** faz o ban significar o que todo mundo assume que significa.
- **Contras:** mexe num segundo serviço, e o F3 está delimitado ao `admin-api`. Também reabre a decisão sobre IP.
- **Adiada**, deliberadamente e de forma visível, em vez de silenciosamente.

## Consequências

### Positivas
- Duas funcionalidades que a subida do P0 quebrou em silêncio voltam a funcionar.
- Bans e reports viram evidência, em vez de eventos que somem.
- A última fase do F3 fecha, e o F2 começa de uma fundação completa.

### Negativas
- Um ban continua não sobrevivendo à reconexão. O P3 torna esse fato explícito em vez de implícito.
- Mais duas tabelas, e a pergunta de retenção que vem junto.

### Neutras
- O `GET /api/ban` sobe sem nenhum chamador exercitando, então carrega testes próprios e nenhum e2e.

## Plano de implementação

| Fatia | Escopo |
|---|---|
| **H0** | A tabela `ban`, o `POST /api/ban`, e o `GET /api/ban` respondendo os dois campos obrigatórios. Conserta a expulsão. |
| **H1** | A tabela `report` e o `POST /api/report`. Conserta o report perdido. |
| **H2** | O `GET /api/room/sameWorld` sobre o `RoomCatalogue` que já existe. |
| **H3** | Dashboard: bans e reports como telas de leitura; CLI `ban:list` e `report:list`; docs bilíngues. *Revisada: o [ADR-0006](0006-dashboard-issued-bans.pt-BR.md) depois fez a dashboard também emitir bans; denúncias seguem só-leitura.* |

O H0 vem primeiro porque é o que tem uma falha visível ao usuário hoje.

## Testes obrigatórios

1. O `GET /api/ban` responde **os dois** campos, `is_banned` e `message`, e valida contra o mesmíssimo schema
   `AdminBannedData` com que o pusher o parseia — para um usuário banido e, principalmente, para um que não está.
2. O `GET /api/ban` lê o usuário do parâmetro **`token`**.
3. O `POST /api/ban` aceita o corpo que o pusher manda, campo por campo, e registra quem aplicou.
4. Aplicar um ban escreve uma entrada de auditoria nomeando o ator, como toda outra mutação.
5. O `POST /api/report` aceita **corpo JSON** carregando `reportWorldSlug`, não query string.
6. O `GET /api/room/sameWorld` valida contra o `ShortMapDescriptionList`, campos de metadata incluídos.
7. O `sameWorld` tolera `tags` como string separada por vírgula e `bypassTagFilter` como string, e devolve todas as
   salas.
8. Um endereço de IP fornecido ao `GET /api/ban` não é gravado em lugar nenhum.
9. Um ban consultado para membro desconhecido responde `is_banned: false` em vez de erro — a mesma regra que o
   `/api/room/access` segue para visitante desconhecido.
10. Ponta a ponta: um administrador bane alguém no `play` e a pessoa é de fato expulsa, que é o que está quebrado
    hoje.

## Referências

- [ADR-0002 — a Admin API própria](0002-admin-api.pt-BR.md) — o contrato, as armadilhas, e a tabela de fases que isto fecha
- [ADR-0004 — o dashboard](0004-admin-dashboard.pt-BR.md) — o log de auditoria e o alerta que isto reaproveita
- [Modelo de ameaças](../security/threat-model.pt-BR.md) — a costura de alerta do F1, e a regra de PII por trás da decisão #3
- [`play/src/pusher/services/SocketManager.ts`](../../play/src/pusher/services/SocketManager.ts) — o `handleBanPlayerMessage`, onde a quebra é visível
