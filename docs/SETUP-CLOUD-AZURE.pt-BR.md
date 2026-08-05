# Setup — Azure Entra ID (F2)

> **Propósito.** Apontar o login do ArqueumSpace para o Azure Entra ID em vez do mock OIDC de desenvolvimento — o
> *config swap* que o roadmap escolheu para o F2 (opção A: sem multi-provider; dev fica com o mock, produção usa o
> Entra).
> **Público.** Quem administra o tenant Azure e opera o deploy.
> **Idiomas.** Este arquivo (pt-BR) + [SETUP-CLOUD-AZURE.md](SETUP-CLOUD-AZURE.md) (en-US), em lockstep.

## Visão geral

Um **app registration** só atende as duas superfícies de login, porque os dois serviços são deliberadamente
configurados dos mesmos valores do `.env` (não conseguem divergir):

| Superfície | Callback que precisa estar registrado |
|---|---|
| O mundo (`play`) | `<PLAY_URL>/openid-callback` e `<PLAY_URL>/logout-callback` |
| O dashboard de administração (`admin-api`) | `<ADMIN_API_PUBLIC_URL>/admin/callback` |

Identidade é tudo o que o Entra fornece. **Autorização continua no Postgres do `admin-api`** (F3): o pusher para de
ler a claim de tags no instante em que o `ADMIN_API_URL` é setado, então não há App Role nem mapeamento de grupo
para configurar — o trabalho de mapeamento que o spec original esperava ficou obsoleto com o F3.

O que a troca muda para as pessoas: todo mundo entra com a conta Microsoft, e o **e-mail** é a identidade em todo
lugar — a linha de membro, o log de auditoria, a propriedade de área pessoal. As tags que a pessoa tinha continuam
valendo, porque as tags estão presas ao e-mail no nosso banco, não ao provedor.

## Pré-requisitos

- Um tenant Entra ID com os seus usuários, e uma conta que possa criar app registrations
  (o papel Application Developer basta).
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.60+, logada: `az login --tenant <tenant>`.
  No Windows: `winget install --exact --id Microsoft.AzureCLI`, depois **feche e reabra o terminal** (o PATH só
  atualiza numa sessão nova).
- As URLs públicas das duas superfícies, HTTPS, decididas antes. O Entra recusa redirect URI `http://` fora de
  localhost — não existe o perdão de wildcard do mock.
- `ADMIN_API_SESSION_SECRET` trocado por um valor gerado (F7 do modelo de ameaças): `openssl rand -base64 48`.

## Custo

Zero. App registrations e login OIDC estão em todo tier do Entra ID, o gratuito incluso. (Endurecimentos opcionais
como Conditional Access exigem licença P1/P2, mas nada aqui depende disso.)

## Caminho scriptado

```bash
pwsh docs/index/setup-entra-id.ps1 -PlayUrl https://play.example.com -AdminApiUrl https://admin.example.com
```

No **Windows PowerShell 5.1** (o padrão, onde `pwsh` não existe), rode `.\docs\index\setup-entra-id.ps1` com os
mesmos parâmetros — o script é compatível com o 5.1 de propósito (ASCII puro, sem sintaxe de PowerShell 7).

Idempotente: encontra o registration pelo display name e completa o que faltar. Imprime o bloco `OPENID_*` exato
para o `.env` — o client secret **uma vez**, salvo em lugar nenhum. Códigos de saída: 0 sucesso, 1 parâmetro errado,
**2 ambiente não pronto** (é o que você recebe sem o Azure CLI, ou sem `az login`), 3 o Entra respondeu erro.

## Caminho manual

Cada passo em CLI pura, por auditabilidade. Valores em `<>` são os seus.

```bash
# 1. O registration, com os três callbacks. Byte a byte: URI diferente por um caractere falha com AADSTS50011.
az ad app create --display-name "ArqueumSpace" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris \
    "https://<play-host>/openid-callback" \
    "https://<play-host>/logout-callback" \
    "https://<admin-host>/admin/callback"

# 2. Pedir a claim de e-mail no ID token (o Entra só emite o que for pedido).
#    Alternativa no portal: App registrations > Token configuration > Add optional claim > ID > email.
az ad app update --id <appId> --optional-claims '{
  "idToken": [
    { "name": "email", "essential": false },
    { "name": "preferred_username", "essential": false }
  ]
}'

# 3. Um client secret. Impresso uma vez; vai para o cofre de segredos, nunca para arquivo commitado.
az ad app credential reset --id <appId> --append \
  --display-name "virtualoffice-$(date +%Y%m%d)" --end-date "$(date -u -d '+3 months' +%Y-%m-%dT%H:%M:%SZ)"
```

Depois preencha o `.env` da raiz (o mesmo bloco que o script imprime):

```dotenv
OPENID_CLIENT_ID=<Application (client) ID>
OPENID_CLIENT_SECRET=<o secret>
OPENID_CLIENT_ISSUER=https://login.microsoftonline.com/<tenant id>/v2.0
OPENID_SCOPE=openid profile email
OPENID_USERNAME_CLAIM=preferred_username
```

