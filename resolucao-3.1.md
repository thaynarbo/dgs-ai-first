# Resolução — Exercício 3.1

## Structured output e verificações determinísticas (harness de código)

**Papel:** Desenvolvedor
**Tópico:** Harness Engineering
**Ferramentas:** GitHub Copilot (geração) + Claude (code review)
**Arquivo principal:** `novatech-assistant/src/services/response-validator.ts`

---

## Objetivo

Reforçar o harness do assistente de IA da NovaTech com:

1. **Structured output** — forçar o modelo a responder num formato JSON validável (`answer`, `source_document`, `confidence_score`), validado com Zod.
2. **Dois guardrails determinísticos** que complementam o que o prompt faz de forma probabilística:
   - **G1** — Toda resposta DEVE conter `source_document`; se não tiver, é rejeitada e substituída por mensagem padrão.
   - **G2** — Respostas que mencionam "carga perigosa" + "devolução" DEVEM conter a negativa; se afirmarem que a devolução é possível, são bloqueadas.

---

## Passo 1 — Schema Zod do structured output (GitHub Copilot)

### Prompt enviado ao Copilot

```
Contexto do projeto (ver AGENTS.md): TypeScript strict mode, ESM (imports com extensão .js),
Zod para validação, pino para logging (nunca console.log), nunca logar dados pessoais.

Tarefa: defina o schema Zod do structured output que o assistente DEVE seguir. Campos:
answer (string não-vazia), source_document (string não-vazia), confidence_score (0 a 1).
Rejeite campos extras. Exporte o schema e o tipo inferido. Não use any.
```

### Código gerado

```typescript
import { z } from "zod";

export const AssistantResponseSchema = z
  .object({
    answer: z
      .string({ required_error: "answer is required" })
      .trim()
      .min(1, "answer must not be empty"),
    source_document: z
      .string({ required_error: "source_document is required" })
      .trim()
      .min(1, "source_document must not be empty"),
    confidence_score: z
      .number({ required_error: "confidence_score is required" })
      .min(0, "confidence_score must be at least 0")
      .max(1, "confidence_score must be at most 1"),
  })
  .strict();

export type AssistantResponse = z.infer<typeof AssistantResponseSchema>;
```

### Por que este schema está correto

- `.strict()` → **rejeita campos extras** (por padrão o Zod faz *strip* silencioso). Garante que o modelo não anexe campos não previstos.
- `.trim().min(1)` em `source_document` → cobre o **G1 de forma estrutural**: uma resposta sem fonte (ou com fonte só de espaços) falha no parse antes de qualquer checagem de conteúdo.
- `confidence_score` restrito a `[0, 1]`.

---

## Passo 2 — response-validator.ts com os 2 guardrails (GitHub Copilot)

O prompt foi mantido **deliberadamente enxuto e pouco prescritivo**, refletindo uma solicitação
realista de implementação. O objetivo é não induzir a resposta correta: assim os defeitos típicos
de código gerado por IA aparecem de forma natural e a revisão crítica do Passo 3 tem material real
para avaliar.

### Prompt enviado ao Copilot

```
Implemente a função validateResponse que valida a resposta do assistente antes de devolvê-la.
1. Valide contra o AssistantResponseSchema.
2. Toda resposta precisa ter source_document; sem fonte, rejeita.
3. Se a resposta falar sobre carga perigosa e devolução, precisa deixar claro que devolução
   de carga perigosa não é permitida pelo processo padrão; se afirmar que é possível, bloqueia.
4. Quando rejeitar, loga o motivo e retorna uma mensagem padrão segura.
```

### Código gerado pelo Copilot (versão a ser revisada)

