# Resolução — Exercício 3.2

## Revisão crítica de código gerado por IA

**Papel:** Desenvolvedor
**Tópico:** Revisão Crítica de Outputs de IA
**Ferramentas:** Claude (chat) + GitHub Copilot
**Arquivo alvo:** `novatech-assistant/src/functions/feedback/handler.ts`

> **Fluxo do exercício (humano primeiro):** primeiro EU reviso (seção 2), sem ajuda do Claude.
> Só depois o Claude faz a segunda revisão (seção 3) e comparamos (seção 4).

---

## 1. Código gerado pelo Copilot (a revisar)

```typescript
// feedback-handler.ts — gerado pelo Copilot
import { app, HttpRequest, HttpResponseInit } from '@azure/functions';

export async function feedbackHandler(
  request: HttpRequest
): Promise<HttpResponseInit> {
  const body = await request.json() as any;

  const feedback = {
    queryId: body.queryId,
    rating: body.rating,
    comment: body.comment,
    attendantEmail: body.attendantEmail,
    timestamp: new Date().toISOString()
  };

  console.log('Feedback recebido:', JSON.stringify(feedback));

  const { CosmosClient } = require('@azure/cosmos');
  const client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
  const database = client.database('novatech');
  const container = database.container('feedbacks');

  await container.items.create(feedback);

  return { status: 200, body: 'OK' };
}

app.http('feedback', {
  methods: ['POST'],
  handler: feedbackHandler
});
```

### Regras do AGENTS.md a verificar (resumo)

- TypeScript **strict mode**.
- **Zod** para validação de input.
- **pino** para logging (nunca `console.log`).
- **Nunca logar dados pessoais** (e-mail, nome).
- **Imports estáticos** no topo (nunca `require` dinâmico).

---

## 2. Minha revisão (humano — ANTES do Claude)

> Preencha antes de rodar o Claude. Classifique cada problema como:
> **[AGENTS]** violação do AGENTS.md · **[SEG]** segurança · **[BUG]** bug potencial.

| # | Problema encontrado | Classificação | Linha(s) |
|---|---------------------|---------------|----------|
| 1 | Não há tipagem estrita: o corpo é lido com `as any` e o objeto depende de inferência de tipo. Isso não deveria ser possível num projeto que exige TypeScript strict mode. | [AGENTS] | 7 |
| 2 | Não foi usado o Zod. O objeto só passa por um `JSON.stringify` no log, mas os dados **nunca são validados/parseados** contra um schema. | [AGENTS] / [BUG] | 7, 9–15 |
| 3 | Logging feito com `console.log`, em vez da lib de log do projeto (**pino**). | [AGENTS] | 17 |
| 4 | Está logando o `attendantEmail` (dado pessoal). | [SEG] | 13, 17 |
| 5 | `require` dinâmico do `@azure/cosmos` no meio da função, em vez de import estático no topo. | [AGENTS] | 19 |

**Observações livres:**

Os cinco problemas concentram-se em duas frentes: (a) o código ignora as convenções do AGENTS.md
(strict mode, Zod, pino, import estático) e (b) trata dados sensíveis de forma insegura — o
`attendantEmail` acaba em log. A ausência de validação Zod (item 2) é a mais grave em termos de
robustez: o handler confia cegamente no corpo da requisição.

---

## 3. Revisão do Claude

### 3.1. Confirma os problemas da revisão humana

O Claude confirma os cinco pontos da seção 2 — em especial as quatro violações do AGENTS.md
(`as any` sem Zod, `console.log`, `require` dinâmico) e o dado pessoal em log (`attendantEmail`).
Nada a acrescentar ou corrigir nesses: são reais e bem classificados.

### 3.2. Problemas adicionais (não listados na revisão humana)

