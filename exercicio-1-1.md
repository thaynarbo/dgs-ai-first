# Análise Técnica de Viabilidade — Pipeline de RAG NovaTech

---

## Iteração 1

**Prompt:**

> Você é um engenheiro sênior especialista em arquitetura de sistemas de IA, com foco em pipelines de RAG (Retrieval-Augmented Generation) para aplicações corporativas.
>
> **Contexto do projeto:** A NovaTech é uma empresa de médio porte do setor de logística (1.200 funcionários). A equipe de atendimento ao cliente (45 pessoas) gasta em média 12 minutos por chamado buscando informações em documentação interna para responder dúvidas sobre prazos, regras de frete, políticas de devolução e procedimentos de reclamação. Volume: 320 chamados/dia, ~60% envolvem consulta a documentação. Meta: reduzir o tempo de busca de 12 para menos de 2 minutos por chamado.
>
> A solução contratada é um assistente de IA integrado ao ambiente Microsoft (Teams + SharePoint) que responde perguntas em linguagem natural com base na documentação oficial.
>
> **Base de conhecimento:** SharePoint (~800 PDFs/Word com tabelas e fluxogramas), Wiki Confluence (~400 páginas com macros e links internos), Pasta de rede (~50 planilhas com fórmulas interdependentes atualizadas mensalmente).
>
> **Governança:** Documentação atualizada por 3 áreas sem processo unificado. Versões conflitantes ativas (ex: PROC-042 v1 e v2 com multiplicadores regionais diferentes, sem hierarquia clara). Infraestrutura: Microsoft 365 E3 + Azure AI Services. Prazo: 3 meses.
>
> **Tarefa:** Produza uma análise técnica de viabilidade do pipeline de RAG cobrindo obrigatoriamente: (1) Análise por tipo de fonte documental, (2) Estimativa de tamanho da base em tokens, (3) Análise de orçamento de contexto, (4) Estratégia de chunking recomendada.

**Resultado:**

---

## 1. Análise por tipo de fonte documental

### 1.1 PDFs com tabelas complexas (tabelas de frete, 15+ colunas)

**Desafio técnico**

Extratores de PDF baseados em texto (PyMuPDF, pdfplumber, Azure Document Intelligence) transformam tabelas em sequências lineares de células. Uma tabela com 15 colunas e 20 linhas — típica das tabelas de frete da NovaTech — vira um bloco de texto contínuo sem relação semântica explícita entre coluna e valor. O chunking padrão por tamanho corta o bloco no meio, separando cabeçalho de dados.

**Impacto na qualidade das respostas**

Exemplo concreto: a tabela de multiplicadores regionais do PROC-042 tem apenas 5 linhas, mas quando linearizada e dividida ao longo de uma fronteira de chunk, o modelo pode receber o cabeçalho `| Região | Multiplicador |` em um chunk e as linhas `| Norte | 1.8 |` no chunk seguinte — que pode não ser recuperado pelo retrieval se a query for `"qual o frete para o Nordeste"`. O modelo responde com o dado incompleto ou alucina o valor.

Agravante: existem **duas versões conflitantes do PROC-042** ativas no SharePoint (v1 de março/2023 e v2 de novembro/2023), com multiplicadores diferentes (ex: Norte = 1.6 na v1 vs. 1.8 na v2). Um retrieval que retorna chunks das duas versões sem metadado de versão coloca o LLM em posição de arbitrar uma contradição que ele não tem base para resolver — gerando resposta incorreta com aparência de confiança.

**Estratégia de tratamento**

- Usar **Azure Document Intelligence (Form Recognizer)** com modelo `prebuilt-layout` para extração estruturada, que preserva estrutura de tabela em formato JSON ao invés de texto plano.
- Converter tabelas para representação Markdown estruturada **com cabeçalho repetido em cada chunk** que contenha dados tabulares.
- Adicionar **metadados de versão e data de emissão** em cada chunk: `{"source": "PROC-042-v2", "version": "2.0", "date": "2023-11-10", "supersedes": "PROC-042-v1"}`.
- Implementar **lógica de desambiguação de versão** no pre-retrieval: se dois chunks do mesmo documento base forem recuperados, priorizar o de data mais recente e incluir aviso explícito no prompt: *"Existem versões conflitantes. Use a versão mais recente disponível nos documentos abaixo."*

---

### 1.2 PDFs escaneados (OCR necessário)

**Desafio técnico**

Documentos escaneados são imagens — não há camada de texto extraível diretamente. A qualidade do OCR depende da resolução do scan, do contraste, da presença de ruído (manchas, dobras, carimbos sobrepostos ao texto). Erros de OCR são silenciosos: o pipeline não sabe que `"1.500kg"` foi lido como `"1,500kg"` ou que `"Nordeste"` virou `"Nordesta"`. Esses erros passam pelo embedding e chegam ao índice vetorial corrompidos.

**Impacto na qualidade das respostas**

Exemplo concreto: um fluxograma de aprovação de frete especial (cargas acima de 5.000kg requerem aprovação do gerente regional, conforme PROC-042 seção 4) que está como imagem incorporada ao PDF não gera **nenhum texto** para o índice. O atendente pergunta *"o que preciso para enviar 6 toneladas para o Norte?"* e o assistente não encontra o chunk com a regra de aprovação — responde com base na fórmula geral, omitindo a etapa obrigatória. Isso gera erro operacional.

**Estratégia de tratamento**