```typescript
export function validateResponse(rawResponse: unknown): AssistantResponse {
  const parsed = AssistantResponseSchema.safeParse(rawResponse);

  if (!parsed.success) {
    logger.warn({ reason: "assistant_response_schema_validation_failed", /* ... */ });
    return SAFE_REJECTION_RESPONSE;
  }

  const response = parsed.data;

  if (response.source_document.trim().length === 0) {          // (revisão: código morto)
    logger.warn({ reason: "assistant_response_missing_source_document" });
    return SAFE_REJECTION_RESPONSE;
  }

  if (mentionsDangerousCargoReturn(response.answer)) {
    if (!statesDangerousCargoReturnIsNotAllowed(response.answer)) {
      logger.warn({ reason: "..._missing_forbidden_statement..." });
      return SAFE_REJECTION_RESPONSE;
    }
    if (statesDangerousCargoReturnIsAllowed(response.answer)) {
      logger.warn({ reason: "..._claims_dangerous_cargo_return_allowed" });
      return SAFE_REJECTION_RESPONSE;
    }
  }

  return response;
}

function mentionsDangerousCargoReturn(answer: string): boolean {
  const normalized = normalizeText(answer);
  const mentionsDangerousCargo =
    normalized.includes("carga perigosa") || normalized.includes("produto perigoso");
  const mentionsReturn =
    normalized.includes("devolucao") ||
    normalized.includes("devolver") ||
    normalized.includes("retorno");
  return mentionsDangerousCargo && mentionsReturn;
}

function statesDangerousCargoReturnIsNotAllowed(answer: string): boolean {
  const normalized = normalizeText(answer);
  return /devolucao.{0,60}carga perigosa.{0,60}(nao|nunca|jamais).{0,30}(permitid|autorizad|possivel|aceit)/.test(normalized);
}
// ... normalizeText remove acentos e caixa
```

**O que já estava bom** (para uma revisão justa):

- ✅ Usa `pino` (não `console.log`).
- ✅ Os guardrails **bloqueiam de fato** (retornam `SAFE_REJECTION_RESPONSE`), não apenas logam.
- ✅ Loga só `reason`/`path`/`code` — **não** loga a `answer` completa (não vaza dado sensível).
- ✅ Normaliza acentos e caixa antes de comparar.

---

## Passo 3 — Code review com o Claude

A revisão combinou análise própria e o Claude. Dois achados partiram de mim, de forma independente:
o **Achado 6** (o validator não estava plugado no fluxo) e a crítica de fundo de que **regex sobre
resposta dinâmica é frágil** (a saída do LLM varia e pode não conter as palavras exatas). Os demais
foram detalhados/confirmados na revisão com o Claude. No total, seis problemas reais (não inventados),
do tipo que o próprio enunciado sugere ("o regex de carga perigosa + devolução cobre variações?").

### 🔴 Achado 1 — Fail-open: a detecção não cobre plural nem conjugações (crítico)

`mentionsDangerousCargoReturn` usa `includes("carga perigosa")` e `includes("devolucao"/"devolver")`.
A POL-001 e o modelo usam o **plural** e outras conjugações.

Prova — simulação da resposta perigosa que o guardrail deveria bloquear:

```
"Sim, cargas perigosas podem ser devolvidas normalmente em até 7 dias."
```

- `includes("carga perigosa")` → **false** (a string é `cargas perigosas`, com "s" após "carga")
- `includes("devolucao"/"devolver"/"retorno")` → **false** (a palavra é `devolvidas`)

A detecção retorna **false**, o guardrail **não dispara**, e a resposta que afirma ser possível
devolver carga perigosa **passa direto para o usuário**. O guardrail é contornado exatamente no
caso que existe para bloquear — é *fail-open*, o pior modo de falha para um guardrail.

**Categoria:** Bug / Segurança (regex não cobre variações).

### 🔴 Achado 2 — Regex depende da ordem das palavras (bloqueia a resposta correta)

`statesDangerousCargoReturnIsNotAllowed` exige `devolucao` **antes** de `carga perigosa`:

```
/devolucao.{0,60}carga perigosa.{0,60}(nao|nunca|jamais).../
```

Mas a redação natural da POL-001 §3.2 é a ordem inversa: *"**cargas perigosas** classes 1 a 6
**não** são elegíveis para **devolução**"*. O regex não casa → mesmo uma resposta **correta**
seria bloqueada. Ou seja: o Achado 1 deixa passar o errado e o Achado 2 barra o certo.

**Categoria:** Bug (lógica de detecção frágil).

### 🟠 Achado 3 — Janelas `.{0,60}` / `.{0,30}` arbitrárias

As distâncias fixas quebram em frases reais com orações intercaladas
("A devolução, conforme a política revisada em 2024, de carga perigosa…").

**Categoria:** Bug / fragilidade.

