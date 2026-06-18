# Exercício 2.3 (Dev) — Definição de estratégia de skills do projeto

> **Escopo desta entrega:** cobre as **3 tarefas** do Dev 2.3.
> - **Tarefa 1** — Árvore de skills seguindo a hierarquia Foundation → Domain → Artifact.
> - **Tarefa 2** — Para cada skill: nome, frase-ativação, quem cria, quem consome, frequência de uso.
> - **Tarefa 3** — SKILL.md da skill Foundation mais importante, gerado com GitHub Copilot.

---

## Tarefa 1 e 2 — Árvore de Skills com Mapeamento

A hierarquia segue o princípio de dependência: skills Artifact usam skills Domain, que usam skills Foundation. Uma skill de nível superior nunca pode ser usada sem que as Foundation estejam claras para o agente.

```
skills/
├── foundation/                        ← convenções globais do projeto
│   ├── typescript-conventions.md      ← BASE DE TUDO — usada por todas as outras skills
│   ├── error-handling.md
│   └── project-structure.md
├── domain/                            ← padrões por camada técnica
│   ├── azure-functions-endpoint.md
│   ├── azure-ai-search-integration.md
│   ├── testing-patterns.md
│   └── react-components.md
└── artifact/                          ← receitas de geração de artefatos específicos
    ├── create-rag-endpoint.md
    ├── create-integration-test.md
    ├── create-react-card.md
    └── create-tasks.md
```

---

### Foundation

Skills de convenções globais. São consumidas implicitamente por todas as outras — um agente gerando qualquer código do projeto deve tê-las como contexto base.

| Nome | Frase-ativação (quando o agente reconhece que deve usar) | Criado por | Consome | Agentes | Frequência |
|---|---|---|---|---|---|
| `typescript-conventions` | "crie um arquivo TypeScript", "adicione um tipo", "valide com Zod", "exporte este módulo" | Tech Lead | Dev Pleno, Dev Sênior | Copilot, Claude Code | Todo arquivo novo |
| `error-handling` | "adicione tratamento de erro", "crie um custom error", "adicione retry", "não deixe o erro passar silencioso" | Tech Lead | Dev Pleno, Dev Sênior | Copilot, Claude Code | Todo handler e service com I/O externo |
| `project-structure` | "onde coloco este arquivo", "crie a estrutura de pastas", "onde fica o tipo compartilhado", "organize este módulo" | Tech Lead | Dev Pleno, Dev Sênior, QA | Copilot, Claude Code | Toda criação de módulo novo |

**Dependências entre Foundation:** `error-handling` e `project-structure` dependem de `typescript-conventions` para os exemplos de código serem válidos no contexto do projeto.

---

### Domain

Skills de padrões por camada técnica. Cada uma pressupõe que as três Foundation estão ativas. São o "como fazemos isso neste projeto" para cada tecnologia ou camada.

| Nome | Frase-ativação | Criado por | Consome | Agentes | Frequência |
|---|---|---|---|---|---|
| `azure-functions-endpoint` | "crie um endpoint Azure Function", "adicione um HTTP trigger", "implemente um novo handler" | Dev Sênior | Dev Pleno, Dev Sênior | Copilot, Claude Code | Alta — um endpoint por módulo (query, feedback, health…) |
| `azure-ai-search-integration` | "integre com o Azure AI Search", "faça busca vetorial", "configure o SearchClient", "adicione retry no search" | Dev Sênior | Dev Pleno, Dev Sênior | Copilot, Claude Code | Média — todo endpoint RAG |
| `testing-patterns` | "escreva um teste", "crie teste de integração", "adicione testes para este endpoint", "mock o Azure" | QA + Dev Sênior | Dev Pleno, Dev Sênior, QA | Copilot, Claude Code | Alta — todo endpoint e service tem testes |
| `react-components` | "crie um componente React", "adicione um card de resposta", "implemente o formulário de feedback" | Dev Pleno | Dev Pleno | Copilot | Média — escopo do painel web é limitado |

**Dependências:** todas as Domain dependem das três Foundation. `azure-functions-endpoint` usa `azure-ai-search-integration` nos endpoints RAG. `testing-patterns` referencia `azure-functions-endpoint` para saber o que testar.

---

### Artifact

Receitas de geração de artefatos específicos e repetíveis. São as mais concretas — ativadas quando o agente precisa gerar um artefato completo do zero. Cada uma referencia explicitamente as skills Domain e Foundation que deve ter em contexto.