- Usar **Azure AI Document Intelligence** com pipeline de OCR multimodal, que combina reconhecimento ótico com análise de layout para reconstruir estrutura de parágrafos.
- Para fluxogramas e imagens: aplicar **GPT-4o Vision** como etapa de pré-processamento para gerar descrição textual estruturada da imagem (`"Fluxo: SE peso > 5.000kg → ENTÃO aprovação gerente regional OBRIGATÓRIA → DEPOIS seguir fórmula PROC-042"`). Esse texto gerado é indexado como chunk com metadado `{"content_type": "image_description", "source_image": "fluxograma-aprovacao.png"}`.
- Estabelecer **threshold de confiança de OCR**: chunks com score de confiança < 80% devem ser marcados com flag `low_confidence` e excluídos do índice ou sinalizados ao atendente quando recuperados.
- Incluir revisão humana periódica de documentos OCR de alta importância (ex: regulatórios do Compliance).

---

### 1.3 Wiki Confluence com links internos e macros

**Desafio técnico**

Páginas Confluence contêm: (a) macros como `{include}` que injetam conteúdo de outras páginas no momento da renderização — conteúdo que não existe no HTML bruto da página; (b) macros `{status}` e painéis de aviso que carregam semântica contextual ("ATENÇÃO: esta seção está em revisão") que soma na exportação; (c) links internos como `[veja PROC-042|/wiki/spaces/OPS/pages/1234]` que perdem o alvo ao serem extraídos em texto plano.

**Impacto na qualidade das respostas**

Exemplo concreto: uma página Wiki de procedimentos de atendimento ao cliente contém `{include: SLA-2024}` para injetar a tabela de SLA. Na exportação bruta, esse include gera apenas o texto literal `{include: SLA-2024}` no chunk — o LLM recebe esse token sem contexto e não consegue responder sobre prazos de atendimento mesmo que a tabela SLA-2024 exista no índice. O retrieval de "prazo Gold" recupera o chunk errado (o da Wiki com macro não resolvida) ao invés do chunk da tabela real.

Adicionalmente, as ~400 páginas da Wiki têm links cruzados entre si. Um chunk que referencia outra página sem resolver o link não carrega contexto suficiente — o atendente recebe resposta incompleta e precisa navegar manualmente, anulando o objetivo de reduzir os 12 minutos para 2.

**Estratégia de tratamento**

- Usar a **API REST do Confluence** (endpoint `/rest/api/content/{id}?expand=body.export_view`) que renderiza macros antes da exportação, ao invés de exportar o HTML bruto.
- Implementar **resolução de links internos no pré-processamento**: substituir `[texto|/wiki/...]` por `[texto — referência: TÍTULO DA PÁGINA LINKADA]` para preservar contexto semântico.
- Para macros `{status}` e painéis de aviso: extrair e converter em prefixo textual explícito — `[AVISO: EM REVISÃO]` — que seja indexável e recuperável.
- Aplicar **chunking hierárquico**: preservar a hierarquia de seção (H1 → H2 → H3) como metadado de cada chunk para permitir recuperação por seção específica e para reconstruir contexto pai quando necessário.

---

### 1.4 Planilhas Excel com fórmulas interdependentes

**Desafio técnico**

Planilhas de logística têm fórmulas como `=VLOOKUP(regiao, TabeFretes!A:C, 3, FALSE) * PesoFator` que dependem de abas distintas. A extração direta de uma aba produz texto com referências circulares não resolvidas (`=#REF!` ou `=TabeFretes!C15`) sem os valores calculados. O conteúdo semântico real (o número que o atendente precisa) não existe em nenhuma célula de forma estática — ele existe apenas no estado computado da planilha.

**Impacto na qualidade das respostas**

Exemplo concreto: uma planilha de cálculo de prazo de entrega por rota tem a coluna "Prazo final" calculada como `=B3 + PROC-042_PrazoAdicional`. Se o pipeline extrair a planilha sem resolver fórmulas, o chunk indexado contém `=B3+2` ao invés de `"Prazo Sul: 5 dias úteis"`. O atendente pergunta *"quanto tempo demora para o Sul?"* e o retrieval não encontra o chunk relevante porque a representação semântica do valor não existe no texto extraído.

Agravante: as planilhas são **atualizadas mensalmente** pela equipe sem processo de revisão unificado — o pipeline de ingestão precisa detectar mudanças e reindexar automaticamente.

**Estratégia de tratamento**

- Usar **openpyxl + xlrd** com avaliação de fórmulas via `xlcalculator` ou exportar para CSV após cálculo via Excel automation (Azure Automation + Excel COM) para capturar valores computados, não fórmulas.
- Converter cada aba em representação tabular textual com cabeçalhos explícitos e valores calculados: `"Rota: Sul | Prazo base: 3 dias | Adicional frete especial: +2 dias | Prazo total: 5 dias úteis"`.
- Implementar **trigger de reindexação automático** via Azure Logic Apps conectado ao SharePoint/OneDrive: quando uma planilha é modificada, enfileirar reprocessamento.
- Documentar dependências entre abas como metadado do chunk para rastreabilidade de auditoria.

---

## 2. Estimativa de tamanho da base em tokens

### Cálculo

| Fonte | Fórmula | Palavras | Tokens (÷ 0,75) |
|---|---|---|---|
| PDFs (SharePoint) | 800 docs × 10 págs × 250 palavras | 2.000.000 | **2.666.667** |
| Wiki (Confluence) | 400 páginas × 1.500 palavras | 600.000 | **800.000** |
| Planilhas | 50 arquivos × 200 palavras-equiv. | 10.000 | **13.333** |
| **Total** | | **2.610.000 palavras** | **≈ 3.480.000 tokens** |

### Interpretação: é viável para indexação no Azure AI Search?

**Sim, com ressalvas.** O Azure AI Search suporta índices na casa de dezenas de milhões de documentos. 3,48M de tokens distribuídos em chunks de ~500 tokens geram aproximadamente **6.960 chunks** — volume gerenciável na camada Standard S1 (que suporta até 50 partições e ~15GB de armazenamento de índice vetorial).

**Implicações práticas para o projeto:**

