# Setup — deploy de produção (VPS Hostinger)

> **Propósito.** Levar o VirtualOffice deste repositório a um único VPS servindo até ~30 usuários simultâneos, em um
> domínio só, com login via Azure Entra ID e a Admin API mandando em permissões e moderação.
> **Público.** Quem opera o servidor. Escrito contra um plano KVM da Hostinger (4 vCPU, 16 GB RAM, 200 GB NVMe,
> 16 TB de tráfego) — qualquer VPS Ubuntu com esses números funciona igual.
> **Idiomas.** Este arquivo (pt-BR) + [SETUP-DEPLOY.md](SETUP-DEPLOY.md) (en-US), em lockstep.

## O que você termina tendo

Um domínio, um certificado, portas 80/443. O Traefik reparte por caminho:

| Caminho | Serviço |
|---|---|
| `/` | o mundo (`play`) |
| `/ws/` | os websockets do pusher |
| `/admin` | o dashboard de administração (`admin-api`) |
| `/api` | `back` |
| `/map-storage` | mapas + backend do editor inline |
| `/uploader`, `/icon` | uploads do chat, favicons |

O `/api/*` do próprio `admin-api` — o contrato que o pusher consome — **nunca** é exposto; o pusher o alcança pela
rede interna em `http://admin-api:3000`.

Tudo roda do `contrib/docker/docker-compose.prod.yaml`, e os cinco serviços Node (`play`, `back`, `map-storage`,
`uploader`, `admin-api`) são **buildados deste repositório**, não puxados do Docker Hub — as imagens upstream não
contêm este fork (a trava de dono de área do F4, a Admin API, os schemas dela).

## Pré-requisitos

- O VPS, com **Ubuntu 24.04 LTS** — escolha no painel de SO da Hostinger (SO puro, sem template).
- Um **domínio** seu, com acesso ao DNS.
- O **tenant Entra ID** com seus usuários, e permissão para criar app registration
  ([SETUP-CLOUD-AZURE.pt-BR.md](SETUP-CLOUD-AZURE.pt-BR.md)).
- Este repositório alcançável do VPS (um remote git de onde clonar).

Sanidade de dimensionamento: o upstream afirma que 2 vCPU / 4 GB atendem até 300 usuários simultâneos — o vídeo é
peer-to-peer e não cruza o servidor. Seu plano é folgado; o primeiro build de imagens é o único momento pesado.

## 1. DNS

Um registro `A` do seu domínio (digamos `office.exemplo.com.br`) apontando para o IP do VPS. Nada mais. Deixe o DNS
propagar antes de começar — o Let's Encrypt precisa resolver o nome para esta máquina.

> **Vai colocar a Cloudflare na frente?** Faça o deploy até o fim deste guia primeiro — direto, DNS only — e depois
> siga o [SETUP-CLOUDFLARE.pt-BR.md](SETUP-CLOUDFLARE.pt-BR.md). Quatro ajustes são obrigatórios lá (modo SSL,
> desafio de certificado, hostname cinza para o TURN, IPs reais); ligar o proxy antes deles quebra certificado e
> vídeo de um jeito que parece bug daqui.

## 2. Primeiro acesso e endurecimento

```bash
ssh root@<IP-DO-VPS>

# Um usuário seu; o root fica só para emergências.
adduser deploy && usermod -aG sudo deploy

# Firewall: SSH + web, nada mais. (O coturn adiciona as portas dele depois — seção 8.)
apt-get update && apt-get install -y ufw
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable
```

O painel da Hostinger também tem firewall externo — espelhe as mesmas três regras lá se o habilitar.

## 3. Docker

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

Saia e entre de novo como `deploy` para o grupo valer.

## 4. Clonar e configurar

```bash
git clone <seu-remote-git> virtualoffice
cd virtualoffice/contrib/docker
cp .env.prod.template .env
```

Gere todos os segredos — cinco valores, cinco saídas diferentes, nenhum reusado:

```bash
for v in SECRET_KEY ADMIN_API_TOKEN ADMIN_SOCKETS_TOKEN ADMIN_API_SESSION_SECRET ADMIN_API_DB_PASSWORD; do echo "$v=$(openssl rand -base64 48 | tr -d '\n')"; done
```

Depois edite o `.env` e preencha, no mínimo:

| Variável | Valor |
|---|---|
| os cinco segredos acima | colados do comando |
| `DOMAIN` | `office.exemplo.com.br` — sem esquema |
| `ACME_EMAIL` | para onde vão os avisos de certificado |
| `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL` | **seu e-mail do Entra** — recebe a tag `admin` em todo boot, e é a recuperação de lockout |
| `MAP_STORAGE_AUTHENTICATION_PASSWORD` | `openssl rand -base64 24` — credencial de upload de mapas |
| `ROOM_API_SECRET_KEY` | outro valor gerado, ou vazio para desligar a Room API |
| o bloco `OPENID_*` | próximo passo |

## 5. Entra ID

De qualquer máquina com Azure CLI (sua estação serve):

```bash
pwsh docs/index/setup-entra-id.ps1 -PlayUrl https://office.exemplo.com.br -AdminApiUrl https://office.exemplo.com.br
```

**O mesmo domínio nos dois parâmetros** — o modo domínio-único registra os três callbacks
(`/openid-callback`, `/logout-callback`, `/admin/callback`) num host só. O script imprime o bloco `OPENID_*` uma
vez; cole no `.env`. Caminho manual e troubleshooting por AADSTS:
[SETUP-CLOUD-AZURE.pt-BR.md](SETUP-CLOUD-AZURE.pt-BR.md).

## 6. Buildar e subir

```bash
docker compose build          # primeira vez: 20-40 min — cinco imagens buildadas do fonte
docker compose up -d
docker compose logs -f play   # até: "Remote admin api connection successful"
```

A ordem de subida é garantida por healthcheck: Postgres → `admin-api` (migrations + bootstrap do admin) → `play`.

## 7. Primeiro mapa e primeiro login

