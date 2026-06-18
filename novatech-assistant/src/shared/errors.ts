export class OpenAICompletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenAICompletionError';
  }
}