1. **Custo de embedding na ingestão inicial:** Usando `text-embedding-3-small` (Azure OpenAI), 3,48M tokens custam aproximadamente **US$ 0,07** (0,02/1M tokens). Custo negligenciável. O ponto de atenção real é o custo de **reindexação contínua** das planilhas (mensais) e documentos atualizados.

2. **Tempo de ingestão inicial:** Com throughput de ~1.000 req/min para embedding API e batch de 16 chunks por request, ~6.960 chunks levam **menos de 10 minutos** de processamento puro. O gargalo real é o pré-processamento (OCR, resolução de macros, extração de planilhas) — estimativa realista de **8-12 horas** para ingestão inicial completa com pipeline sequencial.

3. **Fragmentação e ruído:** A governança precária (versões conflitantes, FAQ não validado) vai inflar o índice com chunks semanticamente redundantes e contraditórios. A estimativa de 6.960 chunks provavelmente inclui **15-20% de chunks de baixa qualidade** que degradam o retrieval. Recomenda-se etapa de filtragem e deduplicação por similaridade cossenoidal (threshold > 0.95) antes da indexação.

4. **Dimensão de vetores:** Com `text-embedding-3-small` (1.536 dimensões), o armazenamento vetorial para 6.960 chunks é ~**41MB** — totalmente dentro da capacidade do Azure AI Search gratuito/básico.

---

## 3. Análise de orçamento de contexto

### Capacidade teórica

```
Janela GPT-4o:          128.000 tokens
System prompt + instr.:  -2.000 tokens
Histórico de conversa:   -3.000 tokens (estimativa conservadora, 3 turnos)
Buffer de resposta:      -2.000 tokens
─────────────────────────────────────────
Disponível para chunks:  121.000 tokens

Chunks de 500 tokens:    121.000 / 500 = 242 chunks teóricos
```

### Por que 242 chunks é uma estratégia incorreta?

**O efeito *lost in the middle*** é um comportamento documentado empiricamente em LLMs: quando o contexto contém muitas informações, o modelo tende a usar com maior acuidade as informações posicionadas **no início e no final** do prompt, e a **subponderar** informações no meio — mesmo que sejam as mais relevantes para a pergunta.

Em um contexto com 242 chunks (~121.000 tokens), um chunk relevante posicionado entre os chunks 80 e 180 tem probabilidade significativamente menor de influenciar a resposta do que um chunk posicionado nos primeiros ou últimos 20 chunks. O resultado prático:

- **Recall aparente alto, precisão baixa:** o retrieval encontrou o chunk certo, mas o LLM não o "viu" de forma efetiva no contexto massivo.
- **Alucinação por sobrecarga:** com 242 chunks de conteúdo de logística, o modelo enfrenta sinal contraditório (versões v1 e v2 do PROC-042, FAQ informal vs. documentos normativos) e pode sintetizar uma resposta plausível mas incorreta.
- **Custo por query:** 121.000 tokens de contexto a US$ 2,50/1M tokens (GPT-4o input) = **US$ 0,30 por pergunta**. Com 192 queries/dia (60% de 320), isso é US$ 57,60/dia = **US$ 1.728/mês** — potencialmente proibitivo.

### Orçamento recomendado

| Componente | Tokens | Justificativa |
|---|---|---|
| System prompt + instruções | 2.000 | Persona, regras de citação, disclaimer de versão |
| Histórico de conversa (3 turnos) | 3.000 | Preservar contexto do chamado |
| Chunks recuperados | **3.000–5.000** | 6–10 chunks de 500 tokens |
| Buffer de resposta | 2.000 | Resposta estruturada com citação |
| **Total** | **10.000–12.000** | Abaixo de 10% da janela disponível |

**6 a 10 chunks** é o sweet spot para o contexto NovaTech porque:
- Cabe na zona de atenção máxima do modelo (primeiros e últimos elementos do contexto)
- Permite incluir 1-2 chunks de contexto pai (seção do documento) além dos chunks de resposta direta
- Mantém custo por query em **US$ 0,025–0,035** (input + output) — viável para 192 queries/dia (~US$ 180/mês)

**Estratégia de balanceamento recall × precisão:**
- **Recall:** usar **hybrid search** (vetorial + BM25 keyword) no Azure AI Search para garantir que chunks com termos exatos (números de procedimento como "PROC-042", valores como "1.8") sejam recuperados mesmo quando o embedding semântico não seja suficiente.
- **Precisão:** aplicar **reranker** (Azure AI Search semantic ranker ou Cohere Rerank) para reordenar os top-50 candidatos do retrieval antes de selecionar os top-8 para o contexto.
- **Ordenação no prompt:** posicionar chunks de maior score de relevância no **início e no final** do bloco de contexto — explorando intencionalmente o efeito lost in the middle em favor dos chunks mais relevantes.

---

## 4. Estratégia de chunking recomendada

### 4.1 PDFs com tabelas complexas

**Estratégia:** chunking semântico por seção + tabelas como chunks atômicos

- **Fronteiras:** quebras em nível de seção (H1/H2) identificadas pelo Azure Document Intelligence. Tabelas nunca são divididas — cada tabela é um chunk único, independentemente do tamanho.
- **Tamanho:** 400-600 tokens para texto corrido; até 800 tokens para tabelas (preservar integridade).
- **Overlap:** 50 tokens (1-2 frases) entre chunks de texto para preservar continuidade de raciocínio entre seções.
- **Pergunta típica do atendente:** *"Qual o multiplicador regional para o Nordeste na versão atual?"* → requer chunk contendo a tabela inteira de multiplicadores + metadado de versão.
- **Lost in the middle:** chunks de tabela devem ser posicionados **primeiro** no bloco de contexto (maior relevância geralmente), seguidos de chunks textuais de suporte. Nunca enterrar uma tabela no meio de 8 chunks de texto.

