---
name: typescript-conventions
description: "Contrato TypeScript deste projeto. Use quando: escrever qualquer arquivo .ts, validar dados externos com Zod, adicionar log estruturado, ou quando outra skill precisa gerar exemplos de código TypeScript."
---

# typescript-conventions

Contrato que governa todo código TypeScript gerado neste projeto. `error-handling` e `project-structure` dependem deste contrato — seus exemplos de código só são válidos dentro destas regras.

## Stack

- `strict: true`, `module: ESNext`, `moduleResolution: Bundler`
- ESM puro: `"type": "module"` — nenhum `require()`
- Validação de runtime: **Zod**

---

## Regras

### R1 — Proibido `any`

`any` desliga o typechecker. Use `unknown` e estreite com guarda de tipo.

```ts
// ✅ DO — extraído de src/services/search.ts
function extractStatusCode(err: unknown): number | null {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status: unknown }).status;
    return typeof s === 'number' ? s : null;
  }
  return null;
}

// ❌ DON'T — o que o Copilot gera por padrão
function extractStatusCode(err: any): number | null {
  return err.status ?? null;
}
```

### R2 — Proibido non-null assertion `!`

`!` silencia um erro real em runtime. Valide explicitamente.

```ts
// ✅ DO — extraído de src/shared/config.ts
const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
if (!endpoint) throw new Error('AZURE_OPENAI_ENDPOINT is required');

// ❌ DON'T
const endpoint = process.env['AZURE_OPENAI_ENDPOINT']!;
```

### R3 — Proibido `as` para silenciar o compilador

`as` é casting forçado. Use Zod `safeParse` / `parse` para validar dados externos.

```ts
// ✅ DO — extraído de src/functions/query/handler.ts
const parsed = QueryInputSchema.safeParse(body);
if (!parsed.success) {
  return jsonResponse({ error: parsed.error.errors }, 400);
}
const { question } = parsed.data; // tipo inferido, sem cast

// ❌ DON'T
const { question } = body as { question: string };
```

### R4 — Imports com extensão `.js`

ESM exige extensão explícita no import. Sempre `.js`, mesmo para arquivos `.ts`.

```ts
// ✅ DO
import { config } from '../shared/config.js';
import type { Chunk } from '../shared/types.js';

// ❌ DON'T
import { config } from '../shared/config';
import type { Chunk } from '../shared/types';
```

### R5 — Tipos inferidos do schema Zod, nunca duplicados

Se existe um schema Zod, o tipo TypeScript sai dele via `z.infer`. Nunca declare interface paralela.

```ts
// ✅ DO — extraído de src/functions/query/validator.ts
export const QueryInputSchema = z.object({
  question: z.string().trim().min(1).max(1000),
});
export type QueryInput = z.infer<typeof QueryInputSchema>;

// ❌ DON'T — interface duplicada ao lado do schema
export interface QueryInput { question: string; }
export const QueryInputSchema = z.object({ question: z.string() });
```

### R6 — `const` por padrão; `let` apenas quando reassignment é inevitável

```ts
// ✅ DO
const requestId = randomUUID();
const start = Date.now();

// ❌ DON'T
let requestId = randomUUID();
```

### R7 — Proibido `enum`; use union de string literals ou `as const`

`enum` emite código JS e tem semântica estranha com `strict`. Use union.

```ts
// ✅ DO
type LogLevel = 'info' | 'warn' | 'error';
const STATUS = { OK: 'ok', FAIL: 'fail' } as const;

// ❌ DON'T
enum LogLevel { Info = 'info', Warn = 'warn', Error = 'error' }
```

### R8 — Retorno explícito em funções exportadas assíncronas

Funções exportadas públicas declaram retorno explícito. Funções internas e lambdas: inferência é suficiente.

```ts
// ✅ DO — extraído de src/services/search.ts
export async function searchChunks(embedding: number[]): Promise<Chunk[]> { ... }

// ❌ DON'T
export async function searchChunks(embedding: number[]) { ... }
```

### R9 — Erros tipados, nunca `Promise<void>` engolindo falha

Funções que fazem I/O externo lançam erros tipados (ver `src/shared/errors.ts`). Nunca capture e descarte silenciosamente.

```ts
// ✅ DO — extraído de src/shared/errors.ts
export class OpenAICompletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenAICompletionError';
  }
}

// ❌ DON'T
async function call(): Promise<void> {
  try { await client.complete(prompt); } catch { /* swallowed */ }
}
```

### R10 — Proibido `console.log`; use o logger pino

Todo log estruturado passa pelo singleton `logger`. `console.log` não emite campos como `level`, `time` e `request_id` — perde rastreabilidade em produção.

```ts
// ✅ DO — extraído de src/services/search.ts
import { logger } from '../shared/logger.js';

logger.info({ results_count: chunks.length }, 'Search completed');
logger.error({ err, attempt, delay_ms }, 'Search retry');

// ❌ DON'T
console.log('Search completed', chunks.length);
console.error('Search retry', err);
```
