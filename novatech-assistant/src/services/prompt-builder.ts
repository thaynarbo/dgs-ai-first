import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Chunk } from '../shared/types.js';

// Budget per ADR-0002: ~4K tokens for system prompt, ~8K tokens for chunks.
// Heuristic: 1 token ≈ 4 characters.
const CHARS_PER_TOKEN = 4;
const CHUNK_BUDGET_CHARS = 8_000 * CHARS_PER_TOKEN; // 32 000 chars

// T-07 — monta o prompt respeitando o context budget
export async function buildPrompt(chunks: Chunk[], question: string): Promise<string> {
  const systemPromptPath = join(process.cwd(), 'prompts', 'system-prompt.md');
  const systemPrompt = await readFile(systemPromptPath, 'utf-8');

  // Fit chunks within budget, dropping trailing ones when exceeded
  let budgetRemaining = CHUNK_BUDGET_CHARS;
  const selectedChunkTexts: string[] = [];

  for (const chunk of chunks) {
    const chunkText = `### ${chunk.title}\n${chunk.content}`;
    if (chunkText.length > budgetRemaining) break;
    selectedChunkTexts.push(chunkText);
    budgetRemaining -= chunkText.length;
  }

  const parts: string[] = [systemPrompt.trim()];

  if (selectedChunkTexts.length > 0) {
    parts.push(`## Documentos de contexto\n\n${selectedChunkTexts.join('\n\n')}`);
  }

  parts.push(`## Pergunta\n\n${question}`);

  return parts.join('\n\n');
}