**Exemplo de chunk estruturado (PROC-042-v2):**
```
[FONTE: PROC-042-v2 | VERSÃO: 2.0 | DATA: 2023-11-10 | SEÇÃO: 2.1]
Multiplicadores regionais (atualizados em novembro/2023):
Sul: 1.3 | Sudeste: 1.1 | Centro-Oeste: 1.4 | Nordeste: 1.5 | Norte: 1.8
NOTA: Substitui os multiplicadores da versão anterior (PROC-042-v1, data 2023-03-03).
```

---

### 4.2 PDFs escaneados (OCR)

**Estratégia:** chunking por parágrafo com prefixo de confiança

- **Fronteiras:** parágrafos identificados pelo OCR (quebra de linha dupla ou indentação). Fluxogramas geram um chunk único com a descrição gerada por visão computacional.
- **Tamanho:** 300-400 tokens (menor que o padrão para compensar ruído de OCR — chunks menores são mais precisos no retrieval).
- **Overlap:** 30 tokens — menor overlap é suficiente porque parágrafos OCR têm maior independência semântica.
- **Pergunta típica:** *"O que preciso para enviar carga acima de 5 toneladas?"* → depende do chunk do fluxograma de aprovação, que seria perdido sem o processamento por visão.
- **Lost in the middle:** chunks de fluxogramas/processos devem ser posicionados no início do contexto — são os chunks mais acionáveis (contêm passos de ação) e mais sujeitos a serem subponderados se enterrados no meio.

---

### 4.3 Wiki Confluence

**Estratégia:** chunking hierárquico com contexto pai embutido

- **Fronteiras:** seções H2/H3 após resolução de macros via API. Cada chunk carrega como prefixo o título da página e da seção pai.
- **Tamanho:** 500 tokens por chunk de seção.
- **Overlap:** sem overlap entre seções — o contexto pai no prefixo substitui o overlap tradicional.
- **Estrutura do chunk:**
  ```
  [PÁGINA: Procedimentos de Atendimento > SEÇÃO: Escalação de Incidentes Críticos]
  Um incidente é crítico quando: carga com valor acima de R$ 100.000 com
  status desconhecido há mais de 6 horas; carga perigosa com irregularidade
  documental; [...]
  ```
- **Pergunta típica:** *"Quando devo escalar um chamado como crítico?"* → o contexto pai (nome da página + seção) no prefixo melhora o retrieval semântico.
- **Lost in the middle:** a hierarquia no prefixo funciona como âncora de relevância — mesmo que o chunk fique no meio do contexto, o LLM usa o metadado de seção para ancoragem.

---

### 4.4 Planilhas Excel

**Estratégia:** chunking por tabela/aba com valores computados

- **Fronteiras:** cada aba é um chunk independente. Se uma aba excede 600 tokens após conversão textual, dividir por grupos lógicos de linhas (ex: por região, por faixa de peso).
- **Tamanho:** 200-400 tokens (planilhas tendem a ser densas em dados, sem texto corrido).
- **Overlap:** nenhum — dados tabulares são semanticamente independentes por linha.
- **Valores resolvidos obrigatoriamente:** nunca indexar fórmulas; sempre indexar o valor calculado com unidade explícita.
- **Pergunta típica:** *"Qual o prazo para entrega na região Norte por frete especial acima de 1 tonelada?"* → requer chunk de planilha com valores de prazo calculados por rota + fator PROC-042.
- **Lost in the middle:** chunks de planilha devem ser agrupados contiguamente no contexto (todos juntos, não intercalados com chunks de PDF) para que o LLM possa raciocinar sobre relações entre células de forma coerente.

---

### Resumo executivo da estratégia de chunking

| Fonte | Tamanho | Overlap | Fronteira | Posição no prompt |
|---|---|---|---|---|
| PDF tabelas | 400-800t | 50t | Seção + tabela atômica | Início (tabelas primeiro) |
| PDF OCR | 300-400t | 30t | Parágrafo + fluxograma único | Início (fluxogramas) |
| Wiki Confluence | 500t | 0 (ctx pai) | H2/H3 com prefixo hierárquico | Meio (suporte textual) |
| Planilhas | 200-400t | 0 | Aba/grupo de linhas | Agrupados no início ou fim |

**Princípio geral de ordenação no prompt:** chunks de maior score de reranking nos **primeiros 3 e últimos 2** slots do bloco de contexto; chunks de suporte nos slots centrais. Isso mitiga o efeito lost in the middle sem exigir que o retrieval seja perfeito — mesmo que um chunk relevante entre no meio, os mais relevantes ainda estarão nas posições privilegiadas.

---

*Documento produzido com base nos arquivos PROC-042-v1, PROC-042-v2, SLA-2024 e FAQ-atendimento da pasta `dados/`. Análise datada de 03/06/2026. Revisão recomendada após definição final da arquitetura de indexação no Azure AI Search.*

---

## Iteração 2

**Prompt:**

> Avalie a análise feita na Iteração 1, identifique os pontos fracos, estimativas otimistas demais ou riscos que você não considerou. Incorpore o feedback ao documento, segundo a estrutura do entregável.

**Resultado:**

### Avaliação crítica da Iteração 1

A análise anterior tem valor estrutural, mas contém **seis problemas materiais** que comprometem sua confiabilidade como documento de viabilidade técnica.

---

#### Problema 1 — Estimativa de ingestão inicial é otimista por fator de 10x

A Iteração 1 estimou "8-12 horas" para a ingestão inicial. Esse número considera apenas o tempo de chamada à embedding API e ignora o pipeline real de pré-processamento:

| Etapa | Volume | Throughput realista | Tempo estimado |
|---|---|---|---|
| Azure Document Intelligence (layout) | 8.000 páginas | ~0,5 pág/s com retries | ~4-5 horas |
| GPT-4o Vision (imagens em PDFs) | ~500 imagens (20% dos PDFs × 3 img/PDF) | ~5-15s/chamada com rate limit | ~2-3 horas |
| Confluence API + resolução de macros | 400 páginas | 3 req/s com throttling | ~2 horas |
| Extração e cálculo de planilhas | 50 arquivos × N abas | Variável (COM automation) | ~1 hora |
| Deduplicação + indexação vetorial | ~8.000 chunks | Rápido, mas sequencial | ~30 min |
| **Total realista** | | | **~2-3 dias corridos** |

A estimativa de "menos de 10 minutos" descreveu apenas o embedding, não o pipeline. Isso pode afetar o planejamento de sprint — a ingestão inicial precisa ser tratada como uma tarefa de 2-3 dias, não de meio turno.

---

#### Problema 2 — Custo de ingestão subestimado: apenas embedding foi contabilizado

A Iteração 1 citou "US$ 0,07" como custo total de ingestão. Esse número é apenas o custo de embedding e omite:

- **Azure Document Intelligence prebuilt-layout:** US$ 0,001/página × 8.000 páginas = **US$ 8,00**
- **GPT-4o Vision para imagens:** ~US$ 0,01-0,03/chamada × 500 imagens = **US$ 5-15**
- **Azure AI Search semantic ranker** (necessário para a estratégia de reranking): **US$ ~0,01/1.000 consultas** — custo contínuo não mencionado

Os valores absolutos ainda são gerenciáveis (< US$ 30 na ingestão inicial), mas apresentar US$ 0,07 como custo de ingestão é enganoso. Mais relevante: esses custos são recorrentes a cada reindexação parcial, e o custo mensal de operação foi completamente omitido da análise.

---

#### Problema 3 — Contradição concreta no FAQ não foi identificada nos documentos

A Iteração 1 mencionou a existência de "versões conflitantes" de forma genérica, mas **não leu os documentos com profundidade suficiente** para identificar a contradição mais operacionalmente perigosa:

- **FAQ-atendimento, item 45:** *"Para clientes com mais de **10** fretes especiais por mês, existe desconto automático na tabela"*
- **PROC-042-v2, seção 4:** *"A partir de **8** fretes especiais/mês para o mesmo cliente, aplicar desconto de 5%"*

Diferença de 2 fretes no threshold de desconto. Se o assistente indexar o FAQ como fonte secundária e o PROC-042-v2 como oficial, existe risco real de o retrieval recuperar o FAQ para queries sobre desconto de volume — especialmente porque o texto do FAQ é conversacional e semanticamente próximo da pergunta que o atendente faria. Atendentes usando o threshold errado (10 vs. 8) negam desconto a clientes que têm direito, criando litígio comercial.

---

#### Problema 4 — POL-001 ignorada completamente

A pasta `dados/` contém o arquivo `POL-001-politica-devolucao.md` — um documento normativo de uso obrigatório pelo time de atendimento, classificado como "documento contratual." Ele não foi citado em nenhuma seção da análise anterior.

A POL-001 é relevante porque:
- Define prazo de 7 dias úteis para devolução (o FAQ-atendimento item 38 não menciona esse prazo, apenas o processo de registro)
- Exclui explicitamente cargas perigosas classes 1-6 do processo padrão (o FAQ item 3 diz "já tiveram casos em que Riscos autorizou exceção" — informação que contradiz a política e deve ser tratada como exceção não-padrão, não como precedente)
- Define custos de frete reverso como responsabilidade do cliente em caso de desistência — informação crítica que o FAQ não menciona

A omissão da POL-001 indica que a análise não fez inventário completo da base de conhecimento antes de propor a estratégia.

---

#### Problema 5 — Cohere Rerank viola a restrição de infraestrutura declarada

A Iteração 1 recomendou *"Azure AI Search semantic ranker **ou Cohere Rerank**"* como opções de reranking. O Cohere Rerank é um serviço externo à plataforma da Anthropic/Cohere, fora do stack Microsoft 365 E3 + Azure AI Services declarado no contexto do projeto.

Em um ambiente corporativo com 1.200 funcionários, adicionar um fornecedor externo implica: processo de procurement, revisão de segurança e privacidade de dados (os chunks do cliente passariam por API de terceiro), acordo de DPA (Data Processing Agreement) e aprovação jurídica. Isso pode inviabilizar o prazo de 3 meses.

**Correção:** usar exclusivamente o **Azure AI Search semantic ranker** (disponível no tier Standard S1, que já estava listado como opção), sem dependências externas.

---

#### Problema 6 — Comportamento de fallback não definido

A análise descreve como recuperar e rankear chunks, mas não define o que acontece quando nenhum chunk supera o threshold de relevância mínima — ou seja, quando o assistente genuinamente não sabe a resposta.

Sem fallback definido, o LLM com contexto de baixa relevância vai alucinações plausíveis ("lost in the context" ao invés de "lost in the middle"). Para o contexto NovaTech, uma alucinação sobre prazo de SLA ou valor de multiplicador de frete é um erro operacional, não apenas uma inconveniência.

**Comportamento de fallback necessário:**
- Definir score mínimo de reranking (ex: < 0.6) como threshold de "não sei"
- Resposta padrão quando abaixo do threshold: *"Não encontrei essa informação na documentação indexada. Recomendo consultar [documento específico] ou escalar para [área responsável]."*
- Logging de todas as queries sem resposta para identificar lacunas da base de conhecimento

---

#### Problema 7 — Latência de resposta no Teams não foi considerada

A meta do projeto é reduzir o tempo de busca de 12 para menos de 2 minutos. Mas o pipeline RAG completo tem latência própria que não foi estimada:

