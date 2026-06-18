# Tasks — Query Endpoint

> Gerado a partir de `plan.md`. Aprovação do Tech Lead obrigatória antes de iniciar T-01.

---

## T-01 — Definir schema Zod de input do POST /api/query

**Descrição:** Criar o schema Zod que valida o body da requisição recebida pelo endpoint.  
**Critérios de aceite:**
- [x] Schema rejeita body sem campo `question` com erro de validação
- [x] Schema rejeita `question` vazia (string vazia ou só espaços em branco)
- [x] Schema aceita `question` com até 1.000 caracteres
- [x] Tipo TypeScript `QueryInput` é inferido e exportado do schema  
**Dependências:** nenhuma  
**Estimativa:** P

---

## T-02 — Definir schema Zod de output do endpoint

**Descrição:** Criar o schema Zod que descreve a resposta retornada ao cliente, incluindo `answer` e `source_documents`.  
**Critérios de aceite:**
- [x] Schema inclui campo `answer` (`string | null`)
- [x] Schema inclui campo `source_documents` como array de objetos com pelo menos `title` e `chunk_id`
- [x] Tipo TypeScript `QueryOutput` é inferido e exportado do schema
- [x] Schema valida que `source_documents` é um array (vazio ou preenchido)  
**Dependências:** nenhuma  
**Estimativa:** P

---

## T-03 — Configurar cliente Azure OpenAI com retry e structured logging

**Descrição:** Instanciar e exportar o cliente Azure OpenAI configurado com exponential backoff e logger pino integrado.  
**Critérios de aceite:**
- [x] Cliente exportado como singleton reutilizável
- [x] Retry com exponential backoff dispara em erros 429 e 5xx do Azure OpenAI
- [x] Número máximo de tentativas e delay base são configuráveis via variável de ambiente
- [x] Cada tentativa de retry emite log estruturado com `attempt`, `delay_ms` e `error_code` via pino  
**Dependências:** nenhuma  
**Estimativa:** P

---

## T-04 — Configurar cliente Azure AI Search com retry e structured logging

**Descrição:** Instanciar e exportar o cliente Azure AI Search configurado com exponential backoff e logger pino integrado.  
**Critérios de aceite:**
- [x] Cliente exportado como singleton reutilizável
- [x] Retry com exponential backoff dispara em erros 429 e 5xx do Azure AI Search
- [x] Número máximo de tentativas e delay base são configuráveis via variável de ambiente
- [x] Cada tentativa de retry emite log estruturado com `attempt`, `delay_ms` e `error_code` via pino  
**Dependências:** nenhuma  
**Estimativa:** P

---

## T-05 — Implementar função de geração de embedding

**Descrição:** Criar a função que recebe uma string de pergunta e retorna o vetor de embedding via Azure OpenAI.  
**Critérios de aceite:**
- [x] Função aceita `question: string` e retorna `number[]`
- [x] Usa o cliente configurado em T-03
- [x] Lança erro tipado quando Azure OpenAI retorna falha após todas as tentativas de retry
- [x] Emite log estruturado com `question_length` e `embedding_dimensions` ao concluir com sucesso  
**Dependências:** T-03  
**Estimativa:** P

---

## T-06 — Implementar função de busca de chunks no Azure AI Search

**Descrição:** Criar a função que recebe o vetor de embedding e retorna os top-5 chunks mais relevantes do índice.  
**Critérios de aceite:**
- [x] Função aceita `embedding: number[]` e retorna array de até 5 chunks
- [x] Quando Azure AI Search retorna 0 resultados, a função retorna `[]` sem lançar erro
- [x] Usa o cliente configurado em T-04
- [x] Cada chunk retornado inclui `title`, `chunk_id` e `content`
- [x] Emite log estruturado com `results_count` ao concluir  
**Dependências:** T-04  
**Estimativa:** P

---

## T-07 — Implementar montagem de prompt respeitando context budget

**Descrição:** Criar a função que monta o prompt final concatenando system prompt, chunks e pergunta, respeitando o budget de ~4K tokens para system e ~8K para chunks (ADR-0002).  
**Critérios de aceite:**
- [x] Função lê o system prompt de `/prompts/system-prompt.md`
- [x] Chunks são truncados ou removidos até que o total fique dentro do budget de 8K tokens
- [x] A pergunta original é sempre incluída no prompt final
- [x] Função retorna o prompt montado como string  
**Dependências:** T-06  
**Estimativa:** M

---

## T-08 — Implementar chamada ao GPT-4o e extração da resposta

**Descrição:** Criar a função que envia o prompt montado ao GPT-4o via Azure OpenAI e extrai a resposta em texto.  
**Critérios de aceite:**
- [x] Função aceita o prompt como string e retorna `answer: string`
- [x] Usa o cliente configurado em T-03
- [x] Lança erro tipado quando GPT-4o retorna falha após todas as tentativas de retry
- [x] Emite log estruturado com `prompt_tokens`, `completion_tokens` e `model` ao concluir com sucesso  
**Dependências:** T-03, T-07  
**Estimativa:** P

---

## T-09 — Implementar HTTP handler do Azure Function

**Descrição:** Criar o handler HTTP que orquestra o fluxo completo: validação de input → embedding → busca → montagem de prompt → GPT-4o → resposta.  
**Critérios de aceite:**
- [x] Retorna HTTP 400 quando `QueryInput` inválido (reaproveitando schema de T-01)
- [x] Retorna HTTP 200 com body validado por `QueryOutput` (T-02) em caso de sucesso
- [x] Quando Azure AI Search retorna 0 resultados, retorna `{ answer: null, source_documents: [] }` sem chamar Azure OpenAI
- [x] Retorna HTTP 500 com mensagem de erro genérica em caso de falha não tratada (sem vazar stack trace)
- [x] Cada requisição emite log estruturado com `request_id`, `question_length` e `duration_ms`  
**Dependências:** T-01, T-02, T-05, T-06, T-07, T-08  
**Estimativa:** M

---

## T-10 — Escrever testes de integração do handler

**Descrição:** Implementar testes que cobrem os caminhos principais e de erro do handler usando mocks dos clientes Azure.  
**Critérios de aceite:**
- [x] Teste cobre input inválido → retorna 400
- [x] Teste cobre busca retornando 0 resultados → retorna `{ answer: null, source_documents: [] }` sem chamar OpenAI
- [x] Teste cobre fluxo completo feliz → retorna 200 com `answer` e `source_documents`
- [x] Teste cobre falha no Azure OpenAI após retries → retorna 500
- [x] Clientes Azure são mockados (não fazem chamadas reais)  
**Dependências:** T-09  
**Estimativa:** M
