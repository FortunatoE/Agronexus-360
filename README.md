# AgroNexus 360°

Plataforma de planejamento agrícola para conciliar planejamento, execução SAP, consumo, estoque físico e materiais em trânsito. O foco é transformar as fontes operacionais em uma leitura única de demanda, disponibilidade e risco de ruptura por núcleo, cultura e material.

## Fontes de importação

| Fonte | Uso na plataforma |
| --- | --- |
| Planejamento | Datas previstas, doses, áreas, produtos e WBS |
| ZPS007 | Execução e áreas registradas; registros `EXCL` não compõem a execução válida |
| CN52 | Consumo/aplicado |
| MB52 | Estoque físico por centro e depósito |
| MB5T | Materiais em trânsito |
| Pedidos pendentes | Centro solicitante, descrição do produto e saldo ainda a fornecer |
| Dimensões.xlsx | Referências de princípio ativo, materiais, centros, culturas e conversões |

## Regras de conciliação

O elemento WBS segue o padrão:

`[Cultura].[Fazenda].[Safra].[Talhão]-[Índice]`

O índice de divisão do talhão é `A=1`, `B=2`, `C=3`, `D=4` e `E=5`.

As ligações não dependem do código SAP. A chave operacional é a hierarquia de
nomes `Princípio ativo → Material agregado (padrão) → Material físico`,
normalizada para remover diferenças de acentuação, caixa e pontuação. O código
SAP é mantido somente como evidência de auditoria, nunca como chave de saldo.

| Regra | Origem | Destino |
| --- | --- | --- |
| Material | Planejamento/estoque/consumo/trânsito/pedidos | Princípio ativo, grupo, subgrupo e material agregado |
| Centro | Fontes SAP | Núcleo |
| Cultura | WBS e dimensão | Ciclo Safra ou Safrinha |
| Produto + substituto | Dimensão | Fator de conversão de dose |

Quando houver material agregado ou substituto, a demanda planejada é ajustada pelo fator cadastrado para permitir comparação com o material disponível no estoque. Itens sem vínculo de dimensão permanecem identificados como não conciliados em vez de apresentar saldo artificialmente zero.

No MB52, estoque de **fazenda** é o que possui depósito preenchido e centro diferente de `0714`. Estoque de **armazém** é o que pertence ao centro `0714` ou não possui depósito. O armazém é um pool compartilhado por material agregado: não é duplicado entre núcleos no provisionamento.

## Visões operacionais

- **Visão geral:** execução por subgrupo, separada entre Safra e Safrinha, e macro por cultura.
- **Calendarização:** provisionamento por janela de avaliação, com detalhamento de saldo por fazenda, armazém e trânsito e exportação Excel (Resumo e Detalhes).
- **Execução:** filtros por ciclo, grupo, subgrupo e cultura; planejamento, saldo, trânsito, aplicado e volume solicitado por princípio ativo, material padrão e núcleo.
- **Volumes:** estoque geral, em fazenda ou armazém; a localização usa a regra de centro e depósito descrita acima.
- **Importações:** seleção das cinco fontes operacionais e da dimensão opcional.
- **Premissas:** tolerâncias, janelas, status excluído, mapeamentos editáveis e importação de pedidos pendentes (`Centro`, `Descrição Material`, `Saldo Forn`).

## Desenvolvimento

Requisitos: Node.js 22+ e npm.

```powershell
npm run build
npm run dev
```

Use `npm run start` para testar o Worker já compilado localmente. O build deve concluir sem erros antes de qualquer publicação.

Para validar a versão publicada na Vercel, execute:

```powershell
npm run build:vercel
```

Esse alvo gera uma SPA em `dist-vercel/`. Ele preserva o runtime Vinext/Cloudflare utilizado pela hospedagem original e evita que a Vercel tente interpretar o projeto como um build Next.js convencional.

## Estrutura relevante

- `app/page.tsx` — interface, importações locais e cálculos operacionais da sessão.
- `components/dimension-upload.tsx` — leitura de `Dimensões.xlsx`.
- `lib/material-dimension.ts` — normalização e regras de dimensão.
- `lib/reconciliation.ts` — resolução por nomes, centro/núcleo e livro de conciliação de planejamento, saldo, trânsito, aplicado e pedidos.
- `app/api/imports/route.ts` — persistência da importação central.
- `db/` e `drizzle/` — estrutura e migrações de dados.

## Publicação

O projeto possui dois alvos independentes:

- **Sites/Cloudflare:** `npm run build`, com Worker, D1 e R2 para a persistência central.
- **Vercel:** `npm run build:vercel`, configurado em `vercel.json` como aplicação estática.

Na Vercel, os cinco arquivos são validados e usados diretamente na sessão do navegador, alimentando todos os visuais sem depender de uma API Cloudflare. A persistência compartilhada e versionada entre usuários continua sendo uma etapa posterior, que exige conectar uma base e armazenamento compatíveis com a Vercel.