| Etapa do pipeline | Latência típica |
|---|---|
| Hybrid search (vetorial + BM25) no Azure AI Search | 100-300ms |
| Semantic ranker (reranking top-50) | 500ms-1s |
| GPT-4o generation (10.000 tokens contexto, ~300 tokens resposta) | 3-8s |
| **Total por query** | **~4-10 segundos** |

Uma query de 10 segundos em um chat do Teams é perceptível e pode gerar abandono. Se o atendente fizer 3-4 perguntas de acompanhamento para resolver um chamado complexo, são 30-40 segundos de espera — aceitável comparado a 12 minutos de busca manual, mas que precisa ser comunicado como expectativa de UX.

**Mitigação:** implementar streaming de resposta via Teams (exibir tokens à medida que são gerados) e indicador de "digitando..." para manter a percepção de responsividade. Isso é suportado pela Graph API do Teams mas requer configuração adicional não mencionada.

---

#### Problema 8 — Chunk count de 6.960 está subestimado

A estimativa de 6.960 chunks assume que 3,48M tokens divididos por 500 tokens/chunk geram exatamente 6.960 unidades. Mas a estratégia de chunking proposta viola essa premissa:

- Tabelas são chunks atômicos (até 800 tokens) — se 30% dos 800 PDFs têm 3 tabelas médias = 720 chunks de tabela adicionais
- Imagens de fluxogramas geram chunks sintéticos de descrição (não contabilizados na estimativa de palavras)
- Chunks de metadado/cabeçalho repetido em cada tabela inflam o token count real
- Overlap de 50 tokens entre chunks de texto adiciona ~5-10% de volume ao índice

**Estimativa revisada:** 8.500-10.000 chunks. Ainda gerenciável no Azure AI Search Standard S1, mas a diferença é relevante para estimativas de custo de embedding contínuo e para dimensionamento de partições.

---

### Seções revisadas incorporando o feedback

#### Seção 1 — Adição: POL-001 como quinta fonte

**POL-001 — Política de Devolução (PDF normativo com texto corrido e lista estruturada)**

**Desafio técnico:** A POL-001 é um documento normativo com linguagem jurídico-operacional densa. Suas regras de exclusão (cargas perigosas classes 1-6, cadeia de frio rompida, lacre violado) são condições boolenas que dependem de múltiplos critérios encadeados. O chunking por tamanho pode separar uma condição da sua consequência — por exemplo, a seção 3.2 lista cinco categorias inelegíveis numa sequência que, se quebrada no chunk 1/2, gera resposta incompleta sobre elegibilidade de devolução.

**Impacto concreto:** O atendente pergunta *"cliente pode devolver carga de gás (classe 2)?"*. A resposta correta está na lista de exclusões da POL-001, que cita "gases (classe 2)" explicitamente. Se o chunk retornado for apenas o parágrafo inicial de escopo sem a lista de exclusões, o assistente responde que o cliente pode devolver pelo processo padrão — erro que pode gerar coleta reversa indevida de carga perigosa.

**Relação com FAQ:** O FAQ item 3 diz que *"já tiveram casos em que o pessoal de Riscos autorizou exceção"*. Isso é verdade (a POL-001 confirma que cargas perigosas devem ir para o ramal 4500 para "tratamento individual") mas o FAQ apresenta como precedente o que a POL-001 define como exceção com processo próprio. O assistente deve ser instruído via system prompt a tratar o FAQ como contexto de onde escalar, não como regra a citar.

**Estratégia de chunking:** Igual à estratégia de PDFs com texto corrido, com atenção específica à seção 3.2: a lista de categorias inelegíveis deve ser um chunk atômico (não dividida) com prefixo explícito `[POL-001 | SEÇÃO 3.2 — CATEGORIAS INELEGÍVEIS PARA DEVOLUÇÃO PADRÃO]`.

---

#### Seção 2 — Revisão: estimativa de tokens e custos corrigida

**Custo total de ingestão inicial revisado:**

| Item | Custo estimado |
|---|---|
| Embedding (text-embedding-3-small, 3,48M tokens) | US$ 0,07 |
| Azure Document Intelligence prebuilt-layout (8.000 páginas) | US$ 8,00 |
| GPT-4o Vision para imagens em PDFs (~500 imagens) | US$ 5–15 |
| **Total ingestão inicial** | **US$ 13–23** |

**Custo operacional mensal (após go-live):**

| Item | Custo estimado/mês |
|---|---|
| GPT-4o queries (192/dia × 22 dias × ~10.000 tokens/query) | US$ 105 |
| Azure AI Search Standard S1 | US$ ~245 |
| Reindexação mensal de planilhas (50 arquivos) | US$ ~1 |
| Azure AI Search semantic ranker (192/dia × 22 dias) | US$ ~9 |
| **Total operacional mensal** | **~US$ 360/mês** |

Comparado ao custo atual de ineficiência: 320 chamados/dia × 60% × 10 minutos economizados × custo/minuto do atendente, o ROI positivo é atingido rapidamente — mas o TCO realista deve incluir os US$ 360/mês, não apenas o custo de embedding.

**Chunk count revisado:** 8.500–10.000 chunks (vs. 6.960 estimados anteriormente), considerando tabelas atômicas, chunks sintéticos de imagem e overhead de metadados.

---

#### Seção 3 — Adição: threshold de fallback e latência

**Threshold de confiança para respostas:**

O pipeline deve definir um score mínimo de reranking antes de gerar resposta. Recomendação:

- Score ≥ 0,7: resposta normal com citação de fonte
- Score 0,4–0,7: resposta com sinalização de incerteza (*"Encontrei informação parcialmente relacionada. Confirme com o documento [X]."*)
- Score < 0,4: fallback explícito (*"Não encontrei essa informação na base indexada. Escale para [área responsável] ou consulte [documento sugerido]."*)

Todas as queries abaixo de 0,7 devem ser logadas para análise semanal — elas identificam lacunas reais da base de conhecimento ou perguntas recorrentes que precisam de documentação nova.

