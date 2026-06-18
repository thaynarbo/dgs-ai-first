import { randomUUID } from 'node:crypto';
import { QueryInputSchema, QueryOutputSchema } from './validator.js';
import { generateEmbedding, generateCompletion } from '../../services/completion.js';
import { searchChunks } from '../../services/search.js';
import { buildPrompt } from '../../services/prompt-builder.js';
import { logger } from '../../shared/logger.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// T-09 — HTTP handler do Azure Function (POST /api/query)
export async function queryHandler(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const start = Date.now();
  let questionLength = 0;

  try {
    let body: unknown;
    try {
      body = await request.json() as unknown;
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = QueryInputSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: parsed.error.errors }, 400);
    }

    const { question } = parsed.data;
    questionLength = question.length;

    const embedding = await generateEmbedding(question);
    const chunks = await searchChunks(embedding);

    if (chunks.length === 0) {
      logger.info({
        request_id: requestId,
        question_length: questionLength,
        duration_ms: Date.now() - start,
        msg: 'Query completed — no chunks found',
      });
      return jsonResponse({ answer: null, source_documents: [] }, 200);
    }

    const prompt = await buildPrompt(chunks, question);
    const answer = await generateCompletion(prompt);

    const output = QueryOutputSchema.parse({
      answer,
      source_documents: chunks.map((c) => ({ title: c.title, chunk_id: c.chunk_id })),
    });

    logger.info({
      request_id: requestId,
      question_length: questionLength,
      duration_ms: Date.now() - start,
      msg: 'Query completed',
    });

    return jsonResponse(output, 200);
  } catch (err: unknown) {
    logger.error({
      request_id: requestId,
      question_length: questionLength,
      duration_ms: Date.now() - start,
      err,
      msg: 'Query failed',
    });
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

