import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Document } from '@langchain/core/documents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableBranch, RunnableLambda, RunnablePassthrough, RunnableSequence, type Runnable } from '@langchain/core/runnables';
import type { ChunkMetadata, PrismaVectorStore } from './prismaVectorStore';

// Moved verbatim from the hand-rolled service, trailing spaces included, so
// answers stay comparable across the rework.
export const RAG_SYSTEM_PROMPT = [
  'You are a helpful assistant that answers questions based on provided documents. ',
  'Always use only the information provided in the context to answer questions. ',
  'If the answer is not in the context, say "I don\'t have enough information to answer this question."',
].join('\n');

export const NO_RESULTS_ANSWER = 'No relevant information found in the provided documents.';

export type RagInput = {
  question: string;
  fileIds: string[];
};

export type RagOutput = {
  answer: string;
  docs: Document<ChunkMetadata>[];
};

type WithDocs = RagInput & { docs: Document<ChunkMetadata>[] };

const prompt = ChatPromptTemplate.fromMessages([
  ['system', RAG_SYSTEM_PROMPT],
  ['human', 'Context:\n{context}\n\nQuestion: {question}\n\nAnswer:'],
]);

const formatContext = (docs: Document<ChunkMetadata>[]) =>
  docs.map((d) => `[${d.metadata.documentName}]\n${d.pageContent}`).join('\n\n---\n\n');

/**
 * question + fileIds → retrieve → (nothing found ? fixed answer : prompt → model → text).
 *
 * Retrieval goes through store.asRetriever with a per-request filter, so the
 * same chain serves any set of files. Returns the retrieved docs alongside the
 * answer so the caller can build citations.
 */
export function buildRagChain(deps: {
  store: PrismaVectorStore;
  model: BaseChatModel;
  k?: number;
}): Runnable<RagInput, RagOutput> {
  const k = deps.k ?? 5;

  // The retriever is typed with generic metadata; PrismaVectorStore always fills ChunkMetadata.
  const retrieve = RunnableLambda.from(
    async (input: RagInput) =>
      (await deps.store
        .asRetriever({ k, filter: { documentIds: input.fileIds } })
        .invoke(input.question)) as Document<ChunkMetadata>[]
  );

  const answer = RunnableSequence.from([
    (input: WithDocs) => ({ context: formatContext(input.docs), question: input.question }),
    prompt,
    deps.model,
    new StringOutputParser(),
  ]);

  return RunnableSequence.from<RagInput, RagOutput>([
    RunnablePassthrough.assign<RagInput, Pick<WithDocs, 'docs'>>({ docs: retrieve }),
    RunnableBranch.from<WithDocs, RagOutput>([
      [(input) => input.docs.length === 0, () => ({ answer: NO_RESULTS_ANSWER, docs: [] })],
      RunnableLambda.from(async (input: WithDocs) => ({ answer: await answer.invoke(input), docs: input.docs })),
    ]),
  ]);
}