| # | Problema | Classificação | Linha(s) |
|---|----------|---------------|----------|
| C1 | **Sem tratamento de erro.** Não há `try/catch`. Se `request.json()` falhar (JSON inválido) ou `container.items.create` lançar (Cosmos indisponível), a exceção sobe sem tratamento → 500 genérico, possível vazamento de stack e sem log estruturado do erro. | [BUG] / [SEG] | 7, 30 |
| C2 | **`CosmosClient` instanciado a cada requisição.** O cliente deveria ser um singleton em nível de módulo (reuso de conexão). Criar um novo cliente por chamada é ineficiente e pode esgotar conexões sob carga. | [BUG] / performance | 20–24 |
| C3 | **`attendantEmail` vem do corpo da requisição, não de identidade autenticada.** Qualquer um pode enviar feedback em nome de outro atendente (spoofing). Além de logar (item 4), a origem do dado não é confiável. | [SEG] | 13 |
| C4 | **Nenhuma validação de domínio dos campos.** Mesmo com Zod, é preciso checar regras: `rating` dentro de uma faixa (ex.: 1–5), `queryId` presente/no formato certo, `comment` com tamanho máximo. Sem isso, lixo é persistido silenciosamente. | [BUG] | 10–13 |
| C5 | **Acesso direto a `process.env`** em vez do módulo de config validado do projeto (`src/shared/config.ts`). Se `COSMOS_CONNECTION_STRING` estiver ausente, a falha é obscura e tardia. | [AGENTS] / [BUG] | 21 |
| C6 | **`comment` é texto livre do atendente** — pode conter dados pessoais além do e-mail. É logado e persistido sem qualquer tratamento; o risco de PII não se limita ao `attendantEmail`. | [SEG] | 12, 17 |
| C7 | **Resposta não estruturada** (`body: 'OK'` em texto puro), divergindo do padrão do projeto (JSON, ex.: `query/handler.ts`) e sem retornar o id do registro criado. | smell / consistência | 33 |

> Nota: os itens C1–C4 são os mais relevantes. C5–C7 são de qualidade/consistência.

---

## 4. Comparação humano × Claude

| Achado | Humano (seção 2) | Claude (seção 3) |
|--------|:---:|:---:|
| `as any` / sem tipagem estrita | ✅ | ✅ |
| Falta de Zod (input não validado) | ✅ | ✅ |
| `console.log` em vez de pino | ✅ | ✅ |
| `attendantEmail` logado (PII) | ✅ | ✅ |
| `require` dinâmico | ✅ | ✅ |
| Sem `try/catch` / tratamento de erro | — | ✅ (C1) |
| `CosmosClient` recriado por requisição | — | ✅ (C2) |
| `attendantEmail` do corpo (spoofing) | — | ✅ (C3) |
| Sem validação de domínio (`rating` etc.) | — | ✅ (C4) |
| `process.env` fora do config validado | — | ✅ (C5) |
| `comment` pode conter PII | — | ✅ (C6) |
| Resposta em texto puro, sem id | — | ✅ (C7) |

**Leitura honesta:** a revisão humana capturou **todas as violações explícitas do AGENTS.md e o
problema de PII** — ou seja, as quatro armadilhas obrigatórias do exercício, de forma independente.
O Claude não corrigiu nem contradisse nada dessa lista; ele **ampliou** a cobertura para problemas
de robustez (erro/validação de domínio), performance (cliente por requisição) e segurança mais ampla
(spoofing de identidade, PII no `comment`) — categorias que o enunciado não exigia, mas que importam
para produção. Não houve "concordamos em tudo": as listas se complementam, com o humano firme nas
regras do projeto e o Claude somando os riscos sistêmicos.

---

## 5. Código reescrito (seguindo o AGENTS.md)

Reescrito **via GitHub Copilot** e dividido em dois arquivos, com uma seção `cosmos` adicionada ao
`config.ts` (corrigindo o C5). `npm run build` → EXIT 0; suíte existente → 30/30.

### `src/shared/config.ts` (trecho adicionado)

```typescript
const cosmosConnectionString = process.env['COSMOS_CONNECTION_STRING'];
if (!cosmosConnectionString) throw new Error('COSMOS_CONNECTION_STRING is required');

export const config = {
  // ...openai, search...
  cosmos: {
    connectionString: cosmosConnectionString,
    database: 'novatech',
    container: 'feedbacks',
  },
};
```

