import { randomUUID } from 'node:crypto';
import { CosmosClient } from '@azure/cosmos';
import { z } from 'zod';
import { config } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';
import { FeedbackInputSchema } from './validator.js';

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
  return issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

export async function feedbackHandler(request: Request): Promise<Response> {
  const requestId = randomUUID();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = FeedbackInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: toValidationErrors(parsed.error.issues) }, 400);
  }

  const feedback = {
    ...parsed.data,
    timestamp: new Date().toISOString(),
  };

  try {
    const { resource } = await feedbackContainer.items.create(feedback);
    const id = resource?.id ?? null;

    logger.info({
      request_id: requestId,
      query_id: feedback.queryId,
      rating: feedback.rating,
      feedback_id: id,
      msg: 'Feedback stored',
    });

    return jsonResponse({ id }, 201);
  } catch (err: unknown) {
    logger.error({
      request_id: requestId,
      query_id: feedback.queryId,
      rating: feedback.rating,
      err,
      msg: 'Failed to store feedback',
    });
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
