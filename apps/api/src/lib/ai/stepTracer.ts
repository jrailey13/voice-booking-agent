import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { BaseMessage } from '@langchain/core/messages';
import type { LLMResult } from '@langchain/core/outputs';
import type { DocumentInterface } from '@langchain/core/documents';

type Started = { name: string; at: number };

/**
 * A LangChain callback handler that prints one line per step: the retrieval
 * (query in, documents out) and each model call. Local observability for
 * DEBUG=true; nothing leaves the machine, unlike LangSmith tracing (ADR-005).
 *
 * The agent CLI has the same handler (agent/runtime/stepTracer.ts) plus tool
 * events; the two packages share no code, as with the tracing guard.
 */
export class StepTracer extends BaseCallbackHandler {
  name = 'step_tracer';
  private readonly started = new Map<string, Started>();

  constructor(
    private readonly print: (line: string) => void = console.log,
    private readonly now: () => number = Date.now
  ) {
    super();
  }

  private line(kind: string, text: string): void {
    this.print(`· ${kind.padEnd(9)} ${text}`);
  }

  private start(runId: string, name: string): void {
    this.started.set(runId, { name, at: this.now() });
  }

  /** Elapsed time of a run, forgetting it. */
  private finish(runId: string): string | undefined {
    const run = this.started.get(runId);
    if (!run) return undefined;
    this.started.delete(runId);
    return `${((this.now() - run.at) / 1000).toFixed(1)}s`;
  }

  async handleRetrieverStart(_retriever: Serialized, query: string, runId: string): Promise<void> {
    this.start(runId, 'retriever');
    this.line('retriever', JSON.stringify(query));
  }

  async handleRetrieverEnd(documents: DocumentInterface[], runId: string): Promise<void> {
    const elapsed = this.finish(runId) ?? '?';
    const names = [...new Set(documents.map((d) => String(d.metadata.documentName ?? '?')))];
    this.line('retriever', `${elapsed} → ${documents.length} docs${names.length ? ` (${names.join(', ')})` : ''}`);
  }

  async handleRetrieverError(error: Error, runId: string): Promise<void> {
    const elapsed = this.finish(runId);
    this.line('retriever', `failed${elapsed ? ` after ${elapsed}` : ''}: ${error.message}`);
  }

  async handleChatModelStart(_llm: Serialized, messages: BaseMessage[][], runId: string): Promise<void> {
    this.start(runId, 'model');
    this.line('model', `started (${messages[0]?.length ?? 0} messages)`);
  }

  async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    const elapsed = this.finish(runId) ?? '?';
    const text = output.generations[0]?.[0]?.text ?? '';
    this.line('model', `${elapsed} → answer (${text.length} chars)`);
  }

  async handleLLMError(error: Error, runId: string): Promise<void> {
    const elapsed = this.finish(runId);
    this.line('model', `failed${elapsed ? ` after ${elapsed}` : ''}: ${error.message}`);
  }
}

/** The callbacks to attach to LangChain runs: a StepTracer when DEBUG=true, else none. */
export function debugCallbacks(env: NodeJS.ProcessEnv = process.env): BaseCallbackHandler[] {
  return env.DEBUG === 'true' ? [new StepTracer()] : [];
}
