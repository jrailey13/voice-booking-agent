/**
 * A fake Ollama server for the real ChatOllama client: pass `fetch` to the
 * model factory. Each /api/chat request takes the next scripted reply and gets
 * it back as one streamed NDJSON message. An Error reply makes the request
 * fail. Request bodies are kept, parsed, in `requests`.
 */
export function fakeOllama(...replies: Array<string | Error>) {
  const server = {
    requests: [] as Array<Record<string, any>>,
    fetch: (async (_input: unknown, init?: RequestInit) => {
      server.requests.push(JSON.parse(String(init?.body)));
      const reply = replies.shift();
      if (reply === undefined) throw new Error('fakeOllama: no reply scripted for this request');
      if (reply instanceof Error) throw reply;
      const lines = [
        { model: 'fake', created_at: new Date(0).toISOString(), message: { role: 'assistant', content: reply }, done: false },
        { model: 'fake', created_at: new Date(0).toISOString(), message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
      ];
      return new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      });
    }) as typeof fetch,
  };
  return server;
}
