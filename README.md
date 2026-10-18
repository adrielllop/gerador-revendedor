# Keydesk — painel de keys para revendedores

Aplicação web local para o proprietário criar revendedores, administrar créditos e prefixos, e para os revendedores gerar e copiar keys. O prefixo padrão de novos revendedores é **GoldCheats**; prefixos personalizados já cadastrados não são alterados.

## O que está implementado

- A tela de entrada permite criar cadastro público somente de revendedor: cada cadastro exige usuário e senha próprios, inicia com 0 créditos e nunca recebe a função de acesso principal. Contas de revendedor também podem ser criadas pela área de gestão. O acesso principal continua separado e não aparece no cadastro público.
- No formulário de login, revendedores informam usuário e senha. O acesso principal usa o campo usuário vazio e a senha configurada em `OWNER_PASSWORD`; hashes e senha não são enviados ao navegador.
- Em hospedagem de produção, configure `OWNER_PASSWORD` no painel da hospedagem; a configuração inicial do acesso principal não é aberta ao público. O acesso principal entra com o campo usuário vazio. O cadastro público da tela inicial cria exclusivamente um revendedor com saldo zero, nunca o acesso principal.
- A tela de login oferece a opção de lembrar o acesso neste dispositivo: o usuário é lembrado localmente e, em navegadores compatíveis, a senha é entregue ao gerenciador de senhas nativo. O painel não grava a senha em texto simples no armazenamento do site. A aba de keys também tem um botão para recarregar a lista e consultar novamente os status atuais no Firebase.
- Contas de revendedor com senha em hash, saldo de créditos e prefixo próprio (por padrão, GoldCheats). O dono pode remover o acesso: o login é bloqueado, a conta sai da lista, o saldo restante fica arquivado e as keys emitidas continuam no Firebase e no histórico. O nome de usuário fica livre para ser cadastrado novamente.
- O revendedor libera seu prefixo personalizado por 5 créditos uma única vez; esse direito fica salvo permanentemente na conta e não há cobrança por key. Depois da liberação, cada modificação custa 2 créditos. O prefixo atual é usado nas próximas keys (as já geradas não mudam), e um prefixo já usado por outra conta não pode ser escolhido.
- O proprietário pode adicionar/remover créditos, editar prefixos e gerir todas as keys. O revendedor pode pausar/retomar, resetar o vínculo ou excluir somente as próprias keys; nenhuma dessas ações altera créditos. Pausar bloqueia a key no app, mas a validade continua correndo. Resetar limpa somente os identificadores do dispositivo conectado: mantém a ativação e `expiresAt`, então o prazo continua correndo mesmo sem dispositivo e não reinicia quando outro aparelho se vincula. A interface de revendedor não exibe caminho, conexão ou contagem do Realtime Database, nem totais agregados de keys; continua mostrando as próprias keys necessárias para copiá-las e gerenciá-las.
- Formato do app de referência: prefixo normalizado para maiúsculas e somente letras/números, hífen e 6 caracteres aleatórios de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sem caracteres ambíguos).
- Preços aplicados: 1 hora = 1 crédito; 1 dia = 2,5 créditos; 3 dias = 3,5 créditos; 7 dias = 7 créditos; 15 dias = 10 créditos; 30 dias = 15 créditos. Cada duração selecionada é gravada no Firebase e o custo é debitado no saldo do revendedor.
- Revendedores podem abrir a aba **Recargas**, escolher quantos créditos comprar e pagar via Pix pelo BotaPix. O preço é R$ 1,00 por crédito comprado; a cada 10 créditos pagos, 1 crédito extra é concedido como brinde (por exemplo, 20 pagos = 22 no saldo). O saldo só entra após confirmação do pagamento.
- A geração usa PATCH em lote no endpoint `proxyAndroid/keys.json`. A key nova é gravada com `status: "pending"`, sem dispositivo, `activatedAt: 0` e `activationStarted: false`. No primeiro vínculo, o Worker/aplicativo marca a key como ativa e inicia o prazo completo como `agora + duração`; antes disso, a key permanece pendente e a contagem não começa.
- Banco SQLite em WebAssembly salvo em `data/app.sqlite`, sem módulos nativos para compilar no Android; segredo de sessão aleatório em `data/session-secret`.
- No Termux, a sessão de login fica na memória e será encerrada se o processo do painel parar; as contas e keys continuam salvas no arquivo SQLite.

## Requisitos

- Node.js 20 ou superior e npm. No Android, use Termux oficial e o instalador incluído.

