import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import type { Chunk } from '../shared/types.js';

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

// Tipo interno que reflete o esquema do índice, incluindo o campo vetorial.
// Separado de Chunk (tipo de domínio) para não vazar detalhes do índice.
interface SearchDocument extends Chunk {
  contentVector: number[];
}

// T-04 — singleton reutilizável
export const searchClient: SearchClient<SearchDocument> = new SearchClient<SearchDocument>(
  config.search.endpoint,
  config.search.indexName,
  new AzureKeyCredential(config.search.apiKey),
);

export async function withSearchRetry<T>(operation: () => Promise<T>): Promise<T> {
  const { maxAttempts, baseDelayMs } = config.search.retry;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err: unknown) {
      const errorCode = extractStatusCode(err);
      const isRetryable = errorCode !== null && RETRYABLE_STATUS_CODES.has(errorCode);
      const isLastAttempt = attempt === maxAttempts;

      if (!isRetryable || isLastAttempt) {
        throw err;
      }

      const delayMs = baseDelayMs * 2 ** (attempt - 1);

      logger.warn({
        attempt,
        delay_ms: delayMs,
        error_code: errorCode,
        msg: 'Azure AI Search retry',
      });

      await sleep(delayMs);
    }
  }

  throw new Error('Unexpected retry loop exit');
}

// T-06 — busca top-5 chunks por vetor
export async function searchChunks(embedding: number[]): Promise<Chunk[]> {
  const results = await withSearchRetry(() =>
    searchClient.search('*', {
      vectorSearchOptions: {
        queries: [
          {
            kind: 'vector',
            vector: embedding,
            kNearestNeighborsCount: 5,
            fields: ['contentVector'],
          },
        ],
      },
      select: ['title', 'chunk_id', 'content'],
      top: 5,
    }),
  );

  const chunks: Chunk[] = [];
  for await (const result of results.results) {
    chunks.push(result.document);
  }

  logger.info({ results_count: chunks.length, msg: 'Azure AI Search completed' });

  return chunks;
}

function extractStatusCode(err: unknown): number | null {
  if (err !== null && typeof err === 'object' && 'statusCode' in err) {
    const s = (err).statusCode;
    return typeof s === 'number' ? s : null;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
