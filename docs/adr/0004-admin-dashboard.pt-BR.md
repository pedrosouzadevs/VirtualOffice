# ADR-0004: Dashboard de administração (Admin API, P2)

- **Status:** Aceito
- **Data:** 2026-07-31 — questões em aberto respondidas no mesmo dia (decisões #6 a #8)
- **Decisores:** Equipe VirtualOffice
- **Idiomas:** este arquivo (pt-BR) + [0004-admin-dashboard.md](0004-admin-dashboard.md) (en-US), em lockstep.
- **Origem:** [ADR-0002](0002-admin-api.pt-BR.md), fase P2. Revisa a decisão #3 dele. Sucede o [ADR-0003](0003-member-and-tag-management.pt-BR.md).

> As decisões #1 a #5 foram propostas e aceitas; as #6 a #8 respondem as questões que este ADR abriu. Nada fica
> pendente antes de a implementação começar.

## Contexto

O P0 e o P1 estão entregues. As tags vivem no Postgres, o `canEdit` as segue, e a CLI do ADR-0003 acabou com o SQL na
mão. Mas a CLI exige `docker compose exec` — ou seja, acesso ao shell do container, ou seja, gerir permissão continua
sendo trabalho de quem programa.

O P2 é o que termina a frase com que o roadmap começou: *"não consigo arrumar as tags"*. Não mais por falta de dado,
e sim porque alterá-lo ainda não é algo que alguém sem terminal consiga fazer.

Escopo: listar e buscar membros, conceder e revogar tags, definir nomes de exibição, e ver salas. Autenticado, e só
para administradores.

## Decisão 1 — UI Svelte embutida, não uma aplicação Next.js separada

**Isto revisa a decisão #3 do [ADR-0002](0002-admin-api.pt-BR.md)**, que pedia um "front próprio (Next.js)".

Aquela decisão foi tomada antes de alguém olhar o que o repositório já faz. O `map-storage` entrega
[`src-ui/`](../../map-storage/src-ui): uma interface em **Svelte 5 + Vite**, construída por `vite build` e servida
pelo mesmo serviço, roteada pelo Traefik sob um prefixo de caminho no host do próprio serviço. É exatamente o formato
de que o P2 precisa, já funcionando, já no toolchain.

O que preservamos da decisão #3: o dashboard consome a **API própria do `admin-api`**, nunca os endpoints que o
pusher usa.

| | Svelte embutido | Next.js separado |
|---|---|---|
| Unidades de deploy | 1 | 2 |
| CORS | nenhum — mesma origem | necessário |
| Superfícies de auth | 1 | 2, ou cookie de domínio compartilhado |
| Toolchain | já está no repo | novo |
| SSR | desnecessário atrás de login | seu principal atrativo, sem uso |

O Next.js seria a resposta certa para um front público, relevante para SEO, de alto tráfego. Este é ferramenta
interna atrás de login, usada por um punhado de pessoas.

**O que abrimos mão:** se algum dia o dashboard precisar de deploy independente da API — escala diferente, time
diferente — será preciso separar. **A aposta:** isso não acontece antes de o dashboard merecer, e um SPA Svelte não é
difícil de destacar.

## Decisão 2 — Autenticação de gente via OIDC, restrita pela tag `admin`

O `ADMIN_API_TOKEN` é segredo de máquina compartilhado com o pusher. Ele **nunca** deve autenticar uma pessoa: um
token que concede tanto "servir o pusher" quanto "dar qualquer permissão a qualquer um" está a um vazamento de um dia
muito ruim. É o mesmo raciocínio que fez o ADR-0003 escolher CLI em vez de API HTTP de gestão.

O fluxo:

```
/admin  →  sem sessão  →  redireciona ao provedor OIDC
                       →  callback: lê o e-mail do token
                       →  procura o membro no nosso banco
                       →  exige a tag "admin"
                       →  emite cookie de sessão assinado
```

A autenticação responde *quem*; o **nosso banco** responde *o que pode* — a mesma separação que o roadmap traça entre
F2 e F3.

O `openid-client@5.7.1` já é dependência do `play`, então não há nada novo a avaliar. O Azure Entra ID vai precisar de
`http://admin-api.workadventure.localhost/admin/callback` — ou o equivalente de produção — adicionada como redirect
URI quando o F2 chegar.

> **Correção (2026-07-31, durante o G0).** Este ADR afirmava que o `RedirectUris:
> ["http://*.workadventure.localhost", ...]` do mock de desenvolvimento já cobria o nosso callback, e que portanto
> **nenhum client novo precisava ser registrado**. É falso, e o motivo merece registro: o wildcard do mock não casa
> com **hífen** no hostname. `http://adminapi.workadventure.localhost/...` é aceito; `admin-api` e `map-storage` são
> recusados, qualquer que seja o caminho. A falha aparece como `invalid_request / Invalid redirect_uri` na página de
> erro do próprio provedor, o que parece configuração errada nossa e não é.
>
> O callback passou então a ser registrado explicitamente em
> [`contrib/oidc-server-mock/clients-config.json`](../../contrib/oidc-server-mock/clients-config.json). Explícito é o
> que produção exige de qualquer jeito, então os dois ambientes passam a diferir por um hostname, e não por mecanismo.

> **A circularidade é proposital.** O dashboard que gerencia tags é protegido por uma tag que ele gerencia. É
> exatamente isso que a decisão #6 do ADR-0002 — o bootstrap idempotente — existe para romper: um ambiente novo
> sempre tem um administrador, então sempre há por onde entrar.

### Sessões assinadas, não armazenadas

A sessão é um JWT de vida curta num cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção, assinado com um segredo
que o `admin-api` já precisa ter. Sem store de sessão, sem estado a replicar, nada a perder num restart.

O custo é que uma sessão não pode ser revogada antes de expirar. Mitigado por manter a vida curta (recomendo uma
hora) e por reverificar a tag `admin` a cada requisição em vez de confiar na cópia dentro do token: um administrador
revogado perde acesso no clique seguinte, não uma hora depois.

## Decisão 3 — Dois espaços de rota, duas credenciais, sem sobreposição

| Espaço | Consumidor | Credencial |
|---|---|---|
| `/api/*` | o pusher | `ADMIN_API_TOKEN`, cru no `Authorization` |
| `/admin/*` | o dashboard | cookie de sessão assinado |

Nenhuma das credenciais é aceita no espaço da outra, e isso ganha teste explícito nos dois sentidos. Um token
compartilhado que por acaso também abre o dashboard é justamente a falha que esta decisão existe para impedir.

O `/admin/login`, o `/admin/callback` e o `/admin/logout` são necessariamente não autenticados, e ficam listados do
mesmo jeito que o `/api/capabilities`: allowlist explícita dentro de uma proteção que cobre todo o resto por padrão.

## Decisão 4 — A autorização entra **com** o P2, não no P4

O [ADR-0002](0002-admin-api.pt-BR.md) coloca "RBAC no próprio dashboard" no P4. Autenticação e "só administradores
entram" não podem esperar uma fase posterior: um dashboard sem isso não é entregável, é um editor público de
permissões.

O que de fato pertence ao P4 é o *refinamento* — papéis além de `admin`/`editor`, e permissões por ação.

## Decisão 5 — Log de auditoria, no P2 e não no P4

O ADR-0002 também adia o log de auditoria para o P4. Recomendo antecipar, por um motivo: **ele não pode ser
reconstruído depois.** Uma tag concedida no P2 e questionada no P4 não tem registro de quem a concedeu nem quando.

O mínimo é uma tabela append-only — ator, ação, alvo, timestamp — escrita a cada mutação que o dashboard fizer. É uma
migration e algumas linhas por handler agora; é uma pergunta sem resposta depois.

## Decisão 6 — Sessão deslizante, dentro de um teto absoluto

Uma hora, renovada pela atividade.

A renovação deslizante seria preocupante se o cookie carregasse a autorização: uma sessão ativa sobreviveria
indefinidamente a um administrador revogado. Ela não carrega. A decisão #2 reverifica a tag `admin` **a cada
requisição**, então quem perde a tag é recusado no clique seguinte por mais fresco que esteja o cookie. O
deslizamento estende *quanto tempo você permanece logado*, nunca *o que você pode fazer*.

O que o deslizamento ainda exige é um **teto absoluto** — recomendo 12 horas. Sem ele, um cookie roubado e mantido
quente por um script nunca expira, e "uma hora" vira um número que não descreve nada. Com o teto, o pior caso fica
limitado: uma sessão roubada morre em até 12 horas mesmo em uso constante, e em uma hora se ficar parada.

Renovar quando restar menos da metade do tempo de vida, e não a cada requisição: reemitir `Set-Cookie` em toda
chamada não custa nada além de ruído, e atrapalha a leitura dos logs.

## Decisão 7 — Host público, com o Entra ID como perímetro

O dashboard é alcançável pela internet; o Azure Entra ID é o que impede as pessoas de entrarem.

É uma escolha defensável, e é justamente o motivo de não fabricarmos autenticação própria: o Conditional Access do
Entra — MFA, conformidade de dispositivo, regras de localização — vira o perímetro de verdade, e é muito melhor que
uma allowlist de IP que teríamos de manter.

Quatro coisas deixam de ser opcionais no momento em que o host é público:

- **HTTPS, e a flag `Secure` no cookie de sessão.** Não é refinamento de produção; sem isso o cookie atravessa a
  internet em texto claro.
- **Proteção CSRF nas mutações.** O `SameSite=Lax` cobre ataques por navegação, mas toda rota que muda estado
  precisa ser POST/PATCH/DELETE — nunca GET — e as mutações precisam de `SameSite=Strict` ou token CSRF.
- **Rate limiting no `/admin/login`**, para que o redirect OIDC não vire amplificador contra o provedor.
- **O modelo de ameaça STRIDE.** O [ADR-0002](0002-admin-api.pt-BR.md) o lista no P4. Com um editor de permissões
  publicamente alcançável, ele pertence a **antes de isto ir ao ar**, não depois. Este ADR o antecipa.

## Decisão 8 — Mais de um administrador, e como um lockout se recupera

Conceder `admin` pelo dashboard é apenas conceder uma tag, então o G1 já cobre, sem caso especial.

Deliberadamente sem trava: um administrador **pode** remover a própria tag `admin`, inclusive sendo o último do
sistema. Isso é recuperável e não fatal, porque o bootstrap da decisão #6 do [ADR-0002](0002-admin-api.pt-BR.md) roda
em **toda** inicialização e reconcede o `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL` — reiniciar o `admin-api` restaura o
acesso.

Documentado em vez de bloqueado: uma regra "você não pode remover o último administrador" é mais código, e mais
surpresa no momento em que alguém esbarra nela, do que um caminho de recuperação que já existe por outro motivo.

> **Revisão (2026-08-01, depois do modelo de ameaças).** A primeira metade desta decisão — que conceder `admin` é uma
> concessão comum de tag — **não vale mais**. O achado F1 do
> [modelo de ameaças](../security/threat-model.pt-BR.md#f1--uma-sessão-de-admin-roubada-cria-um-administrador-permanente)
> nomeou a assimetria que ela criava: um atacante com uma sessão do dashboard por um minuto conseguia conceder
> `admin` a um endereço dele, e enquanto a sessão morre em até doze horas a concessão não morre. Um comprometimento
> temporário virava acesso permanente, sobrevivendo à expiração da sessão, à troca de senha e à revogação da conta
> original.
>
> **O `admin` agora é atribuído só por SQL direto.** Nem o dashboard nem a CLI conseguem conceder — os dois passam
> pelo `MemberAdministrationService`, que recusa, registra a tentativa e dispara alerta. O teste obrigatório #10 é
> substituído por um teste que afirma o contrário.
>
> A segunda metade continua igual: **revogar `admin` segue permitido pelas duas superfícies**, porque precisar de um
> DBA para tirar um administrador durante um incidente seria a troca errada. A auto-remoção continua se recuperando
> pelo bootstrap no restart, que concede pelo repositório e não pelo serviço que recusa.
>
> **O que isso custa:** uma concessão legítima de `admin` passa a não deixar rastro nenhum — o SQL contorna o log de
> auditoria e o alerta. A troca é deliberada: nenhuma superfície de aplicação consegue escalar privilégio, ao preço
> de o único privilégio cuja atribuição deixa de ser registrada.

## Alternativas consideradas

### A. Aplicação Next.js separada, como o ADR-0002 especificava
- **Prós:** deploy independente; o framework que o padrão geral da equipe nomeia.
- **Contras:** uma segunda unidade de deploy, CORS, uma segunda superfície de auth e um toolchain novo, para ganhar
  SSR que uma ferramenta interna atrás de login nunca usa.
- **Rejeitada**, substituindo a decisão #3 do ADR-0002.

### B. Reaproveitar a sessão do `play`
O `play` já assina um JWT com a `SECRET_KEY`; o `admin-api` poderia verificá-lo e ganhar SSO de graça.
- **Prós:** sem segundo login; sem trabalho de client OIDC.
- **Contras:** acopla os dois serviços por um segredo compartilhado, e o token identifica um **jogador numa sala**,
  não um administrador numa ferramenta de gestão. Tempo de vida, escopo e regras de revogação não deveriam ser os
  mesmos.
- **Rejeitada**, mas vale revisitar se aparecer uma segunda superfície administrativa.

### C. Basic auth, como o `map-storage` faz na UI dele
- **Prós:** trivial; já é padrão no repo.
- **Contras:** senha compartilhada não é uma pessoa. Não dá para revogar de um indivíduo, não dá para auditar, e não
  dá para expressar "só administradores".
- **Rejeitada.** É aceitável para upload de mapa; não é aceitável para editar permissões.

### D. Nada de dashboard — estender a CLI
- **Prós:** nenhuma superfície nova.
- **Contras:** deixa a gestão de permissões dependendo de shell no container, que é exatamente o que o P2 existe para
  acabar.
- **Rejeitada.**

## Consequências

### Positivas
- Gerir permissão deixa de exigir terminal, que é o objetivo original do roadmap.
- Autenticação de gente e de máquina ficam separadas, cada uma com o tempo de vida e a revogação certos.
- Nenhuma unidade de deploy nova, nenhum CORS, nenhum toolchain novo.

### Negativas
- O `admin-api` ganha superfície voltada a navegador, e com ela tratamento de sessão, consideração de CSRF nas
  mutações, e um passo de build para a UI.
- Sessão assinada não pode ser revogada antes de expirar; mitigado por vida curta e reverificação da tag a cada
  requisição.
- A disponibilidade do dashboard passa a importar — embora nunca a ponto de afetar o `play`, que só fala com
  `/api/*`.

### Neutras
- A decisão #3 do ADR-0002 é substituída na metade "front Next.js separado" e preservada na metade "consome a nossa
  própria API".

## Plano de implementação

| Fatia | Escopo |
|---|---|
| **G0** | A espinha de segurança: login OIDC, callback, cookie de sessão assinado, a barreira da tag `admin`, `/admin/logout` e `GET /admin/me`. Sem UI. |
| **G1** | `/admin/api/*`: lista e busca de membros, detalhe, conceder e revogar tag, definir nome, listar tags. Handlers finos sobre os repositórios que o P1 já construiu. |
| **G2** | A UI: tela de membros — busca, tags, nome. Svelte 5 + Vite em `src-ui/`, seguindo o `map-storage`. |
| **G3** | Visão de salas, lendo o `/maps` do `map-storage`. |
| **G4** | Log de auditoria, docs bilíngues, e2e de login → conceder → a tag valendo no `play`. |

O G0 vem primeiro de propósito, e sem UI de propósito: a fronteira de segurança deve existir e estar testada antes de
haver qualquer coisa atrás dela.

## Testes obrigatórios

1. Requisição anônima a qualquer rota `/admin/*` redireciona para o login; requisição anônima a `/admin/api/*`
   recebe 401, nunca um redirect.
2. **O `ADMIN_API_TOKEN` não abre `/admin/*`, e o cookie de sessão não abre `/api/*`.** Nos dois sentidos.
3. Um membro sem a tag `admin` completa o login OIDC e ainda assim é recusado.
4. Revogar a tag `admin` nega a requisição seguinte numa sessão existente — provando que a tag é reverificada, e não
   lida do token.
5. Cookie de sessão adulterado ou expirado é recusado, e não tratado como anônimo a ponto de entrar em laço de
   redirect.
6. Toda mutação escreve uma entrada de auditoria nomeando o ator.
7. Conceder uma tag pelo dashboard muda o `canEdit` daquele membro no login seguinte, ponta a ponta.
8. A atividade renova a sessão, e a sessão ainda assim morre no teto absoluto por mais ativa que tenha sido.
9. Toda rota que muda estado recusa GET, e uma mutação sem a defesa CSRF é rejeitada.
10. Um administrador consegue conceder `admin` a outra pessoa, e o novo administrador consegue entrar.

## Pontos confirmados (2026-07-31)

1. ✅ **Log de auditoria no P2**, não no P4 (decisão #5). Não pode ser preenchido retroativamente.
2. ✅ **Sessão: uma hora, renovada pela atividade, dentro de um teto absoluto de 12 horas** (decisão #6). Seguro
   porque a tag `admin` é reverificada por requisição, então o deslizamento nunca estende a autorização.
3. ✅ **Host público, Entra ID como perímetro** (decisão #7). HTTPS, `Secure`, CSRF e rate limiting no login deixam
   de ser opcionais, e o modelo STRIDE passa para antes do go-live.
4. ✅ **Vários administradores** (decisão #8). Conceder `admin` é concessão comum de tag; a auto-remoção é permitida
   e se recupera pelo bootstrap no restart.

Nenhum ponto pendente bloqueia o início do G0.

## Referências

- [ADR-0002 — Admin API própria](0002-admin-api.pt-BR.md) — decisão #3 (revisada aqui), decisão #6 (o bootstrap de que isto depende)
- [ADR-0003 — Gestão de membros e tags](0003-member-and-tag-management.pt-BR.md) — os repositórios sobre os quais o G1 constrói, e por que o P1 escolheu CLI
- [`map-storage/src-ui`](../../map-storage/src-ui) — o precedente de UI embutida
- [`play/src/pusher/services/OpenIDClient.ts`](../../play/src/pusher/services/OpenIDClient.ts) — como o `openid-client` já é usado aqui
- [Setup — `admin-api`](../SETUP-ADMIN-API.pt-BR.md)
