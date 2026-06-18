# Exercício 2.2 (Dev) — tasks.md, implementação com Copilot e revisão crítica

> **Escopo desta entrega:** cobre as **3 tarefas** do Dev 2.2.
> - **Tarefa 1** — `tasks.md` com tasks atômicas geradas a partir do `plan.md`.
> - **Tarefa 2** — implementação da primeira task com GitHub Copilot.
> - **Tarefa 3** — revisão crítica do código gerado: ao menos 2 pontos que precisariam de ajuste antes de um code review real.

## Conexão com o Cenário 1

Na fase anterior (cenário 1), o time construiu um protótipo de RAG com ferramentas open-source (ChromaDB + sentence-transformers) que validou a abordagem de recuperação por similaridade vetorial e identificou problemas concretos de chunking em tabelas (ADR-0004). Esse protótipo não foi para produção — seu papel foi reduzir incerteza técnica antes de qualquer compromisso com a stack Azure.

Esta implementação é a versão de produção: mesma abordagem de RAG, agora com Azure AI Search + Azure OpenAI, respeitando as decisões arquiteturais consolidadas no cenário 1:

- **Context budget** de ~4K tokens para system prompt + ~8K para chunks (ADR-0002) — refletido diretamente em `prompt-builder.ts`.
- **Documentos contraditórios** tratados com metadado de vigência no pipeline; o system prompt instrui o modelo a priorizar a versão mais recente (ADR-0003).
- **System prompt versionado** em `/prompts/system-prompt.md`, lido em runtime pelo `buildPrompt`.

---

## Tarefa 1 — tasks.md

Ver arquivo: `specs/query-endpoint/tasks.md`

---

## Tarefa 2 — Implementação com Copilot

Tasks implementadas com GitHub Copilot:

| Task | Descrição | Arquivo |
|------|-----------|---------|
| **T-01** | Schema Zod de input do POST /api/query | `src/functions/query/validator.ts` |
| **T-02** | Schema Zod de output do endpoint | `src/functions/query/validator.ts` |
| **T-03** | Cliente Azure OpenAI com retry e structured logging | `src/services/completion.ts` |
| **T-04** | Cliente Azure AI Search com retry e structured logging | `src/services/search.ts` |
| **T-05** | Função de geração de embedding | `src/services/completion.ts` |
| **T-06** | Função de busca de chunks no Azure AI Search | `src/services/search.ts` |
| **T-07** | Montagem de prompt respeitando context budget | `src/services/prompt-builder.ts` |
| **T-08** | Chamada ao GPT-4o e extração da resposta | `src/services/completion.ts` |
| **T-09** | HTTP handler do Azure Function | `src/functions/query/handler.ts` |
| **T-10** | Testes de integração do handler | `tests/integration/query-handler.test.ts` |

---

## Tarefa 3 — Revisão crítica do código gerado pelo Copilot

### Finding 1 — Copilot usou o pacote legado `@azure/openai` em vez do SDK atual `openai`

**Arquivo:** `src/services/completion.ts:9`

```ts
// Como o Copilot gerou
export const openAIClient = new AzureOpenAI({
  endpoint: config.openai.endpoint,
  apiKey: config.openai.apiKey,
  apiVersion: config.openai.apiVersion,
  deployment: config.openai.deploymentName,
});
```

A documentação atual (verificada via Context7 — `azure-sdk-for-js` README e MIGRATION.md) confirma que `deployment` **é uma propriedade válida e recomendada** no construtor do `AzureOpenAI`. O parâmetro é opcional: se definido no construtor, serve como deployment padrão para todas as chamadas; se omitido, deve ser passado como `model` em cada chamada individualmente.

O problema é: o Copilot referenciou o pacote legado `@azure/openai` (que exportava `OpenAIClient`) em vez do SDK moderno `openai` (que exporta `AzureOpenAI`). A API correta atual é:

```ts
// SDK moderno — importação correta
import { AzureOpenAI } from "openai";

export const openAIClient = new AzureOpenAI({
  endpoint: config.openai.endpoint,
  apiKey: config.openai.apiKey,
  apiVersion: config.openai.apiVersion,
  deployment: config.openai.deploymentName, // válido e recomendado
});
```

**Causa raiz:** o Copilot misturou a API do pacote legado `@azure/openai` com a do SDK moderno `openai`, que passou a ser o cliente oficial para Azure após a migração documentada no `MIGRATION.md` do azure-sdk-for-js.

**Correção:** substituir a importação de `@azure/openai` por `openai`, garantindo uso do `AzureOpenAI` moderno. Usar Context7 MCP para consultar a API atual antes de implementar integrações com bibliotecas Azure.