1. `https://office.exemplo.com.br/map-storage/` — Basic auth com `MAP_STORAGE_AUTHENTICATION_USER/PASSWORD`. Suba o
   mapa do escritório (o trabalho em `maps/` do repositório, ou o
   [map starter kit](https://github.com/workadventure/map-starter-kit)).
2. Confirme que o `START_ROOM_URL` do `.env` bate com o caminho subido (`/~/maps/office.wam`); `docker compose up -d`
   de novo se mudou.
3. Abra `https://office.exemplo.com.br` numa janela anônima → login Microsoft → você está no escritório.
4. `https://office.exemplo.com.br/admin` → mesmo login → o dashboard, porque o bootstrap te concedeu `admin`.
5. Conceda as primeiras tags na aba Membros (`editor` libera o editor de mapas).

## 8. Coturn (vídeo através de redes corporativas)

O vídeo é peer-to-peer; o TURN é o relay para quem está atrás de NAT restritivo. No mesmo VPS:

```bash
sudo apt-get install -y coturn
```

`/etc/turnserver.conf` — mínimo, modo static-secret (gere mais um segredo):

```
listening-port=3478
tls-listening-port=5349
realm=office.exemplo.com.br
use-auth-secret
static-auth-secret=<openssl rand -base64 32>
cert=/caminho/para/fullchain.pem
pkey=/caminho/para/privkey.pem
no-multicast-peers
min-port=49152
max-port=49352
```

```bash
ufw allow 3478 && ufw allow 5349 && ufw allow 49152:49352/udp
sudo systemctl enable --now coturn
```

Depois no `.env`: `TURN_SERVER=turn:office.exemplo.com.br:3478`, `TURN_STATIC_AUTH_SECRET=<o segredo>`, e
`docker compose up -d`. (O TLS na 5349 pode reusar o certificado do Traefik em `${DATA_DIR}/letsencrypt/` — ou rode
só a 3478 primeiro e endureça depois; o static secret é a parte que não espera.)

## 9. Verificação

```bash
curl -s https://office.exemplo.com.br/map-storage/ -o /dev/null -w "%{http_code}\n"   # 401 (parede de auth = vivo)
docker compose exec admin-api npm run member:list                                      # seu e-mail, tag admin
docker compose logs play | grep -a "admin api"                                         # connection successful
```

Depois o checklist humano: logar, andar, encontrar alguém numa bolha (vídeo), editar o mapa com tag `editor`, banir
uma conta de teste pelo `/admin` → Moderação e vê-la sair e não conseguir voltar. As durações de sessão esperadas:
mundo 30 dias, dashboard 1 h deslizante / teto de 12 h.

## Backups

Três coisas guardam estado; todo o resto se reconstrói do repo:

| O quê | Onde | Como |
|---|---|---|
| Membros, tags, bans, denúncias, auditoria | volume `admin-api-db-data` | `pg_dump` noturno |
| Mapas | volume `map-storage-data` | tar noturno |
| Certificados | `${DATA_DIR}/letsencrypt/` | copiar junto do tar |

```bash
sudo tee /etc/cron.daily/virtualoffice-backup >/dev/null <<'EOF'
#!/bin/sh
set -e
STAMP=$(date +%F)
DIR=/var/backups/virtualoffice
mkdir -p "$DIR"
cd /home/deploy/virtualoffice/contrib/docker
docker compose exec -T admin-api-db pg_dump -U admin_api admin_api | gzip > "$DIR/admin-api-$STAMP.sql.gz"
docker run --rm -v docker_map-storage-data:/maps -v "$DIR":/backup alpine tar czf "/backup/maps-$STAMP.tar.gz" -C /maps .
find "$DIR" -mtime +14 -delete
EOF
sudo chmod +x /etc/cron.daily/virtualoffice-backup
```

(Ajuste o prefixo do volume ao que `docker volume ls` mostrar.) Os snapshots semanais de VPS da Hostinger são a
segunda camada, não um substituto — teste um restore uma vez antes de confiar em qualquer um dos dois.

## Atualizando

```bash
cd ~/virtualoffice && git pull
cd contrib/docker
docker compose build && docker compose up -d
```

As migrations rodam sozinhas antes de o `admin-api` abrir a porta. Forward-only: voltar o código é
`git checkout <tag>` + rebuild, mas o banco fica — nunca restaure um dump antigo por cima de um schema mais novo sem
ler a lista de migrations antes.

## Rollback e emergências

| Situação | Ação |
|---|---|
| Deploy ruim | `git checkout <último-bom>` → `docker compose build && docker compose up -d` |
| Suspeita de vazamento de credencial | rotacione o valor vazado no `.env` → `docker compose up -d`. Rotacionar o `SECRET_KEY` desloga **todo mundo** (esse é o ponto) |
| Admin trancado do lado de fora | `docker compose restart admin-api` — o bootstrap re-concede ao `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL` |
| Mundo fora do ar, causa desconhecida | `docker compose ps` + `docker compose logs play admin-api` — um `admin-api` morto pendura o `play` por desenho (ADR-0002, Armadilha #2) |

## Solução de problemas

| Sintoma | Causa e correção |
|---|---|
| Navegador reclama do certificado | DNS não tinha propagado quando o Traefik pediu, ou rate limit do Let's Encrypt. `docker compose restart reverse-proxy`; para tentativas repetidas, descomente antes a linha do CA de staging no compose. |
| `play` reinicia sem parar | `admin-api` não-saudável — `docker compose logs admin-api`. Geralmente um valor obrigatório faltando no `.env`; o log de subida o nomeia. |
| Login volta da Microsoft com erro | Redirect URI divergente (`AADSTS50011`) — o domínio do `.env` e o do app registration precisam bater byte a byte. |
| Câmera/microfone nunca são pedidos | Você não está em HTTPS. WebRTC exige; não existe modo HTTP. |
| Vídeo falha só para algumas pessoas | A rede delas bloqueia P2P — é para isso que existe o coturn da seção 8. |
| `/admin` responde 503 | Falta configuração do dashboard; `docker compose logs admin-api` nomeia a variável. |
| Build morre sem memória | Feche outras cargas, ou builde um serviço por vez: `docker compose build play` etc. 16 GB dão para o conjunto. |

## Custos

O plano do VPS é o custo recorrente inteiro. App registration do Entra é grátis; Let's Encrypt é grátis; o coturn
divide o mesmo VPS e o tráfego de relay cabe com folga nos 16 TB (trinta pessoas relayando continuamente seriam
~3-4 TB/mês, e a maior parte do tráfego nunca relaya).

## Referências

- [SETUP-CLOUDFLARE.pt-BR.md](SETUP-CLOUDFLARE.pt-BR.md) — colocar o proxy da Cloudflare na frente deste deploy
- [SETUP-CLOUD-AZURE.pt-BR.md](SETUP-CLOUD-AZURE.pt-BR.md) — o app registration, rotação, a tabela de AADSTS
- [SETUP-ADMIN-API.pt-BR.md](SETUP-ADMIN-API.pt-BR.md) — permissões, moderação, a CLI, recuperação de lockout
- [Modelo de ameaças](security/threat-model.pt-BR.md) — o checklist de go-live que a seção de segredos implementa
- [contrib/docker/README.md](../contrib/docker/README.md) — as notas de self-hosting do upstream sob este guia
