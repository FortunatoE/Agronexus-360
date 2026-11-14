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
| Dimensões.xlsx | Referências de princípio ativo, materiais, centros, culturas e conversões |

## Regras de conciliação

O elemento WBS segue o padrão:

`[Cultura].[Fazenda].[Safra].[Talhão]-[Índice]`

O índice de divisão do talhão é `A=1`, `B=2`, `C=3`, `D=4` e `E=5`.

As ligações não dependem do código SAP. A plataforma normaliza a descrição do material removendo diferenças de acentuação, caixa e pontuação.

| Regra | Origem | Destino |
| --- | --- | --- |
| Material | Planejamento/estoque/consumo/trânsito | Princípio ativo, grupo, subgrupo e material agregado |
| Centro | Fontes SAP | Núcleo |
| Cultura | WBS e dimensão | Ciclo Safra ou Safrinha |
| Produto + substituto | Dimensão | Fator de conversão de dose |

Quando houver material agregado ou substituto, a demanda planejada é ajustada pelo fator cadastrado para permitir comparação com o material disponível no estoque.

## Visões operacionais

- **Visão geral:** área planejada por cultura e execução por subgrupo.
- **Calendarização:** calendário de aplicações e provisionamento por janela de avaliação.
- **Execução:** planejamento, estoque, trânsito, aplicado e saldo por material/núcleo/cultura.
- **Volumes:** estoque geral, em fazenda ou armazém. Fazenda é depósito preenchido exceto `0714`; armazém é depósito vazio ou `0714`.
- **Importações:** seleção das cinco fontes operacionais e da dimensão opcional.
- **Premissas:** tolerâncias, janelas, status excluído e mapeamentos editáveis da sessão.

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

- `app/page.tsx` — interface e cálculos operacionais da sessão.
- `components/dimension-upload.tsx` — leitura de `Dimensões.xlsx`.
- `lib/material-dimension.ts` — normalização e regras de dimensão.
- `app/api/imports/route.ts` — persistência da importação central.
- `db/` e `drizzle/` — estrutura e migrações de dados.

## Publicação

O projeto possui dois alvos independentes:

- **Sites/Cloudflare:** `npm run build`, com Worker, D1 e R2 para a persistência central.
- **Vercel:** `npm run build:vercel`, configurado em `vercel.json` como aplicação estática.

Na Vercel, os cinco arquivos são validados e usados diretamente na sessão do navegador, alimentando todos os visuais sem depender de uma API Cloudflare. A persistência compartilhada e versionada entre usuários continua sendo uma etapa posterior, que exige conectar uma base e armazenamento compatíveis com a Vercel.
