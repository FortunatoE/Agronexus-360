# AgroNexus 360°

Plataforma de planejamento agrícola para conciliar planejamento, execução SAP, consumo, estoque físico e materiais em trânsito. O foco é transformar as fontes operacionais em uma leitura única de demanda, disponibilidade e risco de ruptura por núcleo, cultura e material.

## Fontes de importação

| Fonte | Uso na plataforma |
| --- | --- |
| Planejamento | Datas previstas, doses, áreas, produtos e WBS |
| ZPS007 | Execução e áreas registradas; registros `EXCL` não compõem a execução válida |
| CN52 | Consumo/aplicado |
| ZMM_BATCH | Fonte prioritária de estoque por lote, centro, depósito e armazém/cidade |
| MB52 | Complemento de estoque: somente materiais físicos que não aparecem na ZMM_BATCH |
| MB5T | Materiais em trânsito |
| Pedidos pendentes | Centro solicitante, descrição do produto e saldo ainda a fornecer |
| Dimensões.xlsx | Referências de princípio ativo, materiais, centros, culturas e conversões |

## Regras de conciliação

O elemento WBS segue o padrão:

`[Cultura].[Fazenda].[Safra].[Talhão]-[Índice]`

O índice de divisão do talhão é `A=1`, `B=2`, `C=3`, `D=4` e `E=5`.

No Planejamento, o núcleo é ajustado pelo prefixo do talhão: `TL` → `NC-TP`, `FM` → `NC-STM` e `BM` → `NC-BBJ`. Nos demais casos, `NC-VER` é normalizado para `NC-AGV`. Essa regra também atualiza a relação Fazenda → Núcleo usada para conciliar consumo e execução pelo WBS.

No CN52, o centro e o talhão são extraídos do Elemento PEP. Para o centro compartilhado `FBJ2`, `FM` pertence a `NC-STM` e `BM` a `NC-BBJ`; talhões iniciados por `TL` pertencem a `NC-TP`. Os demais registros mantêm o núcleo derivado pela dimensão de centro.

As ligações não dependem do código SAP. A chave operacional é a hierarquia de
nomes `Princípio ativo → Material agregado (padrão) → Material físico`,
normalizada para remover diferenças de acentuação, caixa e pontuação. O código
SAP é mantido somente como evidência de auditoria, nunca como chave de saldo.

| Regra | Origem | Destino |
| --- | --- | --- |
| Material | Planejamento/estoque/consumo/trânsito/pedidos | Princípio ativo, grupo, subgrupo e material agregado |
| Centro | Fontes SAP | Núcleo |
| Cultura | WBS e dimensão | Ciclo Safra ou Safrinha |
| Material padrão + apresentação física | Dimensão | Fator de normalização de volume |

Quando houver material agregado ou substituto, a chave da conversão é `material padrão|apresentação física`. A quantidade física é dividida pelo fator antes de consolidar planejamento, estoque, consumo, trânsito e pedidos. Se o planejamento já trouxer `Volume ajustado (produto) padrão`, esse valor tem prioridade. Itens sem vínculo de dimensão permanecem identificados como não conciliados em vez de apresentar saldo artificialmente zero.

Na ZMM_BATCH, o núcleo do estoque é conciliado pela mesma lógica usada no controle operacional: todo saldo do centro `FVR1` pertence a `NC-TP`; `FBJ2` + `TR01` pertence a `NC-BBJ`; `FBJ2` + `UTS1` pertence a `NC-STM`; depósito vazio pertence ao pool `BRAVO`; os demais registros usam o vínculo `Centro → Núcleo` das dimensões. Essas exceções são exclusivas do estoque — não alteram planejamento nem trânsito.

