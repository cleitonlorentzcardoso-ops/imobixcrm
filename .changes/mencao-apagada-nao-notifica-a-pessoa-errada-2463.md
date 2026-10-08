---
impacto: nada_mudou
secao: corrigido
titulo: Menção apagada da nota interna não notifica mais a pessoa errada
---

Na nota interna, quem escolhia um atendente na lista de menção e depois apagava o nome do texto continuava com a escolha guardada: ao salvar, o aviso podia sair para a pessoa apagada em vez da que ficou no texto. Com duas pessoas de mesmo nome na equipe o caso ficava invisível, porque o texto das duas é idêntico. Agora cada edição do texto remove da lista as escolhas cujo nome não está mais lá, e o que o sino usa é sempre o id de quem está no texto na hora de salvar. Menção digitada à mão (sem passar pela lista) continua como sempre foi.

Contribuição de @Tong-bit-art (#2489), a partir da issue #2463.
