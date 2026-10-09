---
impacto: capacidade_nova
secao: adicionado
titulo: Releases podem atualizar automaticamente a VPS configurada
---

Depois que a conexão segura da VPS for cadastrada no repositório, cada release
publicada manda o servidor buscar exatamente aquela versão pronta. A VPS não
compila o CRM: ela aplica a atualização oficial, baixa as imagens do registro e
confere o domínio antes de o deploy ser considerado concluído.
