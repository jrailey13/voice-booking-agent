import crypto from 'crypto';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { prisma } from '../lib/database';
import { generateEmbedding, generateAnswer, cosineSimilarity } from '../lib/ollama';

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

interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  embedding: number[];
  chunkIndex: number;
}

interface StoredDocument {
  id: string;
  name: string;
  size: number;
  type: string;
  content: string;
  chunks: DocumentChunk[];
  uploadedAt: Date;
}

export class RagService {
  private readonly CHUNK_SIZE = 500; // characters per chunk
  private readonly CHUNK_OVERLAP = 100; // overlap between chunks
  private readonly TOP_K = 5; // number of relevant chunks to retrieve

  /**
   * Extract text from buffer (supports plain text, PDF, and DOCX)
   */
  private async extractText(buffer: Buffer, mimetype: string, filename: string): Promise<string> {
    try {
      // Plain text files
      if (mimetype.includes('text') || filename.endsWith('.txt')) {
        return buffer.toString('utf-8');
      }

      // PDF files
      if (mimetype.includes('pdf') || filename.endsWith('.pdf')) {
        const parser = new PDFParse({ data: buffer });
        try {
          const result = await parser.getText();
          return result.text;
        } catch (error) {
          console.error('Error parsing PDF:', error);
          throw new Error(`Failed to parse PDF: ${filename}`);
        } finally {
          await parser.destroy();
        }
      }

      // DOCX files
      if (
        mimetype.includes('wordprocessingml') ||
        mimetype.includes('word') ||
        filename.endsWith('.docx')
      ) {
        try {
          const result = await mammoth.extractRawText({ buffer });
          return result.value;
        } catch (error) {
          console.error('Error parsing DOCX:', error);
          throw new Error(`Failed to parse DOCX: ${filename}`);
        }
      }

      // Unsupported format - try UTF-8 as fallback
      console.warn(`Unsupported mimetype: ${mimetype}. Attempting UTF-8 extraction.`);
      return buffer.toString('utf-8');
    } catch (error) {
      console.error(`Error extracting text from ${filename}:`, error);
      throw error;
    }
  }

  /**
   * Split text into overlapping chunks
   */
  private chunkText(text: string): string[] {
    const chunks: string[] = [];
    let position = 0;

    while (position < text.length) {
      const chunkEnd = Math.min(position + this.CHUNK_SIZE, text.length);
      chunks.push(text.substring(position, chunkEnd));
      position += this.CHUNK_SIZE - this.CHUNK_OVERLAP;
    }

    return chunks;
  }

  async uploadDocument(params: UploadDocumentParams): Promise<UploadedDocument> {
    const { filename, mimetype, buffer } = params;
    const id = crypto.randomUUID();

    try {
      // Extract text from document
      const text = await this.extractText(buffer, mimetype, filename);

      // Split into chunks
      const textChunks = this.chunkText(text);

      // Generate embeddings for each chunk
      const chunks: Array<{
        content: string;
        embedding: number[];
        chunkIndex: number;
      }> = [];

      for (let i = 0; i < textChunks.length; i++) {
        const chunkContent = textChunks[i];
        const embedding = await generateEmbedding(chunkContent);
        chunks.push({
          content: chunkContent,
          embedding,
          chunkIndex: i,
        });
      }

      // Save to database
      await prisma.ragDocument.create({
        data: {
          id,
          name: filename,
          size: buffer.length,
          type: mimetype,
          content: text,
          chunks: {
            createMany: {
              data: chunks,
            },
          },
        },
      });

      return {
        id,
        name: filename,
        size: buffer.length,
        type: mimetype,
        status: 'ready',
      };
    } catch (error) {
      console.error(`Error uploading document ${filename}:`, error);
      return {
        id,
        name: filename,
        size: buffer.length,
        type: mimetype,
        status: 'failed',
      };
    }
  }

  async queryDocuments(question: string, fileIds: string[]): Promise<QueryResult> {
    try {
      // Generate embedding for the question
      const questionEmbedding = await generateEmbedding(question);

      // Retrieve relevant chunks from database
      const chunks = await prisma.ragChunk.findMany({
        where: {
          documentId: {
            in: fileIds,
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

      // Calculate similarity and rank chunks
      const relevantChunks = chunks
        .map((chunk) => ({
          content: chunk.content,
          similarity: cosineSimilarity(questionEmbedding, chunk.embedding),
          documentName: chunk.document.name,
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, this.TOP_K);

      if (relevantChunks.length === 0) {
        return {
          id: crypto.randomUUID(),
          answer: 'No relevant information found in the provided documents.',
          timestamp: new Date().toISOString(),
          sources: [],
        };
      }

      // Combine context from top chunks
      const context = relevantChunks
        .map((chunk) => `[${chunk.documentName}]\n${chunk.content}`)
        .join('\n\n---\n\n');

      // Generate answer using LLM with context
      const answer = await generateAnswer(question, context);

      // Prepare sources (unique documents used)
      const sources = Array.from(new Set(relevantChunks.map((c) => c.documentName))).map((docName) => ({
        title: docName,
        snippet: relevantChunks
          .find((c) => c.documentName === docName)
          ?.content.substring(0, 150) + '...' || '',
      }));

      // Log the query
      await prisma.queryLog.create({
        data: {
          question,
          answer,
          sources: fileIds,
        },
      });

      return {
        id: crypto.randomUUID(),
        answer,
        timestamp: new Date().toISOString(),
        sources,
      };
    } catch (error) {
      console.error('Error querying documents:', error);
      throw error;
    }
  }

  async deleteDocument(fileId: string): Promise<void> {
    try {
      await prisma.ragDocument.delete({
        where: { id: fileId },
      });
    } catch (error) {
      console.error('Error deleting document:', error);
      throw error;
    }
  }
}
