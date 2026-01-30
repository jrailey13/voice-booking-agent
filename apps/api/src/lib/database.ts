import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  errorFormat: 'pretty',
});

/**
 * Database service for RAG operations
 */
export class DatabaseService {
  /**
   * Save document chunks to database
   */
  async saveDocumentWithChunks(
    documentId: string,
    name: string,
    size: number,
    type: string,
    content: string,
    chunks: Array<{
      content: string;
      embedding: number[];
      chunkIndex: number;
    }>
  ) {
    try {
      const document = await prisma.ragDocument.create({
        data: {
          id: documentId,
          name,
          size,
          type,
          content,
          chunks: {
            createMany: {
              data: chunks.map((chunk) => ({
                content: chunk.content,
                embedding: chunk.embedding,
                chunkIndex: chunk.chunkIndex,
              })),
            },
          },
        },
        include: {
          chunks: true,
        },
      });

      return document;
    } catch (error) {
      console.error('Error saving document:', error);
      throw error;
    }
  }

  /**
   * Delete document and its chunks
   */
  async deleteDocument(documentId: string) {
    try {
      await prisma.ragChunk.deleteMany({
        where: { documentId },
      });

      await prisma.ragDocument.delete({
        where: { id: documentId },
      });
    } catch (error) {
      console.error('Error deleting document:', error);
      throw error;
    }
  }

  /**
   * Get all chunks for a document
   */
  async getDocumentChunks(documentId: string) {
    try {
      const chunks = await prisma.ragChunk.findMany({
        where: { documentId },
        orderBy: { chunkIndex: 'asc' },
      });

      return chunks;
    } catch (error) {
      console.error('Error fetching document chunks:', error);
      throw error;
    }
  }

  /**
   * Get all documents
   */
  async getAllDocuments() {
    try {
      const documents = await prisma.ragDocument.findMany({
        select: {
          id: true,
          name: true,
          size: true,
          type: true,
          createdAt: true,
        },
      });

      return documents;
    } catch (error) {
      console.error('Error fetching documents:', error);
      throw error;
    }
  }

  /**
   * Find similar chunks using cosine similarity
   * Note: For production pgvector, use: SELECT ... ORDER BY embedding <-> query_embedding LIMIT k;
   * For now, we fetch all chunks and compute similarity in application
   */
  async findSimilarChunks(
    queryEmbedding: number[],
    documentIds: string[],
    topK: number = 5
  ) {
    try {
      const chunks = await prisma.ragChunk.findMany({
        where: {
          documentId: {
            in: documentIds,
          },
        },
        include: {
          document: {
            select: {
              name: true,
            },
          },
        },
      });

      return chunks;
    } catch (error) {
      console.error('Error finding similar chunks:', error);
      throw error;
    }
  }

  /**
   * Save query log
   */
  async logQuery(question: string, answer: string, sourceDocumentIds: string[]) {
    try {
      const log = await prisma.queryLog.create({
        data: {
          question,
          answer,
          sources: sourceDocumentIds,
        },
      });

      return log;
    } catch (error) {
      console.error('Error logging query:', error);
      throw error;
    }
  }
}

export const db = new DatabaseService();