e recrie a stack: `docker compose up -d`. Esvaziar o bloco volta para o mock — esse é o rollback inteiro.

Três valores que valem entender em vez de copiar:

- **`OPENID_SCOPE` não pode conter `tags-scope`.** Esse scope só existe no mock; o Entra recusa scope desconhecido
  com `AADSTS70011`. Tirar não perde nada — autorização vem do banco (F3).
- **`OPENID_USERNAME_CLAIM=preferred_username`** é o que faz o `OPID_WOKA_NAME_POLICY=allow_override_opid`
  (preparado desde o ADR-0003) finalmente ter efeito: o mundo propõe o nome da Microsoft e a pessoa pode trocar.
- **O issuer precisa terminar em `/v2.0`** — sem isso o discovery encontra o endpoint v1 e toda validação de token
  falha.

## Verificação

O checklist de staging que o roadmap chama de F2/P0. Em ordem, porque cada passo exercita o anterior:

1. `docker compose logs play | grep -i "capabilities"` — o pusher continua alcançando o `admin-api` (nada do F2
   deveria ter tocado nisso; pega um `.env` esvaziado sem querer).
2. Abra o mundo numa janela anônima → o login Microsoft aparece → depois de entrar você está no mapa.
3. O nome proposto é o seu nome Microsoft, e dá para trocar (`allow_override_opid`).
4. `docker compose exec admin-api npm run member:list` — o seu **e-mail** virou linha de membro no primeiro login.
5. Conceda uma tag a si e veja agir: `member:grant -- <seu e-mail> editor`, recarregue, o editor de mapas aparece.
6. Abra `https://<admin-host>/admin` → o mesmo login Microsoft → o dashboard, desde que a sua linha de membro tenha
   a tag `admin` (concedida por SQL direto — `docs/SETUP-ADMIN-API.pt-BR.md`, "Concedendo admin").
7. Saia do mundo → o navegador volta em `<play>/logout-callback` sem página de erro do Entra.

## Solução de problemas

| Sintoma | Causa e correção |
|---|---|
| `AADSTS50011` (redirect URI mismatch) | O callback não está registrado **exatamente**. Compare esquema, host, porta e caminho com as três URIs acima. |
| `AADSTS70011` (invalid scope) | O `tags-scope` (ou um typo) ainda está no `OPENID_SCOPE`. Use `openid profile email`. |
| `AADSTS7000215` (invalid client secret) | O secret expirou ou foi colado com espaço no fim. Rode o script de novo; ele sempre cunha um novo. |
| Login funciona mas o dashboard responde "no email claim" | Falta a optional claim (passo 2 do caminho manual), ou a conta realmente não tem e-mail. O dashboard recusa em vez de adivinhar (`OpenIdConnectAuthenticator`). |
| O mundo não propõe nome | `OPENID_USERNAME_CLAIM` vazio ou diferente de `preferred_username`. |
| Todo mundo perdeu o editor de mapas depois da troca | Esperado: as identidades agora são os e-mails do Entra. Conceda tags aos endereços reais — `docs/SETUP-ADMIN-API.pt-BR.md`. O admin do bootstrap (`ADMIN_API_BOOTSTRAP_ADMIN_EMAIL`) também precisa ser um endereço real. |

## Rotação de credenciais

A cada 90 dias (a validade padrão do secret acompanha): rode o script de novo — ele adiciona um secret novo sem
tocar no antigo — atualize o `.env`/cofre, `docker compose up -d`, e apague o secret antigo no portal quando o novo
estiver provado. Ad hoc em suspeita de comprometimento, mesmos passos.

## Descomissionamento

Esvazie o bloco `OPENID_*` no `.env` e recrie a stack (volta ao mock), depois apague o app registration:
`az ad app delete --id <appId>`. Linhas de membro, tags, bans e auditoria sobrevivem — pertencem ao `admin-api`,
não ao provedor.

## O que fica em aberto

- **Aposentar o mock (F2/P2 do spec) deliberadamente não é feito aqui.** Sem o mock não há login local offline,
  então esse passo espera existir um tenant de desenvolvimento (ou a decisão de mock permanente) — o spec aponta
  esse risco explicitamente.
- Nada verifica estes passos contra um tenant vivo em CI; a seção Verificação é um checklist humano.

## Referências

- [Spec do roadmap, Feature 2](specs/0001-feature-roadmap.pt-BR.md) — a decisão do config swap e o histórico
- [SETUP-ADMIN-API.pt-BR.md](SETUP-ADMIN-API.pt-BR.md) — conceder tags e `admin`, bootstrap, rollback
- [ADR-0003](adr/0003-member-and-tag-management.pt-BR.md) — decisão #4, a política de nome de woka que a troca ativa
- [Modelo de ameaças](security/threat-model.pt-BR.md) — F7, o segredo de sessão que não pode ficar no padrão de dev
