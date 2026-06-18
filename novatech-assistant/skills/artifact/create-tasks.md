# Skill: create-tasks

**Ativação:** "converta este plan.md em tasks", "crie o tasks.md", "quebre este plan em tasks atômicas"

**Hierarquia:** Artifact  
**Criado por:** Tech Lead  
**Consumido por:** Desenvolvedor (Claude, Copilot)  
**Frequência:** Uma vez por módulo SDD (pipeline-ingestao, query-endpoint, feedback-api, teams-bot, painel-web)

---

## Contexto

No fluxo SDD deste projeto, cada módulo tem três artefatos em `specs/<modulo>/`:
- `requirements.md` — escrito pelo Product Specialist
- `plan.md` — escrito pelo Tech Lead
- `tasks.md` — **gerado pelo Dev com apoio de IA a partir do plan.md**

O `tasks.md` é o contrato de implementação: define o que cada dev implementa, em que ordem, e como sabe que terminou. Ele é aprovado pelo Tech Lead antes da primeira task ser iniciada.

---

## Estrutura obrigatória de cada task

```markdown
## T-NN — <título imperativo e específico>

**Descrição:** <o que deve ser implementado — uma responsabilidade única>  
**Critérios de aceite:**
- [ ] <critério verificável 1>
- [ ] <critério verificável 2>
**Dependências:** T-NN, T-NN (ou "nenhuma")  
**Estimativa:** P | M | G
```

**Escala de estimativa:**
- **P** — até 2h (ex: criar schema Zod, configurar logger)
- **M** — meio dia (ex: implementar handler com validação)
- **G** — 1 dia+ (ex: integração completa com retry e testes)

---

## Regras

### Atomicidade
Cada task deve ter **uma responsabilidade única** — implementável e testável sem depender de código não-escrito de outras tasks além das suas dependências declaradas.

### Critérios de aceite
Devem ser **verificáveis por inspeção de código ou teste automatizado**. Nunca use:
- "funcionar corretamente"
- "estar implementado"
- "seguir boas práticas"

### Dependências
Modele como grafo acíclico dirigido. Antes de finalizar o tasks.md, verifique que nenhuma task depende (direta ou indiretamente) de si mesma.

### Separação setup / lógica
Nunca agrupe configuração de infraestrutura (imports, tipos, schema) com lógica de negócio na mesma task. Setup vem primeiro e é dependência da task de lógica.

---

## Exemplos

### DO — task atômica com critérios verificáveis

```markdown
## T-01 — Definir schema Zod de input do query endpoint

**Descrição:** Criar o schema Zod que valida o body do POST /api/query.
**Critérios de aceite:**
- [ ] Schema rejeita body sem campo `question` com erro 400
- [ ] Schema rejeita `question` vazia (string vazia ou só espaços)
- [ ] Schema aceita `question` com até 1.000 caracteres
- [ ] Tipo TypeScript inferido do schema é exportado como `QueryInput`
**Dependências:** nenhuma  
**Estimativa:** P
```

### DON'T — task que agrupa responsabilidades demais

```markdown
## T-01 — Implementar query endpoint

**Descrição:** Criar o endpoint completo com validação, embedding, busca e resposta.
**Critérios de aceite:**
- [ ] Endpoint funcionando corretamente
**Dependências:** nenhuma  
**Estimativa:** G
```

> Problema: mistura 4 responsabilidades distintas, critério não é verificável, e qualquer bug bloqueia a task inteira.

---

### DO — critério verificável para integração

```markdown
- [ ] Quando Azure AI Search retorna 0 resultados, a função retorna `{ answer: null, source_documents: [] }` sem chamar Azure OpenAI
```

### DON'T — critério vago

```markdown
- [ ] A busca no Azure AI Search está integrada
```

---

## Anti-padrões comuns

**Granularidade excessiva:** não crie tasks de 15 minutos (ex: "adicionar import do pino"). Agrupe imports e configurações relacionadas em uma task P.

**Dependência implícita:** se T-03 usa o tipo `QueryInput` definido em T-01, declare `Dependências: T-01` explicitamente — não assuma que o dev vai inferir.

**Critério de aceite orientado a processo:** "código revisado pelo Tech Lead" não é critério de aceite — é etapa de processo. Critérios de aceite descrevem comportamento do código, não quem aprovou.

**Task sem teste possível:** se não conseguir escrever ao menos um critério verificável para a task, ela está mal definida — divida ou reescreva.

**Estimativa G para task atômica:** se uma task atômica está estimada em G, ela provavelmente ainda contém múltiplas responsabilidades. Revise a divisão.

---

## Checklist antes de entregar o tasks.md

- [ ] Todas as tasks têm ID sequencial (T-01, T-02, ...)
- [ ] Nenhum critério de aceite usa linguagem vaga
- [ ] Grafo de dependências não tem ciclo
- [ ] Setup (schemas, tipos, config) aparece antes das tasks de lógica que os usam
- [ ] A primeira task da lista pode ser implementada imediatamente (dependências: nenhuma)
- [ ] Estimativas são consistentes com a escala P/M/G definida acima
