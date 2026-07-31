# Modelo de ameaças — `admin-api` e o dashboard de administração

- **Status:** vigente em 2026-07-31, cobrindo as fases G0–G4 do ADR-0004
- **Público:** quem for mexer no `admin-api`, e quem assinar embaixo de tornar o dashboard alcançável pela internet
- **Idiomas:** este arquivo (pt-BR) + [threat-model.md](threat-model.md) (en-US), em lockstep
- **Método:** [STRIDE](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats)

> Escrito porque a decisão #7 do [ADR-0004](../adr/0004-admin-dashboard.pt-BR.md) o antecipou para antes do go-live.
> Um editor de permissões alcançável pela internet não é coisa que se modele depois.
>
> A maior parte do que segue é registro de decisões já tomadas. O valor está na [§6](#6-achados-em-aberto), que é o
> que *não* está resolvido.

## 1. Escopo

O `admin-api` — os dois espaços de rota dele:

| Espaço | Consumidor | Credencial |
|---|---|---|
| `/api/*` | o pusher do `play` | `ADMIN_API_TOKEN`, segredo compartilhado |
| `/admin/*` | o navegador de uma pessoa | cookie de sessão assinado |

Fora do escopo: `play`, `back`, `map-storage` e o servidor de mídia têm superfícies próprias. Aparecem aqui só onde o
`admin-api` confia neles.

## 2. O que estamos protegendo

Ordenado pelo que custa perder.

| Ativo | Por que importa |
|---|---|
| **O banco de permissões** (`member`, `tag`, `member_tag`) | Decide quem edita mapa e quem administra. Escrever nele é o objetivo de atacar este serviço. |
| **A disponibilidade do `/api/*`** | O pusher o consulta com retry sem limite **antes** de abrir a própria porta. O `admin-api` cair não degrada o `play` — pendura (ADR-0002, Armadilha #2). |
| **O log de auditoria** (`audit_log`) | O único registro de quem mudou o quê. Inútil se puder ser editado, e irreconstituível se tiver buracos. |
| **`ADMIN_API_SESSION_SECRET`** | Assina o cookie de sessão. Quem o tiver forja um administrador. |
| **`ADMIN_API_TOKEN`** | Abre o `/api/*`. Compartilhado com o `play`. |
| **E-mails dos membros** | Dado pessoal sob a LGPD. Pouco volume, mas é um diretório de quem trabalha aqui. |

## 3. Fronteiras de confiança

1. **Navegador → `/admin/*`** — entrada humana não confiável, autenticada pelo OIDC, autorizada pelo nosso banco.
2. **Pusher → `/api/*`** — máquina com segredo compartilhado. Tudo o que ela envia é controlado pelo chamador.
3. **`admin-api` → Postgres** — só nosso; nenhum outro serviço tem credencial.
4. **`admin-api` → provedor OIDC** — externo. Responde *quem*; nunca decide *o que pode*.
5. **`admin-api` → `map-storage`** — interno e **sem autenticação**. Ver [F3](#f3--o-catálogo-de-salas-é-legível-por-qualquer-coisa-na-rede).

## 4. A passada do STRIDE

### S — Spoofing: se passar por outro

**Resolvido.** A identidade vem do provedor OIDC, nunca de uma claim que deixemos o chamador fornecer. A sessão é um
JWT assinado em HS256 com segredo dedicado, com o algoritmo fixado na verificação — uma forja `alg: none` é recusada,
e há teste de regressão. O `ADMIN_API_TOKEN` do pusher é comparado por digest com tempo constante, e não abre o
`/admin/*` de jeito nenhum: a barreira nunca lê o header `Authorization`.

O segredo de sessão deliberadamente **não** é o `ADMIN_API_TOKEN`. Um segredo que ao mesmo tempo servisse máquinas e
emitisse sessões de gente transformaria um único vazamento em personificação de qualquer administrador.

**Residual:** quem tiver o `ADMIN_API_SESSION_SECRET` forja sessão para qualquer e-mail. É inerente a sessão
assinada, e é por isso que o segredo está na lista de ativos acima.

### T — Tampering: alterar dados

**Resolvido.** O cookie de sessão é assinado, então seu conteúdo não pode ser editado — um payload adulterado falha a
verificação e é tratado como cookie nenhum. Mutações exigem o header `X-CSRF-Token` casando com uma claim dentro
desse cookie assinado, que uma página de outra origem não consegue ler nem definir. O `SameSite=Lax` já bloqueia POST
cross-site sozinho; o token é a segunda camada. Toda rota que muda estado é POST/PATCH/DELETE — `GET /admin/logout` é
404, testado.

O `returnTo` é reduzido a um caminho `/admin/` na escrita e na leitura, então o redirect pós-login não pode ser
apontado para fora.

**Residual:** o token CSRF é comparado com `!==`, não com primitiva de tempo constante. Explorar isso exigiria muitas
requisições já portando um cookie de sessão válido — e aí o atacante já tem a sessão. Anotado, não corrigido.

### R — Repudiation: negar que fez

**Quase resolvido.** O `audit_log` é append-only — ator, ação, alvo, timestamp, detalhes — e não existe caminho de
código que atualize ou apague linha. A escrita vive no serviço compartilhado de Application, então a CLI não consegue
burlar o que o dashboard registra. As entradas guardam e-mails como **fotografias, sem chave estrangeira**, então o
histórico sobrevive à pessoa ser renomeada ou removida.

**Residual:** ver [F2](#f2--mudanças-pela-cli-não-conseguem-nomear-uma-pessoa) e
[F4](#f4--uma-escrita-de-auditoria-que-falha-não-derruba-a-requisição).

### I — Information disclosure: ver o que não deveria

**Quase resolvido.** Tudo sob `/admin` é protegido por padrão; abrir um caminho exige edição deliberada de uma
allowlist. A chave primária interna nunca sai do banco — o e-mail é o único identificador que sai (ADR-0002,
decisão #5). Os cookies são `HttpOnly` (menos o companheiro de CSRF, que sozinho não vale nada), escopados em
`Path=/admin` para o navegador nem oferecê-los ao `/api/*`, e `Secure` sempre que a URL pública for HTTPS.

O 503 de dashboard não configurado é vago de propósito: qual variável falta vai para o log de inicialização, onde o
operador vê, e não para um chamador anônimo.

**Residual:** ver [F3](#f3--o-catálogo-de-salas-é-legível-por-qualquer-coisa-na-rede) e
[F5](#f5--login-recusado-põe-um-e-mail-no-log-operacional).

### D — Denial of service

**Parcialmente resolvido.** O `/admin/login` tem limite de taxa para que o redirect dele não vire amplificador contra
o provedor. O dashboard é arquiteturalmente incapaz de derrubar o `/api/*` junto: configuração faltando desliga o
`/admin/*` com 503, UI não construída simplesmente não é servida, e `map-storage` inacessível é um 502 numa tela só.
As chamadas ao provedor e ao `map-storage` têm timeout, então dependência travada não segura requisição indefinidamente.

**Residual:** ver [F6](#f6--só-o-login-tem-limite-de-taxa).

### E — Elevation of privilege

**Parcialmente resolvido.** A tag `admin` é relida do Postgres a **cada** requisição em vez de confiada ao token,
então um administrador revogado é recusado no clique seguinte, não uma hora depois. A autorização nunca vem de uma
claim do OIDC — o provedor responde *quem*, o nosso banco responde *o que pode*. A sessão deslizante estende quanto
tempo você fica logado, nunca o que você pode fazer.

**Residual:** ver [F1](#f1--uma-sessão-de-admin-roubada-cria-um-administrador-permanente), que é o achado que mais
importa.

## 5. Ataques considerados e descartados

| Ataque | Por que não funciona |
|---|---|
| Repetir um callback OIDC já usado | O cookie de transação é de uso único e é limpo em todo caminho de saída do callback, com sucesso ou falha. |
| Forçar login por link (login CSRF) | O `state` do OIDC viaja em cookie assinado e é verificado pelo `openid-client`. |
| Fixação de sessão | A sessão é emitida no callback; nada que o chamador envia influencia o conteúdo dela. |
| Escapar da árvore de mapas pela rota de áreas | Caminhos com `..` ou começando com `/` são recusados antes de chegar ao `map-storage`. |
| Trancar todo mundo removendo o último admin | Permitido de propósito. O bootstrap reconcede a cada subida, então reiniciar o `admin-api` restaura (ADR-0004, decisão #8). |

## 6. Achados em aberto

Ordenados. Nenhum é bloqueante hoje porque o dashboard ainda não é alcançável pela internet — que é exatamente a
condição que muda.

### F1 — Uma sessão de admin roubada cria um administrador permanente

**Severidade: alta.** Um atacante com a sessão de navegador de um administrador, ainda que por um minuto, concede
`admin` a um endereço que ele controla. A sessão morre em até 12 horas; a concessão não. Um comprometimento
temporário vira acesso permanente que sobrevive à expiração da sessão, à troca de senha e à revogação da conta
original.

Conceder `admin` pelo dashboard é deliberado (ADR-0004, decisão #8) e tem teste obrigatório. A pergunta que este
modelo levanta não é se permitir, e sim se pode ser *silencioso*.

**Opções:**

| | Efeito | Custo |
|---|---|---|
| **a. Aceitar, apoiado no provedor** | O Conditional Access do Entra — MFA, conformidade de dispositivo — é o perímetro de verdade, que é a premissa da decisão #7 | nenhum |
| **b. Alertar em concessões de `admin`** | Transforma permanente-e-silencioso em permanente-e-percebido. O log já registra; ninguém lê | pequeno |
| **c. Só conceder `admin` pela CLI** | Uma sessão de navegador roubada deixaria de criar administrador clandestino | revisa a decisão #8 e o teste obrigatório #10 |
| **d. Exigir aprovação de um segundo administrador** | Remove o ponto único de comprometimento | grande; atrito real para um time pequeno |

**Recomendação: (a) + (b).** Manter a decisão #8, e fazer de uma concessão de `admin` algo que um humano fica
sabendo, em vez de algo enterrado numa tabela. Revisitar a (c) se o dashboard algum dia ficar alcançável sem
Conditional Access na frente.

### F2 — Mudanças pela CLI não conseguem nomear uma pessoa

**Severidade: média.** Entradas escritas por `npm run member:grant` e afins são atribuídas a `cli`, porque um comando
rodado dentro do container não tem identidade logada. É honesto, e continua sendo um buraco de repúdio: "quem
concedeu isso" não tem resposta sempre que o terminal foi usado.

**Mitigação:** tratar acesso ao shell do container como o ato privilegiado que é, e preferir o dashboard para
mudanças rotineiras agora que ele existe.

### F3 — O catálogo de salas é legível por qualquer coisa na rede

**Severidade: baixa.** O `GET /maps` e os arquivos `.wam` do `map-storage` não têm autenticação — é a mesma chamada
que o `play` faz. Então a lista de salas, e os donos das áreas pessoais dentro delas, são legíveis por qualquer
processo na rede Docker. É decisão do `map-storage` e não algo que o `admin-api` possa apertar; a cópia do dashboard
fica atrás da barreira de sessão.

**Mitigação:** segmentação de rede. Vale levantar upstream se a árvore de mapas passar a guardar algo sensível.

### F4 — Uma escrita de auditoria que falha não derruba a requisição

**Severidade: baixa.** A entrada é escrita depois da mutação, e uma falha é logada em vez de propagada: a mudança já
aconteceu, então responder erro descreveria o mundo errado. A causa realista — banco fora do ar ou cheio — teria
parado a mutação antes, então o buraco é estreito e correlacionado, não geral.

**Mitigação:** aceito. Fechar direito significa uma transação abrangendo as duas escritas, ou seja, unidade de
trabalho atravessando dois ports; revisitar se o log virar prova de conformidade em vez de meio de responder
perguntas.

### F5 — Login recusado põe um e-mail no log operacional

**Severidade: baixa.** Um login de dashboard recusado por falta da tag `admin` loga o endereço. A regra do próprio
projeto é redigir dado pessoal em log por padrão; o contra-argumento é que um login administrativo recusado é
exatamente o evento que o operador precisa ver nomeado.

**Decisão necessária:** confirmar como exceção intencional, ou redigir e depender do log de auditoria.

### F6 — Só o login tem limite de taxa

**Severidade: baixa.** O `/admin/api/*` não tem throttle. Toda rota ali exige sessão válida e relê a tag `admin` do
Postgres a cada requisição, então a exposição é um administrador autenticado martelando o próprio banco — não um
anônimo.

**Mitigação:** revisitar se o dashboard for exposto sem um proxy que limite taxa, ou se o `/admin/api` passar a
servir algo caro.

### F7 — O segredo de sessão ainda é o padrão de desenvolvimento

**Severidade: alta no dia em que for ao ar, nenhuma hoje.** O `ADMIN_API_SESSION_SECRET` no `.env.template` e no
`docker-compose.yaml` é uma constante conhecida. Quem a tiver forja sessão para qualquer e-mail.

**Ação:** gerar um de verdade (`openssl rand -base64 48`) antes de qualquer deploy que não seja um clone local. É
item de checklist de go-live, não mudança de código.

## 7. Antes do go-live

- [ ] **F7** — trocar o `ADMIN_API_SESSION_SECRET` por um valor gerado
- [ ] **F1** — decidir entre as opções acima; implementar a (b) se escolhida
- [ ] HTTPS confirmado num deploy de verdade, com o cookie de sessão observado carregando `Secure`
- [ ] `ADMIN_API_TRUST_PROXY` batendo com a topologia real — `false` se não houver nada na frente, ou o limite de
      taxa do login é contornável com um `X-Forwarded-For` forjado
- [ ] **F5** — confirmar ou redigir

## 8. Revisão

Revisitar quando surgir um espaço de rota novo, quando uma dependência externa nova passar a ser confiada, ou quando
a exposição mudar — o que vier primeiro. Cada um desses é uma mudança na [§3](#3-fronteiras-de-confiança), e uma
fronteira de confiança que se moveu sem este documento se mover é o que faz modelo de ameaça envelhecer.

## Referências

- [ADR-0002 — a Admin API própria](../adr/0002-admin-api.pt-BR.md) — o contrato e suas armadilhas
- [ADR-0004 — o dashboard](../adr/0004-admin-dashboard.pt-BR.md) — decisões #2, #3, #6, #7 e #8
- [Setup — `admin-api`](../SETUP-ADMIN-API.pt-BR.md)
- OWASP Top 10, e o OWASP Top 10 para Aplicações com LLM quando features de IA chegarem
