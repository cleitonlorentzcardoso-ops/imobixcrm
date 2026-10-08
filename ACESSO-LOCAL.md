# Acesso local ao DeskcommCRM

1. Com o Windows ligado, execute `INICIAR-CRM-LOCAL.ps1` pelo PowerShell. Ele inicia o Docker Desktop, o banco e o aplicativo, se necessário, e abre a tela de login.
2. Acesse [http://localhost:3000/login](http://localhost:3000/login).
3. Entre com o e-mail `admin@admin.com`. A senha está no arquivo `.env.owner.local`, na linha `OWNER_PASSWORD`. Guarde esse arquivo em privado.

O código-fonte está nesta pasta. A cópia de execução e as dependências estão no Ubuntu do WSL, em `/root/DeskcommCRM`. Os dados ficam nos volumes locais do Docker. Nenhum serviço foi publicado na internet.

Este computador tem 8 GB de RAM; a compilação de produção do projeto esgotou a memória. Por isso o acesso atual usa o servidor de desenvolvimento do Next.js. A primeira visita a cada tela pode demorar enquanto ela é compilada. O login e o banco local foram verificados. A telemetria Sentry está desligada nesta instalação. WhatsApp, envio de mensagens e recursos de IA ainda precisam de configuração própria antes de uso real.
