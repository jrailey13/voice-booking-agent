/**
 * LangChain's tracing ships prompts and documents to LangSmith as soon as these
 * variables are set. Nothing in this project may leave the machine, so a set
 * variable is a misconfiguration and the API refuses to start.
 * See ADR-005 in docs/langchain-architecture.md.
 */
const TRACING_FLAGS = ['LANGSMITH_TRACING', 'LANGCHAIN_TRACING_V2', 'LANGCHAIN_TRACING'];
const API_KEYS = ['LANGSMITH_API_KEY', 'LANGCHAIN_API_KEY'];

export class RemoteTracingError extends Error {
  constructor(variable: string) {
    super(
      `${variable} is set, which would send traces to LangSmith. ` +
        `This project keeps all data on the machine; unset ${variable} to continue.`
    );
    this.name = 'RemoteTracingError';
  }
}

const isOn = (value: string | undefined) =>
  value !== undefined && !['', 'false', '0'].includes(value.trim().toLowerCase());

/** Throws if any LangSmith/LangChain tracing env var would send data off-host. */
export function assertNoRemoteTracing(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of TRACING_FLAGS) {
    if (isOn(env[name])) throw new RemoteTracingError(name);
  }
  for (const name of API_KEYS) {
    if (env[name]?.trim()) throw new RemoteTracingError(name);
  }
}
