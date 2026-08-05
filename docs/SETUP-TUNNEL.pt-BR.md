# Setup — produção por túnel (ngrok, sem VPS)

> **Propósito.** Rodar o stack de produção numa máquina que você já tem e publicá-lo por um túnel com URL fixa — sem
> VPS, sem domínio comprado. Escrito para o domínio estático gratuito do ngrok; a variante com quick tunnel da
> Cloudflare está no fim.
> **Público.** Quem roda o piloto da própria máquina (Windows + Docker Desktop assumidos).
> **Escopo.** Um piloto, honestamente: os planos gratuitos de túnel não são canal 24/7. Caminhos de promoção no fim.
> **Idiomas.** Este arquivo (pt-BR) + [SETUP-TUNNEL.md](SETUP-TUNNEL.md) (en-US), em lockstep.

## Como difere do deploy no VPS

Mesmo compose de produção, duas diferenças:

1. **O TLS termina na borda do túnel**, então o origin serve HTTP puro. É isso que o
   [`docker-compose.tunnel.yaml`](../contrib/docker/docker-compose.tunnel.yaml) faz: empilhado sobre o arquivo de
   produção, remove o redirect HTTPS do Traefik e o resolver do Let's Encrypt. (O Traefik loga avisos sobre os
   routers `-ssl` descartados — esperado; os routers `web` servem todas as rotas.)
2. **O `DOMAIN` é o hostname do túnel** (ex.: `seu-nome.ngrok-free.dev`). Como ele é *estático* no plano gratuito do
   ngrok, os callbacks do Entra ID são registrados **uma vez** — a coisa que um túnel de URL aleatória não te dá.

Todo o resto — admin-api, dashboard em `/admin`, moderação, editor de mapas — funciona exatamente como no VPS.

## Pré-requisitos