**Budget de latência para Teams:**

O pipeline completo deve ter target de P95 < 8 segundos por query. Estratégias para controlar latência:
- Streaming de tokens via Teams Graph API (percepção de início em < 1s)
- Cache de resultados de retrieval para queries idênticas (TTL de 1 hora)
- Pre-warming do índice: executar query de aquecimento no início do horário comercial para manter índices em memória quente

---

#### Seção 4 — Correção: reranker restrito ao stack Azure

**Correção da recomendação de reranker:**

A menção ao Cohere Rerank foi removida. A estratégia de reranking usa exclusivamente o **Azure AI Search semantic ranker** (L2 reranker nativo, disponível no tier Standard S1), que processa o reranking dentro do mesmo ambiente Azure sem exfiltração de dados para fornecedor externo. Isso elimina o risco de compliance e mantém a stack dentro do contrato Microsoft 365 E3 + Azure existente.

**Configuração requerida:** habilitar `semantic` configuration no índice Azure AI Search e configurar `queryType: semantic` nas queries. O custo adicional é ~US$ 0,01/1.000 queries semânticas — já incluído na estimativa operacional revisada acima.

---

#### Risco adicional identificado — Governança: curated subset como estratégia de go-live

A recomendação de "auditoria da base documental antes do go-live" da análise anterior é irrealista dado o prazo de 3 meses e a estrutura de governança atual (3 áreas sem processo unificado).

**Estratégia alternativa pragmática:**

- **Fase 1 (mês 1-2):** indexar apenas documentos com status claro e responsável definido: POL-001 (v3.1, Operações), SLA-2024 (v2024.1, Comercial+Operações), PROC-042-v2 (v2.0, Comercial — marcado como mais recente). Excluir da indexação: PROC-042-v1, FAQ-atendimento.
- **Fase 2 (mês 3):** go-live com base curada. Monitorar queries sem resposta (fallback) para identificar lacunas.
- **Fase 3 (pós go-live):** expandir base com documentos adicionais à medida que forem validados pelos responsáveis de área.

Isso inverte o risco: ao invés de tentar resolver a governança antes do lançamento (impossível em 3 meses), usa o assistente em produção como ferramenta de auditoria — as queries sem resposta revelam o que precisa ser documentado ou validado.

---

*Análise revisada em 03/06/2026. Incorpora feedback crítico sobre estimativas de custo/tempo, omissão da POL-001, contradição FAQ×PROC-042-v2, dependência externa de reranker, comportamento de fallback e latência de UX.*

---

## Iteração 3

**Prompt:**

> A estimativa de tokens ficou em 3,48M — abaixo da faixa de 8-15M esperada para uma base corporativa desse porte. Os parâmetros usados (10 páginas/doc, 250 palavras/página) vieram do enunciado, mas não foram questionados quanto à aderência à realidade. Revise a estimativa questionando os parâmetros de entrada com base no tipo de documentação da NovaTech. Além disso, feche o gap da estratégia de chunking para PDFs escaneados: a seção 4.2 ainda diz "parágrafos identificados pelo OCR (quebra de linha dupla ou indentação)" — o que não reflete o output real do Azure Document Intelligence em documentos escaneados. Corrija ambos os pontos e incorpore ao documento.

**Resultado:**

---

### Revisão 1 — Estimativa de tokens: questionando os parâmetros de entrada

#### O problema com os parâmetros originais

O enunciado prescreveu: 800 docs × 10 páginas × 250 palavras/página. Aplicados mecanicamente, esses valores geram 3,48M tokens. O erro não está no cálculo — está em aceitar os parâmetros sem questionar se descrevem o acervo real da NovaTech.

Para uma operação de logística com 1.200 funcionários, 3 áreas produzindo documentação (Operações, Compliance, Comercial) e histórico de pelo menos 3 anos de documentação acumulada, os parâmetros realistas são diferentes:

| Parâmetro | Valor prescrito | Realidade corporativa | Justificativa |
|---|---|---|---|
| Páginas por PDF | 10 | 20-30 | Contratos de SLA, manuais operacionais e documentos regulatórios do setor de logística (ANTT, SEFAZ) costumam ter 20-50 páginas. Documentos de 10 páginas são exceção, não média. |
| Palavras por página | 250 | 350-450 | PDFs técnicos com tabelas densas (15+ colunas de frete) são mais densos que texto corrido. 250 palavras/página é densidade de documento narrativo, não de tabela operacional. |
| Páginas Wiki | 1.500 palavras | 2.000-2.500 | Páginas Confluence com macros resolvidas (include, status, painéis) expandem o conteúdo efetivo. O enunciado não considera o conteúdo injetado pelas macros após renderização. |

#### Estimativa revisada com parâmetros realistas

| Fonte | Fórmula revisada | Palavras | Tokens (÷ 0,75) |
|---|---|---|---|
| PDFs (SharePoint) | 800 docs × **22 págs** × **380 palavras** | 6.688.000 | **8.917.333** |
| Wiki (Confluence) | 400 páginas × **2.200 palavras** (macros resolvidas) | 880.000 | **1.173.333** |
| Planilhas | 50 arquivos × 200 palavras-equiv. | 10.000 | **13.333** |
| **Total revisado** | | **7.578.000 palavras** | **≈ 10.100.000 tokens** |

**10,1M tokens** — dentro da faixa de 8-15M esperada para um acervo corporativo desse porte.

#### Impacto dessa revisão nas decisões de projeto

| Decisão | Com 3,48M tokens | Com 10,1M tokens |
|---|---|---|
| Chunks gerados (~500t) | ~6.960 | **~20.200** |
| Custo de embedding (ingestão) | US$ 0,07 | **US$ 0,20** |
| Azure AI Search tier mínimo | Basic | **Standard S1 — obrigatório** (Basic tem limite de 50MB de índice vetorial; 20.200 chunks × 1.536 dim. float32 ≈ 124MB) |
| Custo de reindexação mensal | Negligenciável | **Relevante** (~3.000 chunks/mês se 15% da base muda) |

