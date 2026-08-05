# Setup — produção atrás da Cloudflare

> **Propósito.** Colocar o proxy da Cloudflare na frente do deploy do VPS: WAF/DDoS na borda, IP de origem
> escondido, e opcionalmente uma segunda parede de autenticação no `/admin`. Quatro ajustes são obrigatórios; este
> guia passa por cada um.
> **Público.** Quem opera o servidor, depois de (ou junto com) o [SETUP-DEPLOY.pt-BR.md](SETUP-DEPLOY.pt-BR.md).
> **Custo.** O plano gratuito cobre tudo aqui, exceto onde marcado.
> **Idiomas.** Este arquivo (pt-BR) + [SETUP-CLOUDFLARE.md](SETUP-CLOUDFLARE.md) (en-US), em lockstep.

## O que passa pela Cloudflare, e o que nunca vai passar

| Tráfego | Pelo proxy? |
|---|---|
| Mundo, `/admin`, `/map-storage`, `/api` | ✅ HTTP normal |
| Websockets do pusher (`/ws/`) | ✅ proxiados em todo plano |
| Vídeo peer-to-peer entre navegadores | — nunca toca no servidor *nem* na Cloudflare |
| **TURN (coturn, portas 3478/5349/UDP)** | ❌ **o proxy só carrega portas HTTP** — é o ajuste #2 |
| Room API gRPC (50051) | ❌ não proxiável; mantenha fechada no firewall |

Tudo abaixo assume o layout de domínio único do guia de deploy (`office.exemplo.com.br`).

## Pré-requisitos

- O stack deployado (ou em deploy) conforme o [SETUP-DEPLOY.pt-BR.md](SETUP-DEPLOY.pt-BR.md).
- O domínio adicionado como site na Cloudflare, **nameservers trocados** no registrador, zona ativa.
- Cinco minutos de tolerância para propagação de DNS entre os passos.

## 1. Registros DNS — um laranja, um cinza

No painel de DNS da Cloudflare:

| Tipo | Nome | Conteúdo | Proxy |
|---|---|---|---|
| `A` | `office.exemplo.com.br` | IP do VPS | **Proxied** (nuvem laranja) |
| `A` | `turn` | IP do VPS | **DNS only** (nuvem cinza) |

O registro cinza não é opcional. O TURN fala protocolo próprio em portas próprias; atrás da nuvem laranja o
hostname resolve para bordas da Cloudflare, que não o encaminham — o vídeo falharia justamente para quem está em
rede restritiva, em silêncio. O registro cinza revela o IP do VPS a quem procurar; se esconder o origin importar,
o TURN é a peça a mover para um host barato separado depois.

## 2. Modo SSL — Full (strict), nunca Flexible

Painel da Cloudflare → SSL/TLS → Overview → **Full (strict)**.

O "Flexible" faz a Cloudflare falar HTTP puro com o origin; o Traefik responde toda requisição HTTP com redirect
para HTTPS, e os dois ficam se perseguindo num loop infinito de redirect. O Full (strict) exige certificado válido
no origin — que é o próximo passo.

## 3. Certificados no origin — trocar o Traefik de HTTP-01 para DNS-01

O padrão do guia de deploy usa o desafio HTTP na porta 80, que fica frágil atrás do proxy. O desafio DNS é imune a
isso (e continua funcionando mesmo com o proxy desligado depois).

Crie o token: painel da Cloudflare → My Profile → API Tokens → Create Token → template **Edit zone DNS** → limitado
a esta zona. Adicione ao `contrib/docker/.env`:

```dotenv
CF_DNS_API_TOKEN=<o token>
```

No `contrib/docker/docker-compose.yaml` (sua cópia renomeada do `docker-compose.prod.yaml`), troque a linha do
desafio no bloco `command` do `reverse-proxy`:

```yaml
      # HTTP challenge                                           # ── REMOVA este par ──
      - --certificatesresolvers.myresolver.acme.httpchallenge.entrypoint=web

      # DNS challenge (Cloudflare)                               # ── ADICIONE este par ──
      - --certificatesresolvers.myresolver.acme.dnschallenge.provider=cloudflare
      - --certificatesresolvers.myresolver.acme.dnschallenge.resolvers=1.1.1.1:53
```

e entregue o token ao container, no mesmo serviço:

```yaml
    environment:
      CF_DNS_API_TOKEN: "${CF_DNS_API_TOKEN}"
```

Depois `docker compose up -d reverse-proxy`. (A alternativa — um **Origin Certificate** da Cloudflare montado no
Traefik — também satisfaz o Full (strict), mas só é confiado pela Cloudflare, então o hostname cinza do TURN e
qualquer rollback sem proxy precisariam de certificados próprios. O DNS-01 cobre todos os casos com um mecanismo
só.)

## 4. IPs reais dos clientes — ensinar o Traefik a confiar na Cloudflare

Atrás do proxy, o Traefik enxerga endereços da Cloudflare, então o limitador de taxa do login do dashboard
agruparia o escritório inteiro em meia dúzia de IPs. Adicione ao bloco `command` do `reverse-proxy` (as duas
entradas):