---

### Finding 2 — Cliente único para completion e embedding usa o deployment errado

**Arquivo:** `src/services/completion.ts:5–10` e `src/shared/config.ts:6–7`

O `config.ts` define dois deployments distintos:

```ts
deploymentName: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4o',
embeddingDeployment: process.env['AZURE_OPENAI_EMBEDDING_DEPLOYMENT'] ?? 'text-embedding-ada-002',
```

Mas o cliente exportado é instanciado apenas com `deploymentName` (GPT-4o). Quando T-05 (geração de embedding) reutilizar esse cliente, estará chamando o deployment de completion no lugar do de embedding — erro silencioso em produção que retorna vetores errados ou falha com modelo incompatível.

**Correção:** separar os clientes por responsabilidade, ou remover o deployment do construtor e passá-lo por chamada, usando `config.openai.embeddingDeployment` nas chamadas de embedding e `config.openai.deploymentName` nas de completion.

---

### Finding 5 — Type assertion desnecessária flagada pelo SonarQube (S4325)

**Arquivo:** `src/services/completion.ts` — função `extractStatusCode`

```ts
// Como o Copilot gerou
const s = (err as { status: unknown }).status;
```

Após os guards `err !== null && typeof err === 'object' && 'status' in err`, o TypeScript já estreita o tipo de `err` implicitamente — ele sabe que o objeto possui a propriedade `status`. O cast `as { status: unknown }` não altera o tipo da expressão e é desnecessário.

O SonarQube reporta isso como `typescript:S4325 — This assertion is unnecessary since it does not change the type of the expression`.

**Correção:** remover o `as` — o narrowing implícito do TypeScript é suficiente:

```ts
const s = err.status;
```

---

### Finding 3 — Exponential backoff sem jitter causa thundering herd

**Arquivo:** `src/services/completion.ts:29`

```ts
const delayMs = baseDelayMs * 2 ** (attempt - 1);
```

Backoff puramente determinístico faz com que múltiplas instâncias da Azure Function retribuam no mesmo instante exato após um erro 429. Isso reaplica a mesma carga no serviço imediatamente, potencialmente gerando novos 429s em cascata.

**Correção:** adicionar jitter aleatório ao delay:

```ts
const delayMs = baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random() * 0.5);
```

---

### Finding 6 — Tipo de domínio `Chunk` vazava detalhes do índice ao ser usado diretamente no `SearchClient` (T-05)

**Contexto:** implementação de T-05 — geração e armazenamento de embeddings.

O `SearchClient` foi tipado inicialmente com `SearchClient<Chunk>`, usando o tipo de domínio diretamente. O problema é que o índice Azure Search possui um campo vetorial (`contentVector: number[]`) que não pertence ao domínio da aplicação — forçar esse campo em `Chunk` vazaria um detalhe de infraestrutura para a camada de negócio.

Adicionalmente, `fields: ['contentVector']` (campo vetorial para busca por similaridade) e `select: ['title', 'chunk_id', 'content']` (campos de conteúdo retornados) são conceitos distintos que o Copilot tratou como equivalentes.

**Correção:** criar um tipo interno `SearchDocument` que estende `Chunk` com o campo vetorial, isolando o schema do índice da camada de domínio:

```ts
// Tipo interno que reflete o esquema do índice, incluindo o campo vetorial.
// Separado de Chunk (tipo de domínio) para não vazar detalhes do índice.
interface SearchDocument extends Chunk {
  contentVector: number[];
}

export const searchClient: SearchClient<SearchDocument> = new SearchClient<SearchDocument>(...);
```

`contentVector` é o campo de embedding no índice usado em `fields` para busca vetorial — não é um campo de conteúdo e não aparece em `select`.

---

### Finding 4 — Env vars ausentes falham silenciosamente com erro pouco descritivo

**Arquivo:** `src/shared/config.ts:3–4`

```ts
endpoint: process.env['AZURE_OPENAI_ENDPOINT'] ?? '',
apiKey: process.env['AZURE_OPENAI_API_KEY'] ?? '',
```

O fallback `''` permite que o cliente seja instanciado sem erro. A falha só ocorre na primeira chamada real, com um erro de rede ou autenticação genérico que não aponta para a variável de ambiente ausente — dificulta o diagnóstico em staging/produção.

**Correção:** validar na inicialização e lançar erro descritivo:

```ts
const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
if (!endpoint) throw new Error('AZURE_OPENAI_ENDPOINT is required');
```