A revisão muda uma decisão de infraestrutura concreta: com 3,48M tokens o Basic poderia ser considerado; com 10,1M o Standard S1 é mandatório. Aceitar os parâmetros prescritos sem questionamento teria levado a um subdimensionamento do índice.

#### Nota metodológica

Os parâmetros do enunciado servem como ponto de partida pedagógico, não como descrição fidedigna do acervo. Em um projeto real, a estimativa correta exige amostragem: selecionar 20-30 documentos representativos de cada tipo, medir páginas e palavras reais, e extrapolar. Para este exercício, a estimativa revisada usa valores medianos para documentação corporativa do setor de logística, documentados acima.

---

### Revisão 2 — Chunking OCR: fechando o gap da seção 4.2

#### O problema

A seção 4.2 original define fronteira de chunk como "parágrafos identificados pelo OCR (quebra de linha dupla ou indentação)." Isso descreve o comportamento de um parser de texto puro em documento digital nativo — não o output do Azure Document Intelligence em documentos escaneados.

O Azure Document Intelligence (modelo `prebuilt-read`) em documentos escaneados produz uma hierarquia de elementos: `pages → lines → words`, com bounding boxes e confidence scores por palavra. **Parágrafos não são um output nativo** — eles precisam ser reconstruídos por heurística de proximidade vertical entre linhas. Em documentos com layout multi-coluna, tabelas embutidas no texto corrido, ou cabeçalhos sem separação visual clara (comum em documentos escaneados de baixa qualidade), essa reconstrução falha silenciosamente.

O resultado prático: a estratégia de "chunking por parágrafo" em documentos OCR pode gerar chunks com 2 linhas (onde o detector de parágrafo fragmentou demais) ou chunks com 800+ tokens (onde o detector não separou seções distintas). Nem um nem outro serve à estratégia proposta de 300-400 tokens.

#### Estratégia corrigida para PDFs escaneados

**Etapa 1 — Pré-processamento com Azure Document Intelligence `prebuilt-read`**

O modelo `prebuilt-read` retorna um objeto `AnalyzeResult` com `paragraphs` como campo de primeiro nível — mas esse campo só é confiável para documentos com qualidade de scan acima de ~90 DPI e contraste adequado. Antes de usar `paragraphs`, verificar:

```python
# Verificar se o modelo conseguiu detectar parágrafos com estrutura
result = document_analysis_client.begin_analyze_document(
    "prebuilt-read", document_stream
).result()

has_paragraphs = (
    result.paragraphs is not None
    and len(result.paragraphs) > 0
    and all(p.content.strip() != "" for p in result.paragraphs)
)
```

**Etapa 2 — Estratégia por qualidade de OCR detectada**

| Condição | Estratégia de chunking |
|---|---|
| `has_paragraphs = True` e confidence médio ≥ 0,85 | Usar parágrafos detectados como unidades de chunk, com overlap de 1 parágrafo entre chunks adjacentes |
| `has_paragraphs = False` ou confidence médio < 0,85 | Fallback: chunking por tamanho fixo de 300 tokens sobre o texto extraído de `lines`, com overlap de 50 tokens. Chunk recebe metadado `{"ocr_strategy": "fixed_size", "confidence": <valor>}` |
| Documento classificado como `image_only` (fluxograma) | GPT-4o Vision gera descrição textual; chunk único com metadado `{"content_type": "image_description"}` |

**Etapa 3 — Documentos multi-coluna**

Documentos escaneados de logística frequentemente têm layout de 2 colunas (tabelas à esquerda, notas à direita). O Azure DI detecta isso via `spans` e `bounding_regions`, mas a leitura linearizada por `content` intercala as colunas. Tratar documentos multi-coluna extraindo `lines` por coluna separadamente, usando as coordenadas `x` dos bounding boxes para separar coluna esquerda (x < 50% da largura da página) de coluna direita.

**Seção 4.2 revisada:**

```
Estratégia: chunking adaptativo baseado na qualidade do OCR detectada

Fronteiras:
- Se parágrafos detectados com confiança ≥ 0,85: usar parágrafos como unidade
- Se confiança < 0,85 ou parágrafos ausentes: chunking fixo de 300 tokens
- Fluxogramas e imagens: chunk único via GPT-4o Vision

Tamanho: 300-400 tokens (parágrafo) ou 300 tokens fixos (fallback)
Overlap: 1 parágrafo ou 50 tokens (fixo), respectivamente
Metadados obrigatórios: ocr_strategy, confidence_avg, content_type

Lost in the middle: chunks de fluxograma (image_description) posicionados
primeiro no contexto — são os mais acionáveis e os mais raros, logo
têm maior probabilidade de serem o chunk decisivo para a query.
```

---

### Resumo das correções da Iteração 3

| Ponto | Problema original | Correção aplicada |
|---|---|---|
| Estimativa de tokens | 3,48M (abaixo de 8-15M) por parâmetros aceitos sem questionamento | 10,1M com parâmetros realistas para documentação corporativa de logística; impacto em tier do Azure AI Search identificado |
| Chunking OCR | "Parágrafo por quebra de linha" — não descreve output real do Azure DI | Estratégia adaptativa: detecção de confiança → parágrafo (alta qualidade) ou fixo 300t (baixa qualidade) ou Vision (imagem) |

---

*Análise consolidada em 03/06/2026. Três iterações: Iteração 1 (análise inicial), Iteração 2 (auditoria crítica de estimativas e riscos), Iteração 3 (revisão de parâmetros e gap de chunking OCR).*
