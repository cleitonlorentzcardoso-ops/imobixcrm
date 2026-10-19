# Importar etiquetas quando a sessão conectada não as sincroniza

O CRM lê as etiquetas da conexão normalmente. Se o motor do canal não entregar o histórico,
use uma instância WAHA isolada, **sem webhook e sem envio**, pareada com o mesmo número, para
gerar um arquivo local. A conexão que atende clientes continua intocada.

1. Confirme no painel da instância de leitura que a sessão está `WORKING` e que as contagens das
   etiquetas fazem sentido. Não abra conversas apenas para contar, porque isso pode marcá-las lidas.
2. Exporte com `scripts/exportar-etiquetas-waha.mjs`, executado pelo Node **dentro** da instância
   de leitura. A chave da API fica no ambiente dessa instância; o arquivo contém somente número
   da conta, nomes das etiquetas e identificadores/nomes das conversas. Não inclui mensagens.
3. Guarde o JSON apenas no computador do operador. Ele contém números dos contatos: não envie ao
   Git, não compartilhe em chat nem deixe em pasta pública.
4. No CRM, abra Conexões › Importar etiquetas › Escolher arquivo de etiquetas. O número do arquivo
   é conferido contra o da conexão quando o cadastro contém esse número. Escolha uma coluna por
   etiqueta e use **Conferir prévia** antes de importar.
5. Conflitos entre etiquetas escolhidas não ganham destino arbitrário; grupos e identificadores
   desconhecidos ficam fora. Negócios abertos em outro funil são preservados. Os lotes são
   idempotentes e a tela mostra criados, movidos, preservados e falhas.

O arquivo é reenviado apenas durante a prévia/importação; o CRM não o armazena como acervo. Se a
tela for recarregada, é preciso selecioná-lo novamente. Apague a cópia local após conferir o
resultado e deixar o backup apropriado dos dados no CRM.