- Docker Desktop (WSL2). Dê memória para o build: Settings → Resources, ou `.wslconfig` com `memory=12GB`.
- Uma [conta ngrok](https://dashboard.ngrok.com) (gratuita), o agente instalado, e o seu **domínio estático**
  reivindicado (dashboard → Domains). O agente autentica uma vez: `ngrok config add-authtoken <token>`.
- Azure CLI para o passo do Entra, logada no seu tenant.
- O stack de desenvolvimento **parado** — ele segura as portas 80/443 e a sua RAM:

```bash
docker compose down          # na raiz do repositório
```

## 1. Configurar

```bash
cd contrib/docker
cp .env.prod.template .env   # pule se já existir um .env preenchido
```

Preencha (cada segredo gerado, nenhum reusado — `openssl rand -base64 48`):

| Variável | Valor |
|---|---|
| `DOMAIN` | seu domínio estático, ex.: `seu-nome.ngrok-free.dev` — **sem esquema** |
| os cinco segredos + `MAP_STORAGE_AUTHENTICATION_PASSWORD` | valores gerados |
| `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL` | o e-mail com que você entra no **Entra** |
| `ACME_EMAIL` | qualquer coisa — não usado no modo túnel |
| bloco `OPENID_*` | próximo passo |

## 2. Entra ID (uma vez — a URL nunca muda)

```bash
pwsh docs/index/setup-entra-id.ps1 -PlayUrl https://<seu-dominio> -AdminApiUrl https://<seu-dominio>
```

O mesmo hostname nos dois parâmetros. Cole o bloco `OPENID_*` impresso no `.env`.
Detalhes e troubleshooting por AADSTS: [SETUP-CLOUD-AZURE.pt-BR.md](SETUP-CLOUD-AZURE.pt-BR.md).

## 3. Buildar e subir

```bash
cd contrib/docker
docker compose -f docker-compose.prod.yaml -f docker-compose.tunnel.yaml build    # primeira vez: 20-40 min
docker compose -f docker-compose.prod.yaml -f docker-compose.tunnel.yaml up -d
docker compose -f docker-compose.prod.yaml -f docker-compose.tunnel.yaml logs -f play   # até "Remote admin api connection successful"
```

## 4. Abrir o túnel

```bash
ngrok http --url=<seu-dominio> 80
```

(Agentes antigos: `--domain=` em vez de `--url=`.) Deixe rodando; fechar o terminal fecha o escritório.

## 5. Primeiro mapa e primeiro login

1. `https://<seu-dominio>/map-storage/` — Basic auth do `.env` → suba o mapa do escritório
   (o `maps/office.zip` do repositório, ou o [map starter kit](https://github.com/workadventure/map-starter-kit)).
2. `https://<seu-dominio>` numa janela anônima → o interstitial único do ngrok ("Visit Site") → login Microsoft →
   o escritório.
3. `https://<seu-dominio>/admin` → o dashboard; o bootstrap concedeu `admin` ao seu e-mail.

## Verificação

```bash
docker compose -f docker-compose.prod.yaml -f docker-compose.tunnel.yaml exec admin-api npm run member:list
```

Seu e-mail com `admin`; depois o checklist humano: andar, encontrar alguém numa bolha (vídeo), conceder `editor` e
editar o mapa, banir uma conta de teste pelo `/admin` → Moderação e vê-la sair e não conseguir voltar.

## As letras miúdas do plano gratuito

| Limite | O que significa aqui |
|---|---|
| **Página interstitial** | Cada visitante clica num aviso do ngrok uma vez. Ok internamente; sem polimento para qualquer outra coisa. |
| **Franquia de banda/requisições** (~1 GB/mês; confira os números atuais) | Escritório virtual é websocket o dia todo. Um piloto cabe; uso diário do time inteiro, não. Vídeo é P2P e não conta na franquia. |
| **Sem UDP** | Sem TURN, nunca, por túnel. Vídeo 100% P2P — redes corporativas rígidas podem falhar. |
| Sua máquina é o servidor | Precisa ficar ligada; o upload da sua conexão carrega o tráfego (5-10 pessoas com folga numa fibra doméstica típica). |
| Um IP de cliente só | O limitador de login do dashboard vê todo mundo como um endereço; logins falhados simultâneos podem frear o grupo por instantes. |

## Parar, e voltar ao desenvolvimento

```bash
# parar o túnel: Ctrl+C no ngrok
cd contrib/docker && docker compose -f docker-compose.prod.yaml -f docker-compose.tunnel.yaml down
cd ../.. && docker compose up -d     # o stack de dev de novo
```

Volumes sobrevivem ao `down`: membros, tags, bans e mapas subidos ficam guardados para a próxima sessão do piloto.

## Variante: quick tunnel da Cloudflare (sem conta, URL aleatória)

Só para **demo anônima** — a URL muda a cada reinício, então o Entra não tem como ser registrado com juízo:
ponha `DISABLE_ANONYMOUS=false` no `.env` (visitantes entram sem login e sem tags), deixe o bloco `OPENID_*` vazio,
e:

```bash
cloudflared tunnel --url http://localhost:80
```

com o `DOMAIN` apontando para o hostname que ele imprimir (recrie o stack). O dashboard fica sem login utilizável
nesse modo — moderação pela CLI se precisar.

## Caminhos de promoção

- **Estável, sempre no ar, 30 pessoas:** o VPS — [SETUP-DEPLOY.pt-BR.md](SETUP-DEPLOY.pt-BR.md). O `.env` que você
  montou aqui vai junto; só o `DOMAIN` e a história de certificados mudam.
- **Continuar por túnel mas com domínio de verdade (~R$40/ano):** Cloudflare named tunnel + Access —
  [SETUP-CLOUDFLARE.pt-BR.md](SETUP-CLOUDFLARE.pt-BR.md) cobre a metade do proxy; o túnel mantém o override de
  compose deste guia.

## Solução de problemas

| Sintoma | Causa e correção |
|---|---|
| `ERR_NGROK_...` ao iniciar | Agente sem autenticação (`ngrok config add-authtoken`) ou o domínio não está reivindicado na sua conta. |
| Porta 80 ocupada | O stack de desenvolvimento continua de pé — `docker compose down` na raiz do repositório. |
| Build morre sem memória | Aumente a memória do Docker Desktop/WSL2 (12 GB é confortável); ou builde um serviço por vez. |
| Login Microsoft volta com `AADSTS50011` | As redirect URIs registradas e o `DOMAIN` divergem — byte a byte, esquema incluso. |
| Página carrega mas o websocket morre | Você mudou o `DOMAIN` depois do `up` — recrie: `docker compose ... up -d --force-recreate play admin-api`. |
| Todo mundo deslogado de repente | Você rotacionou o `SECRET_KEY`. É para isso que ele serve. |
