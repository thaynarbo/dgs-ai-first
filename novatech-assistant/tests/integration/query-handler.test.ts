import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryHandler } from '../../src/functions/query/handler.js';
import { sampleChunks } from '../fixtures/chunks.js';
import { validQuestion, whitespaceQuestion } from '../fixtures/queries.js';
import { expectedAnswer } from '../fixtures/expected-responses.js';

// T-10 — Mock Azure clients; no real network calls
vi.mock('../../src/services/completion.js', () => ({
  generateEmbedding: vi.fn(),
  generateCompletion: vi.fn(),
}));

vi.mock('../../src/services/search.js', () => ({
  searchChunks: vi.fn(),
}));

vi.mock('../../src/services/prompt-builder.js', () => ({
  buildPrompt: vi.fn(),
}));

// Import after vi.mock so the mocked versions are used
import { generateEmbedding, generateCompletion } from '../../src/services/completion.js';
import { searchChunks } from '../../src/services/search.js';
import { buildPrompt } from '../../src/services/prompt-builder.js';

const mockEmbedding = vi.mocked(generateEmbedding);
const mockSearchChunks = vi.mocked(searchChunks);
const mockBuildPrompt = vi.mocked(buildPrompt);
const mockGenerateCompletion = vi.mocked(generateCompletion);

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('queryHandler — T-10', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 400 para input inválido (sem campo question)', async () => {
    const res = await queryHandler(makeRequest({}));

    expect(res.status).toBe(400);
    const body = await res.json() as { error: unknown };
    expect(body.error).toBeDefined();

    // Nenhum cliente Azure deve ser chamado
    expect(mockEmbedding).not.toHaveBeenCalled();
    expect(mockSearchChunks).not.toHaveBeenCalled();
  });

  it('retorna 400 para question em branco', async () => {
    const res = await queryHandler(makeRequest({ question: whitespaceQuestion }));

    expect(res.status).toBe(400);
  });

  it('retorna { answer: null, source_documents: [] } quando busca retorna 0 resultados — sem chamar OpenAI', async () => {
    mockEmbedding.mockResolvedValue([0.1, 0.2]);
    mockSearchChunks.mockResolvedValue([]);

    const res = await queryHandler(makeRequest({ question: validQuestion }));

    expect(res.status).toBe(200);
    const body = await res.json() as { answer: unknown; source_documents: unknown[] };
    expect(body.answer).toBeNull();
    expect(body.source_documents).toEqual([]);

    // OpenAI completion NÃO deve ser chamada
    expect(mockGenerateCompletion).not.toHaveBeenCalled();
  });

  it('retorna 200 com answer e source_documents no fluxo completo feliz', async () => {
    mockEmbedding.mockResolvedValue([0.1, 0.2]);
    mockSearchChunks.mockResolvedValue(sampleChunks);
    mockBuildPrompt.mockResolvedValue('prompt montado');
    mockGenerateCompletion.mockResolvedValue(expectedAnswer);

    const res = await queryHandler(makeRequest({ question: validQuestion }));

    expect(res.status).toBe(200);
    const body = await res.json() as { answer: string; source_documents: { title: string; chunk_id: string }[] };
    expect(body.answer).toBe(expectedAnswer);
    expect(body.source_documents).toHaveLength(sampleChunks.length);
    const firstChunk = sampleChunks[0];
    expect(body.source_documents[0]).toMatchObject({
      title: firstChunk?.title,
      chunk_id: firstChunk?.chunk_id,
    });
  });

  it('retorna 500 quando Azure OpenAI lança erro após retries', async () => {
    mockEmbedding.mockResolvedValue([0.1, 0.2]);
    mockSearchChunks.mockResolvedValue(sampleChunks);
    mockBuildPrompt.mockResolvedValue('prompt montado');
    mockGenerateCompletion.mockRejectedValue(Object.assign(new Error('Service Unavailable'), { status: 503 }));

    const res = await queryHandler(makeRequest({ question: validQuestion }));

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    // Stack trace não deve vazar
    expect(body.error).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('at ');
  });
});