### `src/functions/feedback/validator.ts`

```typescript
import { z } from 'zod';

export const FeedbackInputSchema = z.object({
  queryId: z.string().uuid('queryId must be a valid UUID'),
  rating: z
    .number({ required_error: 'rating is required', invalid_type_error: 'rating must be a number' })
    .int('rating must be an integer')
    .min(1, 'rating must be between 1 and 5')
    .max(5, 'rating must be between 1 and 5'),
  comment: z.string().max(1000, 'comment must be at most 1000 characters').optional(),
  attendantEmail: z.string().email('attendantEmail must be a valid email'),
});

export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;
```

### `src/functions/feedback/handler.ts`

```typescript
import { randomUUID } from 'node:crypto';
import { CosmosClient } from '@azure/cosmos';
import { z } from 'zod';
import { config } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';
import { FeedbackInputSchema } from './validator.js';

// Singleton em nível de módulo — reuso de conexão (corrige C2).
const cosmosClient = new CosmosClient(config.cosmos.connectionString);
const feedbackContainer = cosmosClient
  .database(config.cosmos.database)
  .container(config.cosmos.container);

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function toValidationErrors(issues: z.ZodIssue[]): Array<{ path: string; message: string }> {
  return issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export async function feedbackHandler(request: Request): Promise<Response> {
  const requestId = randomUUID();

  let body: unknown; // sem `as any` (corrige item 1)
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400); // corrige C1
  }

  const parsed = FeedbackInputSchema.safeParse(body); // Zod (corrige item 2 e C4)
  if (!parsed.success) {
    return jsonResponse({ error: toValidationErrors(parsed.error.issues) }, 400);
  }

  const feedback = { ...parsed.data, timestamp: new Date().toISOString() };

  try {
    const { resource } = await feedbackContainer.items.create(feedback);
    const id = resource?.id ?? null;

    // pino, sem PII: nada de attendantEmail nem comment (corrige item 3, item 4, C6)
    logger.info({
      request_id: requestId,
      query_id: feedback.queryId,
      rating: feedback.rating,
      feedback_id: id,
      msg: 'Feedback stored',
    });

    return jsonResponse({ id }, 201); // JSON estruturado (corrige C7)
  } catch (err: unknown) {
    logger.error({
      request_id: requestId,
      query_id: feedback.queryId,
      rating: feedback.rating,
      err,
      msg: 'Failed to store feedback',
    });
    return jsonResponse({ error: 'Internal server error' }, 500); // sem vazar stack (C1)
  }
}
```

### Review da reescrita (Claude)

Todos os problemas das seções 2 e 3 foram corrigidos, exceto:

- **C3 (spoofing) — limitação conhecida.** `attendantEmail` ainda vem do corpo, não de identidade
  autenticada. Fora do escopo (o projeto não tem infraestrutura de auth); registrado como melhoria
  futura, não defeito.
- **Menor:** o log de erro registra o objeto `err` completo (consistente com `query/handler.ts`;
  risco baixo, pois o erro do Cosmos não costuma conter o payload).

Nenhuma violação do AGENTS.md foi reintroduzida.

```
$ npm run build   →  EXIT 0
$ npm test        →  Test Files 3 passed (3) | Tests 30 passed (30)
```

---

## Mapa de evidências × critérios de avaliação (3.2)

| Critério (Score 3) | Evidência |
|--------------------|-----------|
| Análise própria ANTES do Claude | Seção 2 — 5 problemas identificados de forma independente, cobrindo as 4 armadilhas obrigatórias |
| Comparação humano × Claude honesta | Seção 4 — tabela lado a lado; humano pegou todas as obrigatórias, Claude ampliou (C1–C7); sem "concordamos em tudo" |
| Código reescrito segue o AGENTS.md | Seção 5 — Zod, pino, import estático, sem logar e-mail/comment; build e testes verdes |
| Armadilhas obrigatórias (`as any`, `console.log`, `require`, e-mail logado) | Todas na análise própria (seção 2) → D4 alto |