### 🟡 Achado 4 — Código morto (confusão sobre onde mora o determinismo)

A checagem `response.source_document.trim().length === 0` **nunca é verdadeira**: o schema já
faz `.trim().min(1)`, que garante campo não-vazio. Repetir na mão indica não ter entendido que
a validação determinística do **formato** (G1) já acontece no schema.

**Categoria:** Redundância / smell.

### 🟡 Achado 5 — A própria resposta padrão feriria o guardrail

`SAFE_REJECTION_RESPONSE.answer` menciona "devolução" e "carga perigosa" sem a negativa no
formato esperado — se fosse revalidada, cairia no próprio guardrail.

**Categoria:** Smell de consistência.

### 🔴 Achado 6 — O validator não estava integrado ao fluxo (harness inerte, crítico) — *achado próprio*

Levantei este ponto de forma independente, questionando se o validator chegava a ser chamado.
`grep` confirma que `validateResponse` e `AssistantResponseSchema` só apareciam dentro do próprio
`response-validator.ts` — nenhum outro módulo os importava:

```
$ grep -rn "response-validator\|validateResponse\|AssistantResponseSchema" src tests
src/services/response-validator.ts: (apenas as próprias definições)
# nenhuma outra ocorrência
```

O fluxo original (`src/functions/query/handler.ts`) gerava texto livre e o devolvia **sem passar
pelo validator**. Duas consequências:

- **O harness existia mas não atuava.** Como `validateResponse` nunca rodava, os guardrails não
  bloqueavam nada na prática.
- **O structured output não era produzido.** `generateCompletion` devolvia texto livre; ninguém
  pedia ao LLM o JSON `{answer, source_document, confidence_score}` nem fazia parse dele.

**Categoria:** Bug de integração (crítico). Correção descrita na próxima seção.

---

## O que foi corrigido e integrado

### Correção dos guardrails (Achados 1–5)

A raiz dos achados 1–3 é o **matching por string literal e ordem fixa**. A correção troca por
**radicais (stems) ancorados**, independentes de ordem, e simplifica o G2 para **fail-safe**
(co-ocorrência de carga perigosa + devolução ⇒ exige negativa explícita; senão bloqueia):

```typescript
// Detecção por radical — cobre singular/plural e conjugações
const DANGEROUS_CARGO = /\bcargas?\s+perigosas?\b|\bprodutos?\s+perigosos?\b/;
const RETURN_TOPIC    = /\bdevol\w*\b|\bretorno\b/;               // devolução, devolver, devolvidas...
const PROHIBITION     = /\b(nao|nunca|jamais|proibid\w*|vedad\w*|inelegiveis?|nao elegiveis?)\b/;

function mentionsDangerousCargoReturn(answer: string): boolean {
  const t = normalizeText(answer);
  return DANGEROUS_CARGO.test(t) && RETURN_TOPIC.test(t);
}

// Fail-safe: só libera se houver negativa explícita; caso contrário, bloqueia
function statesReturnIsForbidden(answer: string): boolean {
  return PROHIBITION.test(normalizeText(answer));
}
```

- **Achado 1:** `\bcargas?\s+perigosas?\b` cobre singular/plural; `\bdevol\w*\b` cobre devolução/devolver/devolvidas.
- **Achado 2:** detecção independente de ordem.
- **Achado 3:** sem janelas mágicas de distância.
- **Achado 4:** removida a checagem de `source_document` vazio (já garantida pelo schema).
- **Achado 5:** ajustada a mensagem padrão para não conter a combinação que ela mesma bloquearia.

> **Nota de verificação (honestidade de processo):** a primeira versão da correção usava
> `\bdevolu\w*\b`, que **não** casa com "devolvidas" (radical `devolv`, não `devolu`). O bug só
> apareceu ao **rodar os testes** — o caso da resposta perigosa no plural falhou. Corrigido para o
> radical comum `\bdevol\w*\b`. Reforça o valor de verificar o harness com testes, não por inspeção.

### Integração no fluxo (Achado 6)

