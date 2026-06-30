export type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export class HttpRequestError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    readonly operation: string,
  ) {
    super(`${service} ${operation} failed with HTTP ${status}`);
    this.name = "HttpRequestError";
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy,
  shouldRetry: (error: unknown) => boolean = isRetryableError,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt >= policy.maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      await sleep(getBackoffDelayMs(policy, attempt));
    }
  }

  throw lastError;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpRequestError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  return error instanceof TypeError;
}

function getBackoffDelayMs(policy: RetryPolicy, attempt: number): number {
  const exponentialDelay = policy.baseDelayMs * 2 ** (attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, policy.maxDelayMs);
  const jitter = Math.floor(cappedDelay * 0.2 * Math.random());

  return cappedDelay + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
