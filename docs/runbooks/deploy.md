# Runbook — Deploy em produção (VPS)

O caminho normal de deploy **não constrói nada na VPS**: o CI publica a imagem no
GHCR e a VPS só puxa. Construir localmente é exceção de emergência, e tem custo —
está documentado no fim.

---

## 1. O comando

```bash
cd /var/www/crm
docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d app
```

### Os DOIS `-f` são obrigatórios. Sempre.

Esta é a pegadinha que já derrubou o site inteiro em produção (2026-08-05).

A VPS (Hostinger) vem com um **Traefik próprio** ocupando as portas 80/443.
`docker-compose.traefik.yml` é o ÚNICO lugar que:

- coloca no contêiner `app` as labels de roteamento
  (`traefik.http.routers.deskcomm.rule=Host(...)`);
- associa o contêiner à rede que o Traefik enxerga (`TRAEFIK_DOCKER_NETWORK`);
- desliga o `caddy` do compose base por profile (senão dois processos brigam
  pela mesma porta).

Rodar só com `-f docker-compose.prod.yml` recria o contêiner **sem labels
nenhuma**. O Traefik deixa de enxergá-lo e o domínio inteiro passa a responder
`404 page not found` — não é erro do Next, é o 404 genérico do Traefik. A app
está no ar, saudável, e inalcançável.

---

## 2. Verificação pós-deploy (não pule)

`healthy` no `docker ps` **não prova que o site está acessível** — o healthcheck
é um probe TCP interno e passa mesmo com o roteamento quebrado. Verifique as
duas coisas:

```bash
# 1) as labels do Traefik existem?
#    O nome do contêiner é <pasta-do-projeto>-app-1, então pergunte ao compose
#    em vez de chutar. Aqui um -f só basta: o `ps -q` resolve pelo nome do
#    projeto + serviço, não pelo conteúdo do arquivo (medido: com um -f ou com
#    os dois, devolve o MESMO contêiner). Quem precisa dos dois é o `up -d`.
docker inspect "$(docker compose -f docker-compose.prod.yml ps -q app)" \
  --format '{{.Config.Labels}}' | grep -o 'traefik.enable:[^ ]*'
# esperado: traefik.enable:true   (vazio = roteamento quebrado)

# 2) o domínio responde?
curl -s -o /dev/null -w "%{http_code}\n" https://<DOMAIN>/
# esperado: 200 (a página inicial pública; 307 para quem já tem sessão)
# 404      = labels perdidas, refaça o deploy com os dois -f
curl -s -o /dev/null -w '%{http_code}\n' https://<DOMAIN>/app
# esperado: 307 (para /login) — o sinal de que quem responde é o app, e não
#           outra coisa no domínio que também daria 200 em /
```

---

## 3. Fluxo completo (do código à produção)

### Modo rápido do fork de testes

No repositório `cleitonlorentzcardoso-ops/imobixcrm`, o workflow `release`
faz o merge do PR de release automaticamente por padrão para versões patch e
minor. Isso elimina a espera de uma segunda rodada de CI para um PR que só
altera `CHANGELOG.md` e `.changes/`. Esses arquivos também não disparam CI,
E2E, medição de bundle nem a imagem `latest` quando são as únicas mudanças.
A tag de versão **continua** a construir as quatro imagens no GitHub; o deploy
da VPS continua esperando as imagens, fazendo backup, executando `update.sh`
e conferindo a saúde do CRM. A validação funcional detalhada fica para o CRM
atualizado, como combinado para esta fase de testes.

Para revisar o PR de release manualmente, rode `release` com
`publicar_rapido: false`; releases major e versões que exigem alguma ação do
operador nunca recebem merge automático.
Esse modo rápido depende de a branch `main` do fork não ter verificações
obrigatórias para esse PR. Se essas regras forem ativadas, reavalie os filtros
de caminhos antes de publicar: um workflow ignorado por filtro pode deixar
uma verificação obrigatória pendente.

```
commit → push → PR → merge na main → CI publica imagem → VPS puxa
```

1. **Commit + push** numa branch de feature. Trabalho que fica só no disco da
   VPS não existe: o CI não o vê, some se a VPS for reconstruída, e é invisível
   pra qualquer outra pessoa.
2. **PR e merge na `main`.** `publish-image.yml` dispara em push na `main` (ou
   tag `v*`) e publica **três** imagens — `deskcommcrm`, `deskcomm-worker` e
   `deskcomm-scheduler` — sempre na mesma versão. O build pesado roda nos
   runners do GitHub, nunca na VPS do usuário.
3. **Deploy na VPS.** Numa instalação real isto é `bash hostgator-setup-kit/update.sh`,
   não um `up -d` na mão: ele puxa a tag publicada, re-aplica o `baseline.sql`,
   faz backup antes e grava as três imagens no `.env`.

> **`latest` não é a última release.** Ele é publicado a partir da branch default, então
> segue o **topo da `main`** — código ainda não lançado. Quem quer a última release usa
> `stable`; quem opera um cliente usa o número da versão. Ver
> [`../doctrine/packaging.md`](../doctrine/packaging.md).

### Deploy automático da VPS mantida pelo projeto

Uma VPS administrada por este repositório pode receber a release assim que ela é
publicada. O workflow [`deploy-vps.yml`](../../.github/workflows/deploy-vps.yml)
espera as quatro imagens daquela versão no GHCR e executa o mesmo `update.sh`
oficial, apontado para a tag da release; portanto não há build no servidor e
não existe o risco de ele puxar o topo intermediário da `main`.