```yaml
      - --entryPoints.web.forwardedHeaders.trustedIPs=173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32
      - --entryPoints.websecure.forwardedHeaders.trustedIPs=173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32
```

As faixas são publicadas em <https://www.cloudflare.com/ips/> — mudam raramente; reconfira quando a Cloudflare
anunciar mudanças. O `ADMIN_API_TRUST_PROXY=1` (já o padrão) faz o resto.

## 5. TURN — apontar para o hostname cinza

No `.env`:

```dotenv
TURN_SERVER=turn:turn.office.exemplo.com.br:3478
TURN_STATIC_AUTH_SECRET=<o segredo da seção de coturn do guia de deploy>
```

`realm=turn.office.exemplo.com.br` no `/etc/turnserver.conf` para bater. `docker compose up -d` para reler.

## 6. Opcional — restringir as portas 80/443 só à Cloudflare

Com o proxy na frente, nada legítimo chega direto nessas portas. Fechá-las para o mundo esconde o origin de
scanners:

```bash
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do sudo ufw allow from $ip to any port 80,443 proto tcp; done
for ip in $(curl -s https://www.cloudflare.com/ips-v6); do sudo ufw allow from $ip to any port 80,443 proto tcp; done
sudo ufw delete allow 80/tcp && sudo ufw delete allow 443/tcp
```

As portas do TURN (3478, 5349, 49152–49352/udp) ficam abertas para todos — esse tráfego não vem pela Cloudflare.
Pule este passo até todo o resto estar verificado: ele impossibilita depurar com `curl` da sua máquina.

## 7. Opcional — Cloudflare Access na frente do `/admin` (defesa em profundidade)

Painel Zero Trust → Access → Applications → Add → Self-hosted:

- Application domain: `office.exemplo.com.br`, path `admin`
- Policy: permitir os e-mails da empresa (ou o próprio Entra ID como provedor de identidade do Access)

Requisições a `/admin*` passam a autenticar na borda **antes** de chegar à barreira de sessão do próprio dashboard.
Duas paredes, donos diferentes. O login do dashboard continua igual atrás dela. (O plano gratuito cobre até 50
usuários.)

## Verificação

```bash
dig +short office.exemplo.com.br          # IPs da Cloudflare (104.x/172.x...), NÃO o VPS
dig +short turn.office.exemplo.com.br     # o IP do VPS, exatamente
curl -sI https://office.exemplo.com.br | grep -iE "server|cf-ray"   # server: cloudflare + um id cf-ray
```

Depois os checks humanos: logar pelo Entra (inalterado), encontrar alguém numa bolha, e — o que prova o ajuste #5 —
alguém numa rede restritiva (hotspot com VPN, Wi-Fi corporativo) conseguir vídeo. No `chrome://webrtc-internals` a
conexão dessa pessoa deve mostrar um candidato `relay` nomeando `turn.office.exemplo.com.br`. Por fim,
`docker compose logs admin-api | grep "login"` depois de um login recusado: o IP logado tem que ser o real da
pessoa, não uma faixa da Cloudflare — isso é o ajuste #4 funcionando.

## Solução de problemas

| Sintoma | Causa e correção |
|---|---|
| Loop infinito de redirect | Modo SSL em Flexible. Mude para Full (strict). |
| Erros de certificado depois da troca | O DNS-01 não emitiu: token sem Zone DNS Edit nesta zona, ou `CF_DNS_API_TOKEN` não chegando ao container (`docker compose logs reverse-proxy | grep -i acme`). |
| Vídeo quebrado só em redes restritivas | O registro `turn` ficou laranja, ou o `TURN_SERVER` ainda aponta para o domínio principal. `dig` nele: tem que responder o IP do VPS. |
| Limitador de login disparando para todo mundo | Falta o ajuste #4 — o Traefik está reportando IP da Cloudflare para todo visitante. |
| Upload de mapa morre em ~100 s | Timeout do proxy no plano gratuito. Suba de uma máquina perto do servidor, divida o mapa, ou deixe o registro cinza temporariamente para o upload. |
| Tudo fora do ar depois do passo 6 | O loop do UFW rodou depois do `ufw delete` — a ordem importa; rode os allows de novo, depois os deletes. |

## Voltando atrás

Mude o registro principal para **DNS only** (cinza) e o tráfego volta direto ao VPS — os certificados DNS-01
continuam valendo, nada mais a desfazer. Esse é o rollback inteiro, reversível em um clique.

## Referências

- [SETUP-DEPLOY.pt-BR.md](SETUP-DEPLOY.pt-BR.md) — o deploy na frente do qual isto fica
- [Faixas de IP da Cloudflare](https://www.cloudflare.com/ips/) — fonte de atualização do ajuste #4 e do passo 6
- [Traefik DNS-01 com Cloudflare](https://doc.traefik.io/traefik/https/acme/#dnschallenge) — as opções do resolver
- [Modelo de ameaças](security/threat-model.pt-BR.md) — onde entram o origin escondido e a defesa em profundidade do `/admin`
