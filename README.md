# AgroNexus 360°

Plataforma privada para planejamento agrícola, conciliação entre planejamento, execução e estoque, e gestão operacional de insumos.

## Situação atual

- Importação orientada de PLANEJAMENTO, ZPS007, CN52, MB52 e MB5T
- Exclusão de registros `EXCL` da ZPS007
- Regra de WBS por cultura, fazenda, safra, talhão e índice de divisão
- Visões de calendarização, execução, volumes, cobertura, alertas e tarefas
- Estrutura central preparada com D1 e R2 para versionamento e auditoria de importações

## Desenvolvimento

```bash
npm ci
npm run build
```

O ambiente publicado é privado. Arquivos de dados operacionais e credenciais não devem ser adicionados ao repositório.
