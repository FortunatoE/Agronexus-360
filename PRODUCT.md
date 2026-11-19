# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Analistas de planejamento agrícola, gestores de insumos e equipes operacionais que acompanham demanda, execução, estoque e abastecimento entre fazendas, núcleos e armazéns.

## Product Purpose

O AgroNexus 360° consolida planejamento agrícola, dados SAP e regras operacionais para tornar a conciliação de insumos auditável e acionável. Seu sucesso é reduzir o tempo entre identificar um risco e orientar uma decisão de abastecimento, aplicação ou correção cadastral.

## Positioning

Uma camada de decisão construída sobre regras reais de planejamento agrícola: reconcilia planejamento, execução, estoque físico, trânsito, pedidos pendentes, dimensões e conversões de dose por núcleo e material — em vez de apenas exibir números de fontes desconectadas.

## Operating Context

Uso recorrente em ciclos Safra e Safrinha, com importação de planilhas SAP e Excel. Os fluxos principais incluem importação e qualidade de dados, acompanhamento de materiais, calendarização/provisionamento, execução, alertas, tarefas e gestão de premissas.

## Capabilities and Constraints

- Importa Planejamento, ZPS007, CN52, ZMM_BATCH, MB52 complementar, MB5T, pedidos pendentes e dimensões.
- Concilia materiais pelo nome normalizado, aplica regras de WBS, núcleo, depósito, cultura, ciclo e conversão de dose.
- Persiste os dados operacionais localmente no navegador; a arquitetura futura prevê centralização com Worker, D1 e R2.
- Mantém exportações Excel, filtros, detalhamento progressivo, modo claro/escuro e alertas por e-mail.
- O produto deve preservar conteúdo, lógica de negócio e funcionalidades existentes durante qualquer evolução visual.

## Brand Commitments

Nome confirmado: **AgroNexus 360°**. A experiência deve parecer profissional, específica ao trabalho de planejamento agrícola e com personalidade própria — nunca um dashboard genérico ou uma aparência de interface criada rapidamente por IA. A referência MotionSites inspira ambição de composição e acabamento, não cópia de layout ou marca.

## Evidence on Hand

- Dados reais e modelos de trabalho do planejamento agrícola do projeto, documentados no repositório.
- Fluxos e arquitetura em `README.md` e diagramas em `docs/assets/`.
- Aplicação publicada em `https://agronexus-360.vercel.app`.
- Não há depoimentos, métricas comerciais ou provas externas autorizadas para fabricação na interface.

## Product Principles

1. A decisão operacional vem antes da ornamentação visual.
2. Cada número relevante precisa manter origem, regra e contexto compreensíveis.
3. Complexidade agrícola deve ser revelada por etapas, sem esconder sinais de risco.
4. O sistema deve apoiar tanto leitura executiva quanto investigação material a material.
5. A interface deve comunicar confiança de uma ferramenta de trabalho, não de uma demonstração genérica.