Estoque de **fazenda** é o que possui depósito preenchido e centro diferente de `0714`. Estoque de **armazém** é o que pertence ao centro `0714` ou não possui depósito. A ZMM_BATCH preserva ainda o nome e a cidade do armazém, como **BRAVO Sorriso** e **BRAVO Cuiabá**. Linhas com saldo zero são desconsideradas na classificação fazenda/armazém e não geram disponibilidade artificial. O armazém é um pool compartilhado por material agregado: não é duplicado entre núcleos no provisionamento.

Na guia Acompanhamento, esse pool é exibido separadamente como núcleo **ARMAZÉM**. A expansão apresenta primeiro o material físico e, abaixo, cada localização formada por `Nome Est.Esp. - Local Est.Esp.` da ZMM_BATCH. Linhas de lotes do mesmo material e da mesma localização são consolidadas em uma única linha operacional. A MB52 complementa apenas materiais ausentes na BATCH. Assim, o saldo central não se mistura ao saldo da fazenda nem é duplicado entre fontes.

## Visões operacionais

- **Visão geral:** execução por subgrupo, separada entre Safra e Safrinha, e macro por cultura.
- **Calendarização:** provisionamento por janela de avaliação, com detalhamento de saldo por fazenda, armazém, trânsito e **volume solicitado** dos pedidos pendentes, além da exportação Excel (Resumo e Detalhes). Lotes do mesmo material, tipo de saldo e localização são somados antes de aparecer no detalhe.
- **Acompanhamento:** inicia em **Safra**; os filtros recalculam planejamento e consumo antes da consolidação. As linhas são agrupadas por princípio ativo e cada grupo termina com os totais de planejado, saldo, trânsito, aplicado, a entregar e volume solicitado. Mantém o detalhe por material padrão e núcleo, com expansão por material físico e localização. Inclui filtro de núcleo e exportação Excel do recorte exibido, com uma aba adicional de totais por princípio ativo. O indicador **A entregar** segue `(Saldo + Aplicado + Trânsito) − Qtd. planejada`: verde quando positivo, vermelho quando negativo e preto quando zero.
- **Execução:** percentual já realizado, volumes planejado e executado, dose executada versus planejada e impacto de volume causado pela diferença de dose. A leitura é segmentada por ciclo, cultura, grupo, subgrupo, núcleo e material.
- **Importações:** seleção das sete fontes operacionais, Dimensões, data de modificação e de importação de cada arquivo, indicador de defasagem e relatório exportável dos dados não conciliados.
- **Premissas:** tolerâncias, janelas, status excluído, mapeamentos editáveis e tabela consolidada de todas as dimensões e conversões aplicadas. Pedidos pendentes (`Centro`, `Descrição Material`, `Saldo Forn`) são importados na Central de importações.

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

- `app/page.tsx` — interface, importações locais persistidas no navegador e cálculos operacionais.
- `components/dimension-upload.tsx` — leitura de `Dimensões.xlsx`.
- `lib/material-dimension.ts` — normalização e regras de dimensão.
- `lib/reconciliation.ts` — resolução por nomes, regras de centro/núcleo da ZMM_BATCH e livro de conciliação de planejamento, saldo, trânsito, aplicado e pedidos.
- `app/api/imports/route.ts` — persistência da importação central.
- `db/` e `drizzle/` — estrutura e migrações de dados.

## Publicação

O projeto possui dois alvos independentes:

- **Sites/Cloudflare:** `npm run build`, com Worker, D1 e R2 para a persistência central.
- **Vercel:** `npm run build:vercel`, configurado em `vercel.json` como aplicação estática.

Na Vercel, os sete arquivos e as dimensões são validados e armazenados no banco local do navegador, permanecendo disponíveis após fechar ou reabrir a aplicação no mesmo dispositivo e navegador. Valores numéricos nativos do Excel preservam seus decimais; textos formatados em padrão brasileiro também são interpretados corretamente. A persistência compartilhada e versionada entre usuários continua sendo uma etapa posterior, que exige conectar uma base e armazenamento compatíveis com a Vercel.
