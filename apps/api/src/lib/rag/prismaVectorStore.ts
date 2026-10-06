import { VectorStore } from '@langchain/core/vectorstores';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { Document } from '@langchain/core/documents';
import type { Prisma } from '@prisma/client';

export interface ChunkMetadata {
  documentId: string;
  documentName: string;
  chunkIndex: number;
}

export interface ChunkFilter {
  documentIds: string[];
}

/** The prisma client or an interactive-transaction client. */
export type RagChunkDb = Pick<Prisma.TransactionClient, 'ragChunk'>;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vectors must have the same length');
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * A LangChain VectorStore over the existing rag_chunks table (ADR-004).
 *
 * Embeddings are stored as Float[] and ranked by brute-force cosine similarity
 * in process, the same algorithm the service used before. That is fine for a
 * personal corpus; pgvector is the scaling path (§9 of the architecture doc).
 * Because it implements the VectorStore contract, the rest of LangChain
 * (asRetriever, the RAG chain) works with it unchanged.
 */
export class PrismaVectorStore extends VectorStore {
  declare FilterType: ChunkFilter;

  constructor(embeddings: EmbeddingsInterface, private readonly db: RagChunkDb) {
    super(embeddings, {});
  }

  _vectorstoreType(): string {
    return 'prisma-float-array';
  }

  async addVectors(vectors: number[][], documents: Document[]): Promise<void> {
    if (vectors.length !== documents.length) {
      throw new Error(`Got ${vectors.length} vectors for ${documents.length} documents`);
    }
    const rows = documents.map((doc, i) => {
      const { documentId, chunkIndex } = doc.metadata as Partial<ChunkMetadata>;
      if (typeof documentId !== 'string' || typeof chunkIndex !== 'number') {
        throw new Error('PrismaVectorStore needs metadata.documentId (string) and metadata.chunkIndex (number)');
      }
      return { documentId, chunkIndex, content: doc.pageContent, embedding: vectors[i] };
    });
    await this.db.ragChunk.createMany({ data: rows });
  }

  async addDocuments(documents: Document[]): Promise<void> {
    const vectors = await this.embeddings.embedDocuments(documents.map((d) => d.pageContent));
    await this.addVectors(vectors, documents);
  }

  /**
   * Requires a filter: an unfiltered query would rank every chunk of every
   * document, which the API never wants, so it returns nothing instead.
   */
  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: ChunkFilter
  ): Promise<[Document<ChunkMetadata>, number][]> {
    if (!filter?.documentIds.length) return [];

    const chunks = await this.db.ragChunk.findMany({
      where: { documentId: { in: filter.documentIds } },
      include: { document: { select: { name: true } } },
    });

    return chunks
      .map((chunk): [Document<ChunkMetadata>, number] => [
        new Document<ChunkMetadata>({
          pageContent: chunk.content,
          metadata: { documentId: chunk.documentId, documentName: chunk.document.name, chunkIndex: chunk.chunkIndex },
        }),
        cosineSimilarity(query, chunk.embedding),
      ])
      .sort((a, b) => b[1] - a[1])
      .slice(0, k);
  }
}