## Instalar e iniciar

### Android (Termux)

1. Instale Termux pela [página oficial do F-Droid](https://f-droid.org/packages/com.termux/) ou pelos [releases oficiais no GitHub](https://github.com/termux/termux-app/releases). Não instale APKs de terceiros nem misture versões de origens diferentes.
2. Abra o Termux e execute:

   ```bash
   pkg update -y && pkg upgrade -y
   pkg install nodejs-lts unzip tmux termux-api -y
   termux-setup-storage
   ```

   Autorize o acesso a arquivos quando o Android solicitar.
3. Baixe `keydesk-revendedores-logo-temas-ranking-v28.zip` para Downloads e extraia. O ZIP já tem os arquivos na raiz, sem uma pasta `key-reseller-panel` envolvendo tudo:

   ```bash
   mkdir -p ~/keydesk-v14
   if [ -d ~/keydesk/key-reseller-panel/data ]; then mkdir -p ~/keydesk-v14/data && cp -an ~/keydesk/key-reseller-panel/data/. ~/keydesk-v14/data/; fi
   unzip -o ~/storage/downloads/keydesk-revendedores-logo-temas-ranking-v28.zip -d ~/keydesk-v14
   cd ~/keydesk-v14
   ```

4. Inicie o painel e o túnel em segundo plano:

   ```bash
   bash SERVICO_24H.sh start
   ```

5. O comando imprime o link público quando o túnel conectar. No mesmo celular, o painel continua disponível em `http://127.0.0.1:3000`. Os arquivos da interface ficam na raiz; abrir `index.html` diretamente não executa o servidor.

### Controle do serviço em segundo plano

O gerenciador cria sessões destacadas do `tmux` para o painel e o túnel, e tenta reiniciar cada processo se ele sair. Use estes comandos na pasta `~/keydesk-v14`:

```bash
bash SERVICO_24H.sh status
bash SERVICO_24H.sh logs
bash SERVICO_24H.sh stop
```

Para manter a CPU acordada, instale também o app complementar [Termux:API](https://f-droid.org/packages/com.termux.api/) pela mesma origem usada para instalar Termux; o pacote de comandos (`termux-api`) já é incluído no comando de instalação acima. O iniciador solicita `termux-wake-lock` quando disponível. Isso aumenta o consumo de bateria; mantenha o aparelho ligado à energia.

No Android, permita atividade em segundo plano e defina Termux e Termux:Boot como **Sem restrições/Unrestricted** na bateria (o nome varia por fabricante). Para reiniciar o serviço após reiniciar o celular, instale e abra uma vez o [Termux:Boot](https://github.com/termux/termux-boot), depois execute:

```bash
bash SERVICO_24H.sh install-boot
```

O `127.0.0.1` só abre no próprio celular; compartilhe o link `https://…loca.lt` mostrado pelo serviço. Ele pode mudar se o túnel reiniciar. O LocalTunnel pode exibir a tela de confirmação de IP para cada visitante; isso é do serviço de túnel, não do painel. Qualquer pessoa com o link pode chegar à tela de login, então compartilhe-o apenas com os revendedores autorizados.

**Limite importante:** `tmux`, wakelock e Termux:Boot reduzem interrupções, mas não garantem 24/7. O Android/fabricante ainda pode encerrar Termux; desligamento, reinicialização ou perda de internet também derrubam o link. Para disponibilidade realmente contínua, o painel precisa rodar em uma hospedagem/servidor sempre ativo.

### Windows, Linux ou macOS

1. Extraia o ZIP.
2. No **Windows Terminal/PowerShell**, na pasta extraída, execute `powershell -ExecutionPolicy Bypass -File .\INICIAR_NO_WINDOWS_TERMINAL.ps1` (Node.js 20+). O script abre o servidor em outra janela e inicia o LocalTunnel na janela atual; compartilhe o endereço `https://…loca.lt` exibido. Esse endereço temporário pode mudar quando o túnel reiniciar. Como alternativa, o `INICIAR_NO_WINDOWS.bat` inicia somente o painel local. No Linux/macOS, execute `./INICIAR_NO_LINUX_MAC.sh`. Ou, em um terminal na pasta do projeto:

   ```bash
   npm install
   npm start
   ```

3. Mantenha o servidor aberto e acesse `http://127.0.0.1:3000`. Não abra `index.html` diretamente.
4. Se `OWNER_PASSWORD` não estiver configurada, no primeiro acesso defina a senha-mestra do dono. Depois, na tela normal, revendedores informam usuário e senha; o dono deixa usuário vazio e informa a senha-mestra.
5. Na aba **Revendedores**, crie os acessos, créditos e prefixos.

A senha do proprietário não está embutida no código, JavaScript, HTML ou ZIP nem é exibida pelo site; somente o hash fica no arquivo de autenticação do servidor. Cada conta de revendedor deve ter uma senha exclusiva. O dono pode redefinir a senha de qualquer revendedor na lista de contas, sem consultar a senha anterior.

## Publicar o código no GitHub

O GitHub pode guardar o código-fonte, mas **não executa este painel Node.js**. O GitHub Pages serve páginas estáticas e não hospeda o servidor Express, o banco SQLite nem o túnel. Para deixar o painel acessível sem Termux, publique o repositório e conecte-o a um serviço de hospedagem que execute Node.js (comando de instalação `npm install`, comando de início `npm start`).

O pacote é plano: painel e Worker ficam na raiz, sem subpastas de código. `worker-index.mjs`, `worker-license.test.mjs` e `wrangler.toml` correspondem ao Worker Android/Firebase; `server.js`, `app.js` e `render.yaml` correspondem ao painel Render. Ao iniciar, o painel cria `data/` automaticamente para armazenar o banco e a autenticação local.

Ao configurar uma hospedagem HTTPS, configure `HOST=0.0.0.0`, deixe a plataforma fornecer `PORT` e use `COOKIE_SECURE=true`. Como o painel salva contas e créditos em `data/app.sqlite`, o serviço precisa oferecer armazenamento persistente montado para a pasta `data/`; em sistemas de arquivos temporários, esses dados podem ser perdidos em reinícios ou novas implantações. Configure secrets/variáveis privadas no painel da hospedagem, nunca no repositório. Não envie `.env` nem conteúdo de `data/`; o `.gitignore` do projeto os exclui.

Para habilitar recargas, configure `BOTAPIX_API_KEY` com a API key privada fornecida pelo BotaPix, `BOTAPIX_WEBHOOK_SECRET` com o segredo de webhook da conta e `PUBLIC_URL` com a URL HTTPS pública do painel. No Dashboard do BotaPix, cadastre `https://SEU-DOMINIO/api/botapix/webhook` como endpoint de webhook. As chaves nunca são enviadas ao navegador nem incluídas neste ZIP. O endpoint valida `X-BotaPix-Signature`, descarta eventos repetidos e libera o crédito apenas em `payment.confirmed`. Quando o pagador retorna à loja em `/?recharge=<id>`, o painel consulta a cobrança no BotaPix por até 40 segundos e continua atualizando recargas pendentes; a navegação de retorno não é tratada como confirmação de pagamento.

### Lista completa das variáveis do painel (Render)

O `render.yaml` já declara as opções abaixo. No Render, abra o serviço → **Environment**. Os valores sensíveis marcados como Secret devem ser preenchidos somente nesse painel, nunca no GitHub ou em um `.env` enviado.

| Variável | O que colocar | Observação |
|---|---|---|
| `NODE_ENV` | `production` | Já definido pelo Blueprint. |
| `HOST` | `0.0.0.0` | Já definido pelo Blueprint para o Render. |
| `PORT` | Não preencher | O Render injeta a porta automaticamente. |
| `COOKIE_SECURE` | `true` | Já definido; necessário para cookies HTTPS. |
| `SESSION_SECRET` | Valor aleatório forte | O Render gera automaticamente pelo Blueprint; não precisa inventar um. |
| `OWNER_PASSWORD` | Sua senha de acesso | O Blueprint pede que você preencha em privado. Não compartilhe. |
| `FIREBASE_DATABASE_URL` | `https://gerador-goldxits-default-rtdb.firebaseio.com` | URL-base pública do Realtime Database. |
| `FIREBASE_DATABASE_PATH` | `proxyAndroid/keys` | Caminho das keys. |
| `FIREBASE_CLIENT_EMAIL` | Campo `client_email` da conta de serviço Firebase | Secret. Use a mesma conta de serviço já configurada no Worker. |
| `FIREBASE_PRIVATE_KEY` | Campo `private_key` completo da mesma conta | Secret. Copie o valor inteiro, incluindo as linhas BEGIN/END; nunca publique no GitHub. |
| `FIREBASE_AUTH_TOKEN` | Deixe vazio quando usar a conta de serviço acima | Fallback legado para ID token/secret RTDB compatível; ID tokens expiram. Não use uma API key nem a chave privada neste campo. |
| `BOTAPIX_API_BASE` | `https://botapix.com/api/v1` | Já definido; mantenha o padrão salvo indicação diferente do provedor. |
| `BOTAPIX_API_KEY` | API key privada BotaPix | Secret privado. Se já foi compartilhado fora do painel seguro, gere outra. |
| `BOTAPIX_WEBHOOK_SECRET` | Segredo de assinatura do webhook BotaPix | Secret privado; configure o mesmo valor no provedor. |
| `PUBLIC_URL` | URL HTTPS pública deste serviço, sem barra final | Para o serviço atual use `https://gerador-revendedor.onrender.com`; o webhook fica em `/api/botapix/webhook`. |

### Variáveis do Cloudflare Worker (arquivos na raiz)

O `wrangler.toml` na raiz declara `FIREBASE_DATABASE_URL` e `FIREBASE_DATABASE_PATH`. Para os valores secretos, configure Cloudflare Worker → **Settings → Variables and Secrets** como **Secret**:

| Nome | O que colocar |
|---|---|
| `FIREBASE_CLIENT_EMAIL` | `client_email` da conta de serviço dedicada do Firebase. |
| `FIREBASE_PRIVATE_KEY` | `private_key` completo da mesma conta de serviço. |
| `LICENSE_RATE_LIMITER` | Binding técnico de limite de tentativas; já configurado no Worker, não é campo de texto. |

Nunca publique JSON da conta de serviço, `private_key` ou valores preenchidos em `.dev.vars`. O modelo `.dev.vars.example` tem apenas campos vazios para uso local e `.dev.vars` está ignorado pelo Git.

Para testar e publicar o Worker a partir desta mesma raiz, execute `npm ci`, `npm run check:worker`, `npm run test:worker`, `npx wrangler login`, cadastre os secrets com `npx wrangler secret put FIREBASE_CLIENT_EMAIL` e `npx wrangler secret put FIREBASE_PRIVATE_KEY`, e publique com `npm run deploy:worker`. A publicação atualiza o Worker chamado `draco-license-bridge` na conta Cloudflare conectada.

### Render (plano gratuito, para teste)

O arquivo `render.yaml` configura um serviço Node.js gratuito e solicita `OWNER_PASSWORD` como variável privada durante a configuração do Blueprint. Informe a senha que você já configurou. Depois do deploy, acesse o endereço `*.onrender.com`. A tela pública de acesso mostra apenas os campos Usuário e Senha; para a conta vinculada a `OWNER_PASSWORD`, deixe Usuário vazio e informe somente a senha configurada.

Para atualizar um serviço Render que já existe, substitua os arquivos do repositório GitHub pelos do ZIP (mantenha todos no diretório raiz), faça commit e use **Manual Deploy → Deploy latest commit** se não iniciar automaticamente. Não crie outro serviço para esta atualização. Em **Environment**, mantenha `OWNER_PASSWORD` com a senha já configurada e preencha `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` com os campos da conta de serviço Firebase. Não coloque senhas nem chaves privadas no GitHub. Para entrar na conta vinculada à senha `OWNER_PASSWORD`, deixe Usuário vazio e informe somente a senha; os demais acessos usam usuário e senha.

**Limitações importantes:** o serviço gratuito pode dormir após 15 minutos sem acessos e demorar cerca de um minuto para voltar. Ele não oferece disco persistente: `data/app.sqlite` pode ser perdido, incluindo contas e créditos. Se `data/owner-auth.json` for apagado, `OWNER_PASSWORD` privada recria o hash do dono no próximo início; contas e créditos não são restaurados por essa variável. As keys já enviadas ao Firebase ficam no Firebase. Use o plano grátis apenas para testes com dados fictícios.

Fontes oficiais do Render: [serviços gratuitos](https://render.com/docs/free), [Blueprints](https://render.com/docs/blueprint-spec) e [variáveis de ambiente](https://render.com/docs/configure-environment-variables).

## Acesso por outros dispositivos / hospedagem

Por padrão, o servidor escuta somente em `127.0.0.1`, evitando exposição acidental. O LocalTunnel descrito acima cria um link HTTPS temporário encaminhado ao celular; ele funciona somente enquanto o painel, o túnel e o Termux estiverem ativos. Para uma rede privada confiável, copie `.env.example` para `.env`, ajuste `HOST=0.0.0.0` e use firewall/rede confiável. Para um endereço permanente, configure hospedagem HTTPS independente, `COOKIE_SECURE=true`, domínio e proteção dos dados/backups; não exponha o painel diretamente sem HTTPS e controles adequados.

## Firebase e segurança

A comunicação com o Realtime Database é feita pelo servidor, não pelo navegador. O painel obtém e renova em memória um token OAuth2 do Google usando `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY`, e envia esse token no cabeçalho `Authorization: Bearer`. Use os valores da mesma conta de serviço Firebase configurada no Worker, com permissão para acessar esse banco. Não coloque o JSON ou a chave privada no GitHub, `.env` versionado, frontend ou chat. Com a conta de serviço configurada, deixe `FIREBASE_AUTH_TOKEN` vazio. Não abra regras de leitura/escrita publicamente; o token de servidor é usado para operações administrativas da aplicação. O fallback `FIREBASE_AUTH_TOKEN` só serve para um Firebase ID token ou secret RTDB compatível, e tokens de usuário podem expirar. As senhas do painel não foram copiadas do JavaScript de referência.

## Backup e restauração

Para preservar cadastros, pare o servidor e faça cópia da pasta `data/` (incluindo `app.sqlite`, `owner-auth.json` e `session-secret`). Não envie `data/` ou `.env` publicamente.

## Atualizar instalação no Termux

O ZIP v23 extrai direto na raiz e preserva `data/`. Para atualizar a instalação existente, pare o serviço, faça um backup local dos dados, extraia o ZIP e inicie novamente:

```bash
mkdir -p ~/keydesk-v14
cd ~/keydesk-v14
bash SERVICO_24H.sh stop
cp -a data ~/keydesk-data-backup-$(date +%Y%m%d-%H%M%S)
   unzip -o ~/storage/downloads/keydesk-revendedores-logo-temas-ranking-v28.zip -d ~/keydesk-v14
pkg install nodejs-lts unzip tmux termux-api -y
bash SERVICO_24H.sh start
```

Se o navegador usar arquivos antigos, atualize a página ou limpe o cache. A integração usa o mesmo PATCH em lote do app de referência no path `proxyAndroid/keys`; a interface exibe o path e a quantidade de registros lidos. O formato e a tabela de créditos já foram incorporados.


## Atualização: auditoria, ranking e histórico de recargas

- A logo Keydesk compartilhada pelo usuário está no arquivo `keydesk-logo.png` na raiz e aparece na tela de entrada e no painel. Há um botão para alternar entre temas claro e escuro; a preferência fica salva neste navegador. O ranking de recargas confirmadas agora também tem uma aba própria **Ranking** na navegação do proprietário.

- A versão visual v27 usa uma direção premium consistente em toda a interface (login, navegação escura, painéis, cartões, tabelas e formulários), com ajustes responsivos para celular. Os campos de acesso mostram “Insira o usuário” e “Insira a senha”; o campo do usuário não indica mais “Opcional”.

- O servidor copia cada novo evento de auditoria para `proxyAndroid/keydeskAudit/events`, dentro do Realtime Database. A pasta `keydeskAudit` criada manualmente com `_setup: true` é preservada; os registros entram como filhos de `events`. A área **Atividade** do proprietário carrega os últimos eventos salvos no Firebase e combina-os com a auditoria local, eliminando duplicatas por identificador. Os detalhes enviados ao Firebase são filtrados para não copiar senhas, tokens, chaves completas nem identificadores de dispositivo. Nenhuma nova variável do Render é obrigatória: o caminho padrão já está no código. A conta de serviço existente deve continuar com acesso ao Realtime Database.
- Na visão geral do proprietário, o ranking lista até 10 revendedores pelo total em reais de recargas com status **pago/confirmado**. Recargas pendentes, expiradas ou estornadas não entram no cálculo.
- O botão **Não vou pagar** retira uma cobrança pendente apenas da lista do próprio revendedor. Não apaga o registro do banco/histórico do proprietário e não cancela a cobrança na API do BotaPix. Se o BotaPix confirmar o pagamento depois, o sistema credita os créditos e a recarga volta a aparecer.
- No plano gratuito do Render, o SQLite continua sujeito à perda do disco temporário; contas e saldos não são restaurados pelos logs. A cópia de auditoria Firebase protege os eventos gravados, não substitui o backup/persistência do banco principal.

Para atualizar, envie ao GitHub os arquivos da raiz deste ZIP e faça o deploy normal no serviço Render existente. Não altere `FIREBASE_DATABASE_PATH=proxyAndroid/keys`; o histórico de auditoria usa um caminho separado.
