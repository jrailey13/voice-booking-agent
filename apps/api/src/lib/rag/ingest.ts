import type { PrismaClient } from '@prisma/client';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { Document } from '@langchain/core/documents';
import type { TextSplitter } from '@langchain/textsplitters';
import { PrismaVectorStore, type ChunkMetadata } from './prismaVectorStore';

export interface IngestDeps {
  db: Pick<PrismaClient, '$transaction'>;
  embeddings: EmbeddingsInterface;
  splitter: TextSplitter;
}

export interface IngestInput {
  id: string;
  name: string;
  size: number;
  type: string;
  text: string;
}

/**
 * Split, embed and store one document. Embedding (slow, network-bound) happens
 * before the transaction; the document row and its chunks are then written
 * all-or-nothing, so a failure at any point leaves no partial document.
 */
export async function ingestDocument(deps: IngestDeps, doc: IngestInput): Promise<{ chunkCount: number }> {
  const pieces = doc.text ? await deps.splitter.splitText(doc.text) : [];
  const chunks = pieces.map(
    (pageContent, chunkIndex) =>
      new Document<ChunkMetadata>({ pageContent, metadata: { documentId: doc.id, documentName: doc.name, chunkIndex } })
  );
  const vectors = chunks.length ? await deps.embeddings.embedDocuments(pieces) : [];

  await deps.db.$transaction(async (tx) => {
    await tx.ragDocument.create({
      data: { id: doc.id, name: doc.name, size: doc.size, type: doc.type, content: doc.text },
    });
    if (chunks.length) await new PrismaVectorStore(deps.embeddings, tx).addVectors(vectors, chunks);
  });

  return { chunkCount: chunks.length };
}
