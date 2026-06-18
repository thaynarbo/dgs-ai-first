import { AzureOpenAI } from 'openai';
import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { OpenAICompletionError } from '../shared/errors.js';

export const completionClient = new AzureOpenAI({
  endpoint: config.openai.endpoint,
  apiKey: config.openai.apiKey,
  apiVersion: config.openai.apiVersion,
  deployment: config.openai.deploymentName,
});

export const embeddingClient = new AzureOpenAI({
  endpoint: config.openai.endpoint,
  apiKey: config.openai.apiKey,
  apiVersion: config.openai.apiVersion,
  deployment: config.openai.embeddingDeployment,
});

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export async function withOpenAIRetry<T>(operation: () => Promise<T>): Promise<T> {
  const { maxAttempts, baseDelayMs } = config.openai.retry;

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

      const delayMs = baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random() * 0.5);

      logger.warn({
        attempt,
        delay_ms: delayMs,
        error_code: errorCode,
        msg: 'Azure OpenAI retry',
      });

      await sleep(delayMs);
    }
  }

  // Unreachable — loop always returns or throws
  throw new Error('Unexpected retry loop exit');
}

function extractStatusCode(err: unknown): number | null {
  if (err !== null && typeof err === 'object' && 'status' in err) {
    const s = (err).status;
    return typeof s === 'number' ? s : null;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// T-05 — gera embedding da pergunta via Azure OpenAI
export async function generateEmbedding(question: string): Promise<number[]> {
  const response = await withOpenAIRetry(() =>
    embeddingClient.embeddings.create({
      model: config.openai.embeddingDeployment,
      input: question,
    }),
  );

  const vector = response.data[0]?.embedding;

  if (!vector) {
    throw new Error('Azure OpenAI returned no embedding data');
  }

  logger.info({
    question_length: question.length,
    embedding_dimensions: vector.length,
    msg: 'Embedding generated',
  });

  return vector;
}

// T-08 — envia prompt ao GPT-4o e extrai a resposta em texto
export async function generateCompletion(prompt: string): Promise<string> {
  const response = await withOpenAIRetry(() =>
    completionClient.chat.completions.create({
      model: config.openai.deploymentName,
      messages: [{ role: 'user', content: prompt }],
    }),
  );

  const answer = response.choices[0]?.message?.content;

  if (!answer) {
    throw new OpenAICompletionError('Azure OpenAI returned empty completion');
  }

  logger.info({
    prompt_tokens: response.usage?.prompt_tokens,
    completion_tokens: response.usage?.completion_tokens,
    model: response.model,
    msg: 'Completion generated',
  });

  return answer;
}