---

### Finding 7 — `withSearchRetry` em `search.ts` sem jitter — mesmo problema do Finding 3

**Arquivo:** `src/services/search.ts:36`

```ts
const delayMs = baseDelayMs * 2 ** (attempt - 1); // sem jitter
```

O Copilot replicou o backoff determinístico em `search.ts` sem aplicar o mesmo jitter corrigido em `completion.ts`. O problema de thundering herd (Finding 3) existe igualmente nas chamadas ao Azure AI Search.

**Correção:** aplicar o mesmo padrão de jitter:

```ts
const delayMs = baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random() * 0.5);
```

---

### Finding 8 — `model` passado redundantemente em `generateEmbedding` e `generateCompletion`

**Arquivo:** `src/services/completion.ts:70` e `src/services/completion.ts:94`

```ts
// embeddingClient já foi criado com deployment: config.openai.embeddingDeployment
embeddingClient.embeddings.create({
  model: config.openai.embeddingDeployment, // redundante
  input: question,
});

// completionClient já foi criado com deployment: config.openai.deploymentName
completionClient.chat.completions.create({
  model: config.openai.deploymentName, // redundante
  messages: [...],
});
```

Como cada cliente foi instanciado com `deployment` no construtor (Finding 2 corrigido), o campo `model` por chamada repete o mesmo valor. Caso o deployment seja alterado no config, é necessário atualizar em dois lugares.

**Correção:** remover o `model` das chamadas — o cliente usa o deployment do construtor como padrão:

```ts
embeddingClient.embeddings.create({ input: question });
completionClient.chat.completions.create({ messages: [...] });
```

---

### Finding 9 — Inconsistência no tratamento de erros entre `generateEmbedding` e `generateCompletion`

**Arquivo:** `src/services/completion.ts:77` e `src/shared/errors.ts`

```ts
// generateEmbedding — lança erro genérico
throw new Error('Azure OpenAI returned no embedding data');

// generateCompletion — lança erro tipado
throw new OpenAICompletionError('Azure OpenAI returned empty completion');
```

`errors.ts` define `OpenAICompletionError` apenas para completion. O handler que captura erros (`queryHandler`) não consegue distinguir uma falha de embedding de uma falha de completion — ambas chegam como `Error` genérico resultando em HTTP 500 sem distinção.

**Correção:** criar `OpenAIEmbeddingError` em `errors.ts` e usá-lo em `generateEmbedding`, permitindo tratamento diferenciado por tipo de falha.

---

### Finding 10 — `process.cwd()` para localizar `system-prompt.md` é frágil

**Arquivo:** `src/services/prompt-builder.ts:12`

```ts
const systemPromptPath = join(process.cwd(), 'prompts', 'system-prompt.md');
```

`process.cwd()` depende do diretório de onde o processo é iniciado, não da localização do arquivo. Em Azure Functions, testes unitários ou containers, o diretório de trabalho pode ser diferente do root do projeto — o arquivo não é encontrado e a falha só ocorre em runtime com um erro genérico de `ENOENT`.

**Correção:** usar `import.meta.url` (módulo ES) para construir o caminho relativo ao arquivo:

```ts
import { fileURLToPath } from 'node:url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const systemPromptPath = join(__dirname, '..', '..', '..', 'prompts', 'system-prompt.md');
```

---

### Finding 11 — `extractStatusCode` duplicada em `completion.ts` e `search.ts` com propriedades diferentes

**Arquivos:** `src/services/completion.ts:54` e `src/services/search.ts:81`

```ts
// completion.ts — SDK openai usa 'status'
if ('status' in err) { ... }

// search.ts — SDK @azure/search-documents usa 'statusCode'
if ('statusCode' in err) { ... }
```

A função `extractStatusCode` foi gerada pelo Copilot nos dois arquivos de forma independente. As propriedades diferem porque os SDKs usam convenções distintas (`status` vs `statusCode`), mas a lógica de extração está duplicada. Qualquer mudança futura (ex: suporte a mais propriedades) precisa ser replicada nos dois lugares.

**Correção:** centralizar em `src/shared/errors.ts` com suporte a ambas as propriedades:

```ts
export function extractStatusCode(err: unknown): number | null {
  if (err === null || typeof err !== 'object') return null;
  if ('status' in err && typeof (err as Record<string, unknown>).status === 'number')
    return (err as Record<string, unknown>).status as number;
  if ('statusCode' in err && typeof (err as Record<string, unknown>).statusCode === 'number')
    return (err as Record<string, unknown>).statusCode as number;
  return null;
}
```
