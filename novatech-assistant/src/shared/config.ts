const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
if (!endpoint) throw new Error('AZURE_OPENAI_ENDPOINT is required');

const apiKey = process.env['AZURE_OPENAI_API_KEY'];
if (!apiKey) throw new Error('AZURE_OPENAI_API_KEY is required');

const cosmosConnectionString = process.env['COSMOS_CONNECTION_STRING'];
if (!cosmosConnectionString) throw new Error('COSMOS_CONNECTION_STRING is required');

export const config = {
  openai: {
    endpoint,
    apiKey,
    deploymentName: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4o',
    embeddingDeployment: process.env['AZURE_OPENAI_EMBEDDING_DEPLOYMENT'] ?? 'text-embedding-ada-002',
    apiVersion: process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-02-01',
    retry: {
      maxAttempts: Number.parseInt(process.env['OPENAI_RETRY_MAX_ATTEMPTS'] ?? '3', 10),
      baseDelayMs: Number.parseInt(process.env['OPENAI_RETRY_BASE_DELAY_MS'] ?? '500', 10),
    },
  },
  search: {
    endpoint: process.env['AZURE_SEARCH_ENDPOINT'] ?? '',
    apiKey: process.env['AZURE_SEARCH_API_KEY'] ?? '',
    indexName: process.env['AZURE_SEARCH_INDEX_NAME'] ?? 'novatech-chunks',
    retry: {
      maxAttempts: Number.parseInt(process.env['SEARCH_RETRY_MAX_ATTEMPTS'] ?? '3', 10),
      baseDelayMs: Number.parseInt(process.env['SEARCH_RETRY_BASE_DELAY_MS'] ?? '500', 10),
    },
  },
  cosmos: {
    connectionString: cosmosConnectionString,
    database: 'novatech',
    container: 'feedbacks',
  },
};
