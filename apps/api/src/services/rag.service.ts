import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import type { Runnable } from '@langchain/core/runnables';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { prisma } from '../lib/database';
import { createChatModel, createEmbeddings } from '../lib/ai/models';
import { extractText } from '../lib/rag/extract';
import { ingestDocument } from '../lib/rag/ingest';
import { PrismaVectorStore } from '../lib/rag/prismaVectorStore';
import { buildRagChain, type RagInput, type RagOutput } from '../lib/rag/chain';

interface UploadDocumentParams {
  filename: string;
  mimetype: string;
  buffer: Buffer;
}

interface UploadedDocument {
  id: string;
  name: string;
  size: number;
  type: string;
  status: 'processing' | 'ready' | 'failed';
}

interface QueryResult {
  id: string;
  answer: string;
  timestamp: string;
  sources?: Array<{
    title: string;
    snippet: string;
  }>;
}

export interface RagServiceDeps {
  db: Pick<PrismaClient, '$transaction' | 'ragChunk' | 'ragDocument' | 'queryLog'>;
  embeddings: EmbeddingsInterface;
  model: BaseChatModel;
}

/**
 * Document Q&A over uploaded files, built from LangChain parts: a text
 * splitter, Ollama embeddings, a vector store over rag_chunks, and a
 * retrieval chain. The HTTP contract is unchanged from the hand-rolled
 * version and pinned by rag.service.test.ts.
 */
export class RagService {
  private readonly CHUNK_SIZE = 500; // characters per chunk
  private readonly CHUNK_OVERLAP = 100; // overlap between chunks
  private readonly TOP_K = 5; // number of relevant chunks to retrieve
  private readonly SNIPPET_LENGTH = 150;

  private readonly db: RagServiceDeps['db'];
  private readonly embeddings: EmbeddingsInterface;
  private readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: this.CHUNK_SIZE,
    chunkOverlap: this.CHUNK_OVERLAP,
  });
  private readonly chain: Runnable<RagInput, RagOutput>;

  constructor(deps: Partial<RagServiceDeps> = {}) {
    this.db = deps.db ?? prisma;
    this.embeddings = deps.embeddings ?? createEmbeddings();
    this.chain = buildRagChain({
      store: new PrismaVectorStore(this.embeddings, this.db),
      model: deps.model ?? createChatModel(),
      k: this.TOP_K,
    });
  }

  async uploadDocument(params: UploadDocumentParams): Promise<UploadedDocument> {
    const { filename, mimetype, buffer } = params;
    const id = crypto.randomUUID();
    const result = { id, name: filename, size: buffer.length, type: mimetype };

    try {
      const text = await extractText(buffer, mimetype, filename);
      await ingestDocument(
        { db: this.db, embeddings: this.embeddings, splitter: this.splitter },
        { ...result, text }
      );
      return { ...result, status: 'ready' };
    } catch (error) {
      // The route answers 200 with status 'failed'; the web client relies on that.
      console.error(`Error uploading document ${filename}:`, error);
      return { ...result, status: 'failed' };
    }
  }

  async queryDocuments(question: string, fileIds: string[]): Promise<QueryResult> {
    try {
      const { answer, docs } = await this.chain.invoke({ question, fileIds });

      if (docs.length === 0) {
        return { id: crypto.randomUUID(), answer, timestamp: new Date().toISOString(), sources: [] };
      }

      // One source per document, in rank order, quoting that document's best chunk.
      const sources: NonNullable<QueryResult['sources']> = [];
      for (const doc of docs) {
        const title = doc.metadata.documentName;
        if (sources.some((s) => s.title === title)) continue;
        sources.push({ title, snippet: doc.pageContent.substring(0, this.SNIPPET_LENGTH) + '...' });
      }

      await this.db.queryLog.create({
        data: { question, answer, sources: fileIds },
      });

      return { id: crypto.randomUUID(), answer, timestamp: new Date().toISOString(), sources };
    } catch (error) {
      console.error('Error querying documents:', error);
      throw error;
    }
  }

  async deleteDocument(fileId: string): Promise<void> {
    try {
      await this.db.ragDocument.delete({
        where: { id: fileId },
      });
    } catch (error) {
      console.error('Error deleting document:', error);
      throw error;
    }
  }
}
