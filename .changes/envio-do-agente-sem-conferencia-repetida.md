---
impacto: nada_mudou
secao: alterado
titulo: Cada mensagem do agente faz menos consultas ao banco antes de sair
---

Cada bolha que o agente manda conferia, antes de sair, se o atendimento ainda era o mesmo e se o agente ainda estava no ar. Dentro do trabalho do agente essa conferência era feita duas vezes por ponto de corte — uma pela conexão direta com o banco, outra pela API do banco, com a mesma pergunta. Agora a segunda leitura só é pulada quando a primeira acabou de responder sobre exatamente o mesmo atendimento e o mesmo agente; o carimbo de última atividade do contato, o registro de auditoria e o evento `message.sent` passam a ser gravados sem segurar a resposta do envio.

O que NÃO muda: pausar o agente no meio de uma resposta continua calando as bolhas seguintes sem deixar envio pendente no registro, e a conferência imediatamente antes de a mensagem ir para o WhatsApp continua lá. Envios pela tela, pelo MCP e pelas automações seguem conferindo como antes. O ritmo de envio (intervalo entre mensagens, variação aleatória, janela de horário) não foi tocado. Não há nada a fazer na atualização.