| Nome | Frase-ativação | Criado por | Consome | Agentes | Frequência |
|---|---|---|---|---|---|
| `create-rag-endpoint` | "crie um endpoint RAG", "implemente o endpoint de [X] com busca vetorial", "novo endpoint no padrão do query" | Dev Sênior | Dev Pleno, Dev Sênior | Copilot, Claude Code | Média — a cada novo endpoint com busca (query, variações futuras) |
| `create-integration-test` | "crie teste de integração para este endpoint", "adicione cobertura de integração", "teste o handler com msw" | QA + Dev Sênior | Dev Pleno, Dev Sênior, QA | Copilot, Claude Code | Alta — um por endpoint |
| `create-react-card` | "crie um card React para exibir [X]", "componente de card para o painel", "card de resposta do assistente" | Dev Pleno | Dev Pleno | Copilot | Baixa — painel tem poucos componentes de card |
| `create-tasks` | "converta este plan.md em tasks", "crie o tasks.md", "quebre este plan em tasks atômicas" | Tech Lead | Dev Pleno, Dev Sênior | Claude Code | Uma vez por módulo SDD |

**Dependências:** `create-rag-endpoint` depende de `azure-functions-endpoint` + `azure-ai-search-integration` + as três Foundation. `create-integration-test` depende de `testing-patterns` + `azure-functions-endpoint`. `create-react-card` depende de `react-components`.

---

## Grafo de dependências resumido

```
typescript-conventions ◄──── error-handling
        ▲                           ▲
        │                           │
project-structure          azure-functions-endpoint ◄── create-rag-endpoint
        ▲                           ▲
        │                           │
   (base de todas)         azure-ai-search-integration ◄── create-rag-endpoint
                                    ▲
                                    │
                           testing-patterns ◄── create-integration-test
                                    ▲
                                    │
                           react-components ◄── create-react-card
```

---

## Atribuição por papel

| Papel | Cria | Consome |
|---|---|---|
| Tech Lead | `typescript-conventions`, `error-handling`, `project-structure`, `create-tasks` | Revisão de todas |
| Dev Sênior | `azure-functions-endpoint`, `azure-ai-search-integration`, `create-rag-endpoint`, `create-integration-test` | Todas as Foundation + Domain relevantes |
| Dev Pleno | `react-components`, `create-react-card` | Foundation + Domain da sua camada |
| QA | `testing-patterns`, `create-integration-test` (co-autoria) | `testing-patterns`, `create-integration-test` |
| Product Specialist | — | `create-tasks` (para entender o formato SDD) |
| Delivery Manager | — | `create-tasks` (para acompanhar progresso) |

---

## Tarefa 3 — SKILL.md Foundation gerado com Copilot

A skill Foundation mais importante é **`typescript-conventions`** porque:
- Toda geração de código do projeto passa por ela — qualquer arquivo `.ts` criado por um agente precisa seguir estas convenções.
- As outras skills Foundation (`error-handling`, `project-structure`) referenciam os padrões TypeScript dela para que seus exemplos de código sejam válidos no contexto do projeto.
- Os anti-padrões dela (`any`, `!`, `as`, `export *`) são exatamente o que o Copilot gera por padrão sem guidance — tornando a skill crítica para evitar retrabalho em code review.

O arquivo gerado com Copilot está em: `skills/foundation/typescript-conventions.md`

### Processo de geração com Copilot

O SKILL.md foi produzido com o seguinte prompt no Copilot Chat, com o contexto do repositório aberto:

> *"Baseado nos arquivos `src/shared/config.ts`, `src/shared/errors.ts`, `src/functions/query/validator.ts` e `src/functions/query/handler.ts`, gere um SKILL.md para a skill `typescript-conventions` do projeto. O arquivo deve conter: contexto do projeto, regras prescritivas numeradas, exemplos DO/DON'T com código real do repositório, e anti-padrões que o Copilot costuma gerar incorretamente neste stack (TypeScript strict + ESM + Zod + Azure Functions v4)."*

O Copilot gerou a estrutura base usando os arquivos como referência. As regras foram revisadas e os exemplos de código ajustados para refletir exatamente os padrões já presentes no repositório (ex: o padrão de `extractStatusCode` com `unknown`, o `safeParse` no handler, os imports com `.js`).

### Estrutura do SKILL.md gerado

O arquivo `skills/foundation/typescript-conventions.md` contém:

1. **Cabeçalho de metadados** — frase-ativação, hierarquia, quem cria, quem consome, frequência.
2. **Contexto** — explica o stack (`strict: true`, `"type": "module"`, Zod como validação de runtime) para que o agente entenda *por que* as regras existem.
3. **10 regras prescritivas** — ordenadas do mais crítico ao mais específico: sem `any`, sem `!`, sem `as`, imports com `.js`, exports explícitos, tipos inferidos de Zod, `const` por padrão, sem enum, retorno explícito em exports assíncronos.
4. **Exemplos DO/DON'T com código real** — extraídos de `validator.ts`, `handler.ts`, `search.ts` e `completion.ts`. Cada par mostra o código real do projeto (DO) contra o que o Copilot geraria sem guidance (DON'T).
5. **Anti-padrões** — problemas concretos que o Copilot gera neste stack: `as` para calar o compilador, interface duplicada ao lado de schema Zod, `export *` em barrels, `let` em variáveis imutáveis, `Promise<void>` swallowing erros.
