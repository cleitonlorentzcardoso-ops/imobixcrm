---
impacto: nada_mudou
secao: alterado
titulo: O agente começa a responder mais cedo — as leituras do turno que não dependem umas das outras correm juntas
---

Antes de chamar o modelo, o turno do agente fazia as leituras de abertura uma de cada vez: playbook, skills, memória da organização, checkpoint, estágio do lead, mensagem que acordou o turno, contexto do contato (decisão humana, proposta, histórico, desfechos) e a memória do lead. Como o banco é remoto, cada leitura em série é uma ida e volta de rede que o cliente espera sem o "digitando…". Pela contagem do código, num turno de resposta eram 16 dessas idas e voltas em série nesse trecho; agora são 5, porque as leituras independentes correm juntas — no máximo 4 ao mesmo tempo por turno. Com muitos atendimentos abrindo no mesmo instante, as leituras podem passar das 10 conexões que o banco usa por padrão (ajustável em `DB_POOL_MAX`); o excesso espera na fila em vez de falhar, o que come parte do ganho justamente no pico. O que depende de outra leitura continua depois dela (o playbook depois da campanha de prospecção, o contexto depois do contato, a memória do lead depois da gravação de notas). Uma leitura que antes derrubava o turno quando falhava continua derrubando; a que era tolerada continua tolerada. A latência ganha depende da distância entre a VPS e o banco e não foi medida em produção. Nenhuma ação é necessária.