1. **`src/services/completion.ts`** — nova função `generateStructuredCompletion(prompt)`: pede ao LLM JSON com `response_format: { type: 'json_object' }` + instrução de sistema exigindo `answer`/`source_document`/`confidence_score`, e retorna o JSON parseado. Se o modelo não devolver JSON válido, retorna o texto cru (que `validateResponse` rejeita → resposta padrão segura).
2. **`src/functions/query/handler.ts`** — o fluxo passa a ser `RAG → generateStructuredCompletion → validateResponse → resposta`. Respostas inválidas viram `SAFE_REJECTION_RESPONSE` **antes** de chegar ao atendente.
3. **`src/functions/query/validator.ts`** — `QueryOutputSchema` estendido com `source_document` e `confidence_score` (o array `source_documents` dos chunks recuperados foi mantido para rastreabilidade).

### Evidência de execução

- **`tests/unit/response-validator.test.ts`** (novo) — 10 casos: schema (fonte ausente/vazia, campos extras, confidence fora de faixa, entrada não-objeto) + G2 (bloqueia plural/conjugação e "produto perigoso"; **não** bloqueia a resposta correta com negativa).
- **`tests/integration/query-handler.test.ts`** (atualizado) — o fluxo completo valida structured output; novos testes provam que o harness **bloqueia** resposta sem fonte e afirmação de devolução de carga perigosa, e **libera** a resposta correta.

```
$ npm test        →  Test Files 3 passed (3) | Tests 30 passed (30)
$ npm run build   →  EXIT 0 (typecheck OK)
```

---

## Distinção prompt (probabilístico) × código (determinístico)

| Camada | Natureza | Papel |
|--------|----------|-------|
| **Prompt / system-prompt** | Probabilístico | Instrui o modelo a citar a fonte e a negar devolução de carga perigosa. O modelo *pode* obedecer — ou esquecer. |
| **Schema Zod (`.strict()`, `source_document` obrigatório)** | Determinístico | Rejeita **sempre** que o formato não bate, independentemente do modelo. Cobre o G1 estruturalmente. |
| **Guardrails de conteúdo (G2)** | Determinístico | Bloqueiam **sempre** a combinação de risco sem negativa. |

O bug do Achado 1 ilustra o ponto: um determinismo **mal escrito** (regex frouxo) volta a ser tão
falível quanto o prompt. A força do harness está em verificações determinísticas *corretas* que
complementam — não substituem — a geração probabilística.

---

## Mapa de evidências × critérios de avaliação

| Critério (Score 3) | Evidência |
|--------------------|-----------|
| Schema de structured output válido (Zod, campos obrigatórios, tipos corretos) | Passo 1 — `AssistantResponseSchema` com `.strict()`, `.trim().min(1)`, `confidence_score` em `[0,1]` |
| Guardrail 1 (source_document) bloqueia de fato | Coberto estruturalmente pelo schema → retorna `SAFE_REJECTION_RESPONSE`; provado nos testes unitários |
| Guardrail 2 (carga perigosa + devolução) detecta e bloqueia | Passo 3 + correção fail-safe; testes provam bloqueio (plural/conjugação) e liberação da resposta correta |
| Code review identifica 2+ problemas reais e corrige | Passo 3 — 6 achados reais + correções aplicadas e testadas |
| Probabilístico vs determinístico | Seção dedicada acima |

---

## Apêndice — Observação de maturidade (fora do escopo obrigatório)

Esta observação partiu de um questionamento próprio: **regex sobre a resposta do LLM é frágil**,
porque a saída é dinâmica e pode não conter as palavras exatas que o padrão espera (variação de
redação, sinônimos, paráfrase). Um match literal/estrutural sempre terá falsos negativos nesse
cenário — o que motiva a discussão abaixo.

O guardrail G2 valida **conteúdo por tópico** dentro do runtime. Isso atende ao exercício, mas em
um RAG com agente a validação de corretude de conteúdo escala melhor num **eval harness data-driven**
(`prompts/eval/golden-queries.json` + runner): rodar a pergunta no RAG e comparar a resposta com um
esperado. O caso "carga perigosa" viraria uma linha de dados, não um `if`. Além disso, o Chunk FAQ-03
mostra que a política é **matizada** ("não diga que é impossível — precisa de tratamento especial via
ramal 4500"), o que reforça que negativa seca em regex é uma simplificação. O guardrail em código foi
mantido por ser requisito explícito do 3.1; o eval harness fica como recomendação.
