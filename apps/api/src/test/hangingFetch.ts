/**
 * A fetch that never answers, like an Ollama server stuck before its first
 * token. As real fetch does, it rejects with an AbortError once the signal it
 * was given aborts. Counts requests and aborts.
 */
export function hangingFetch() {
  const server = {
    requests: 0,
    aborted: 0,
    fetch: ((_input: unknown, init?: RequestInit) => {
      server.requests++;
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          server.aborted++;
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }) as typeof fetch,
  };
  return server;
}

export type Settled = { status: 'fulfilled'; value: unknown } | { status: 'rejected'; reason: unknown } | { status: 'pending' };

/** How a promise has settled after `ms`, without waiting on it forever. */
export function settlesWithin(promise: Promise<unknown>, ms: number): Promise<Settled> {
  return Promise.race([
    promise.then(
      (value): Settled => ({ status: 'fulfilled', value }),
      (reason): Settled => ({ status: 'rejected', reason }),
    ),
    new Promise<Settled>((resolve) => setTimeout(() => resolve({ status: 'pending' }), ms)),
  ]);
}