Antes da primeira release, cadastre estes **Actions secrets** do repositório em
**Settings → Secrets and variables → Actions**:

| Secret | Valor |
|---|---|
| `VPS_SSH_HOST` | IP ou hostname da VPS |
| `VPS_SSH_PORT` | porta SSH (normalmente `22`) |
| `VPS_SSH_USER` | usuário dedicado ao deploy, com acesso ao Docker |
| `VPS_SSH_PRIVATE_KEY` | chave privada ED25519 desse usuário |
| `VPS_SSH_KNOWN_HOSTS` | linha de host público do servidor, já conferida por fingerprint |
| `VPS_PUBLIC_URL` | URL HTTPS pública do CRM, por exemplo `https://crm.exemplo.com.br` |

Não use senha SSH nem desligue a verificação de host. A chave pública correspondente
à `VPS_SSH_PRIVATE_KEY` deve entrar em `~/.ssh/authorized_keys` do usuário de deploy;
ele precisa pertencer ao grupo `docker`. Como a instalação pode ficar sob `/root`, o
usuário recebe apenas permissão para executar o wrapper abaixo — não acesso de leitura
ao diretório raiz nem `sudo` genérico. Ajuste `/root/deskcommcrm` se o clone estiver em
outro local e execute, uma única vez, como `root` na VPS:

```bash
install -d -m 755 /usr/local/sbin
cat >/usr/local/sbin/imobixcrm-deploy <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
release_tag="${1:?informe a tag vX.Y.Z}"
[[ "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]] || {
  echo "tag de release invalida" >&2
  exit 2
}
cd -- /root/deskcommcrm
bash hostgator-setup-kit/update.sh --to "$release_tag"
bash hostgator-setup-kit/healthcheck.sh
EOF
chown root:root /usr/local/sbin/imobixcrm-deploy
chmod 750 /usr/local/sbin/imobixcrm-deploy
printf '%s\n' 'github-deploy ALL=(root) NOPASSWD: /usr/local/sbin/imobixcrm-deploy' \
  >/etc/sudoers.d/github-deploy-imobixcrm
chmod 440 /etc/sudoers.d/github-deploy-imobixcrm
visudo -cf /etc/sudoers.d/github-deploy-imobixcrm
```

Para preencher `VPS_SSH_KNOWN_HOSTS`, obtenha a chave pública do host por um canal que
você já confia e confira o fingerprint antes de salvá-la. O workflow recusa chave
ausente, host desconhecido, tag fora de `vX.Y.Z`, update que falhe ou domínio que não
responda `200` em `/` e `307` em `/app`.

---

## 4. Exceção: imagem construída na VPS

Só quando é preciso validar algo em produção **antes** de a imagem oficial
existir (ex.: CI ainda rodando e um bug bloqueando o usuário).

```bash
APP_IMAGE=deskcomm-app:local docker compose \
  -f docker-compose.prod.yml -f docker-compose.build.yml --env-file .env build app

APP_IMAGE=deskcomm-app:local APP_PULL_POLICY=never docker compose \
  -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d app
```

O `docker-compose.build.yml` também cobre `worker` e `scheduler` — troque
`app` pelo serviço que você precisa construir. Eles têm `build:` no próprio
compose de produção (é o escape que faz a instalação sobreviver a um registry
fora do ar), mas é o override que traz o `pull_policy: never`; sem ele o
`up -d` volta a buscar a imagem publicada.

**Isto é dívida, não um caminho paralelo.** A imagem existe só no disco daquela
VPS: não está no registry, não está no git, e qualquer `docker compose up -d`
sem `APP_PULL_POLICY=never` a substitui pela do GHCR — silenciosamente, sem erro
nenhum, revertendo o que você acabou de subir.

Requisitos: >= 4 GB de RAM **ou** swap (medido: ~4min num VPS de 3.8 GB com 4 GB
de swap) — e isto é o requisito **deste caminho de exceção**, não da operação
normal. A régua de operação é outra, e não mudou. Ela tem três parcelas, e **duas
são medidas e uma é herdada** — a distinção importa porque a herdada é a que
costuma ser citada como se fosse nossa:

| parcela | estado | como conferir |
|---|---|---|
| 7 contêineres | **medido** | `docker compose -f docker-compose.prod.yml config --services \| wc -l` |
| `mem_limit` somando 2560m (app 768 + worker 512 + waha 1280) | **medido** | `grep -n 'mem_limit' docker-compose.prod.yml` |
| ~150 MB por número de WhatsApp | **herdado do upstream WAHA**, nunca medido neste projeto | `docker stats --no-stream` na sua VPS |

O terceiro número vem de `docs/research/reference-synthesis.md` (síntese do curso
WAHA, 2026-05), não de uma medição nossa — e circula em sete documentos que se
citam entre si. Uma medição pontual na produção do projeto (2026-08-14, **uma**
sessão pareada, VPS compartilhada com outras stacks) deu **304,5 MiB no contêiner
`waha` inteiro**, contra o `mem_limit` de 1280 MiB. Um ponto não decompõe baseline
e sessão: para isso seriam necessários dois números pareados, e não é ensaio que
se faça numa instalação viva.

**Nada disso mexe no tier recomendado.** A régua que sustenta os 4 GB é a soma da
stack em operação, não o WAHA isolado — e a folga existe justamente porque a
parcela por sessão não é conhecida com precisão.

Ao terminar, feche o ciclo — merge na `main` e volte a VPS pra imagem oficial.
