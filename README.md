# Keydesk — painel de keys para revendedores

Aplicação web local para o proprietário criar revendedores, administrar créditos e prefixos, e para os revendedores gerar e copiar keys.

## O que está implementado

- Login com um único campo de senha: o proprietário usa sua senha-mestra fixa; cada revendedor usa uma senha individual criada pelo dono. Não há campo de usuário na tela de entrada. O sistema identifica a conta no servidor, rejeita senhas repetidas e nunca envia hashes ou a senha-mestra ao navegador.
- No primeiro acesso, defina a senha-mestra do dono. Ela é armazenada como hash bcrypt no arquivo separado `data/owner-auth.json`, com permissões restritas. Revendedores continuam aparecendo por usuário na área de administração, mas entram apenas com a própria senha.
- Contas de revendedor com senha em hash, saldo de créditos e prefixo próprio. O dono pode remover o acesso: o login é bloqueado, a conta sai da lista, o saldo restante fica arquivado e as keys emitidas continuam no Firebase e no histórico. O nome de usuário fica livre para ser cadastrado novamente.
- O proprietário pode adicionar/remover créditos, editar prefixos e gerir todas as keys. O revendedor pode pausar/retomar, resetar o vínculo ou excluir somente as próprias keys; nenhuma dessas ações altera créditos. Pausar bloqueia a key no app, mas a validade continua correndo. Resetar apenas desvincula o dispositivo e a expiração também continua correndo. Pausa/reset ficam visíveis na tabela e habilitam quando houver vínculo, conforme o gerador de referência.
- Formato do app de referência: prefixo normalizado para maiúsculas e somente letras/números, hífen e 6 caracteres aleatórios de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sem caracteres ambíguos).
- Preços aplicados: 1 hora = 0,5 crédito; 1 dia = 1; 3 dias = 2; 7 dias = 6; 30 dias = 8. Cada duração selecionada é gravada no Firebase e o custo é debitado no saldo do revendedor.
- A geração usa PATCH em lote no endpoint `proxyAndroid/keys.json`. A key nasce `status: "active"`, sem dispositivo, `activatedAt: 0` e `activationStarted: false`. `expiresAt` é criado como `createdAt + duração` (por exemplo, 1 hora = 1 hora após a geração), sem datas artificiais. O painel mostra **Aguardando** enquanto `activationStarted` for falso; no primeiro vínculo, o aplicativo deve reiniciar o prazo completo como `agora + duração` e marcar a ativação.
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
3. Baixe `keydesk-revendedores-v18.zip` para Downloads e extraia. O ZIP já tem os arquivos na raiz, sem uma pasta `key-reseller-panel` envolvendo tudo:

   ```bash
   mkdir -p ~/keydesk-v14
   if [ -d ~/keydesk/key-reseller-panel/data ]; then mkdir -p ~/keydesk-v14/data && cp -an ~/keydesk/key-reseller-panel/data/. ~/keydesk-v14/data/; fi
   unzip -o ~/storage/downloads/keydesk-revendedores-v18.zip -d ~/keydesk-v14
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
4. No primeiro acesso, defina a senha-mestra fixa do dono no único campo. Nos próximos acessos, dono e revendedores informam somente a própria senha; o servidor reconhece o perfil sem solicitar usuário.
5. Na aba **Revendedores**, crie os acessos, créditos e prefixos.

A senha do proprietário não está embutida no código, JavaScript, HTML ou ZIP nem é exibida pelo site; somente o hash fica no arquivo de autenticação do servidor. Cada conta de revendedor deve ter uma senha exclusiva. O dono pode redefinir a senha de qualquer revendedor na lista de contas, sem consultar a senha anterior.

## Publicar o código no GitHub

O GitHub pode guardar o código-fonte, mas **não executa este painel Node.js**. O GitHub Pages serve páginas estáticas e não hospeda o servidor Express, o banco SQLite nem o túnel. Para deixar o painel acessível sem Termux, publique o repositório e conecte-o a um serviço de hospedagem que execute Node.js (comando de instalação `npm install`, comando de início `npm start`).

O pacote plano mantém os arquivos do projeto na raiz, sem subpastas de código. Ao iniciar, o servidor cria `data/` automaticamente para armazenar o banco e a autenticação local.

Ao configurar uma hospedagem HTTPS, configure `HOST=0.0.0.0`, deixe a plataforma fornecer `PORT` e use `COOKIE_SECURE=true`. Como o painel salva contas e créditos em `data/app.sqlite`, o serviço precisa oferecer armazenamento persistente montado para a pasta `data/`; em sistemas de arquivos temporários, esses dados podem ser perdidos em reinícios ou novas implantações. Configure secrets/variáveis privadas no painel da hospedagem, nunca no repositório. Não envie `.env` nem conteúdo de `data/`; o `.gitignore` do projeto os exclui.

### Render (plano gratuito, para teste)

O arquivo `render.yaml` configura um serviço Node.js gratuito. Extraia o ZIP, envie os arquivos ao GitHub e, no Render, crie um **Blueprint** conectado ao repositório que contém `render.yaml`. O Render instalará com `npm ci` e iniciará com `npm start`; depois do deploy, use o endereço `*.onrender.com` exibido no painel.

Para atualizar um serviço Render que já existe, substitua os arquivos do repositório GitHub pelos do ZIP (mantenha todos no diretório raiz), faça commit e, no serviço, escolha **Manual Deploy → Deploy latest commit**. Não crie outro serviço para esta atualização. A migração reconhece hashes antigos e mantém o acesso por senha; os usuários antigos não precisam informar o nome de usuário na tela nova.

**Limitações importantes:** o serviço gratuito pode dormir após 15 minutos sem acessos e demorar cerca de um minuto para voltar. Ele não aceita disco persistente e apaga o sistema de arquivos local ao dormir/reiniciar; portanto, o `data/app.sqlite` e `data/owner-auth.json` podem ser perdidos — incluindo contas e créditos — e o painel pode voltar a solicitar a configuração da senha-mestra. As keys já enviadas ao Firebase ficam no Firebase, mas o plano grátis não é adequado para dados reais ou uso confiável. Use apenas para testar com contas e créditos fictícios. Para preservar dados, é necessário mudar o armazenamento ou usar hospedagem com disco persistente.

## Acesso por outros dispositivos / hospedagem

Por padrão, o servidor escuta somente em `127.0.0.1`, evitando exposição acidental. O LocalTunnel descrito acima cria um link HTTPS temporário encaminhado ao celular; ele funciona somente enquanto o painel, o túnel e o Termux estiverem ativos. Para uma rede privada confiável, copie `.env.example` para `.env`, ajuste `HOST=0.0.0.0` e use firewall/rede confiável. Para um endereço permanente, configure hospedagem HTTPS independente, `COOKIE_SECURE=true`, domínio e proteção dos dados/backups; não exponha o painel diretamente sem HTTPS e controles adequados.

## Firebase e segurança

A URL/caminho Firebase seguem o arquivo de referência; comunicação é feita pelo servidor do painel, não pelo navegador. Se as regras do Realtime Database exigirem autenticação, copie `.env.example` para `.env` e configure `FIREBASE_AUTH_TOKEN` em privado. O arquivo de referência usava Firebase REST sem token: isso só funciona se as regras do banco permitirem. Não deixe o banco aberto para escrita pública em produção; configure regras restritivas/credenciais apropriadas. As senhas do painel não foram copiadas do JavaScript de referência.

## Backup e restauração

Para preservar cadastros, pare o servidor e faça cópia da pasta `data/` (incluindo `app.sqlite`, `owner-auth.json` e `session-secret`). Não envie `data/` ou `.env` publicamente.

## Atualizar instalação no Termux

O ZIP v18 extrai direto na raiz e preserva `data/`. Para atualizar a instalação existente, pare o serviço, faça um backup local dos dados, extraia o ZIP e inicie novamente:

```bash
mkdir -p ~/keydesk-v14
cd ~/keydesk-v14
bash SERVICO_24H.sh stop
cp -a data ~/keydesk-data-backup-$(date +%Y%m%d-%H%M%S)
unzip -o ~/storage/downloads/keydesk-revendedores-v18.zip -d ~/keydesk-v14
pkg install nodejs-lts unzip tmux termux-api -y
bash SERVICO_24H.sh start
```

Se o navegador usar arquivos antigos, atualize a página ou limpe o cache. A integração usa o mesmo PATCH em lote do app de referência no path `proxyAndroid/keys`; a interface exibe o path e a quantidade de registros lidos. O formato e a tabela de créditos já foram incorporados.
