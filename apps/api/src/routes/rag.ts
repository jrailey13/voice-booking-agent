import { FastifyPluginAsync } from 'fastify';
import { RagService } from '../services/rag.service';

const ragService = new RagService();

export const ragRoutes: FastifyPluginAsync = async (server) => {
  // Upload document
  server.post('/upload', async (request, reply) => {
    try {
      const data = await request.file();
      
      if (!data) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'No file provided',
          statusCode: 400,
        });
      }

      const buffer = await data.toBuffer();
      const result = await ragService.uploadDocument({
        filename: data.filename,
        mimetype: data.mimetype,
        buffer,
      });

      return reply.code(200).send(result);
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to upload document',
        statusCode: 500,
      });
    }
  });

  // Query documents
  server.post<{
    Body: { question: string; fileIds: string[] };
  }>('/query', async (request, reply) => {
    try {
      const { question, fileIds } = request.body;

      if (!question || !fileIds || fileIds.length === 0) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Question and fileIds are required',
          statusCode: 400,
        });
      }

      const result = await ragService.queryDocuments(question, fileIds);
      return reply.code(200).send(result);
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to query documents',
        statusCode: 500,
      });
    }
  });

  // Delete document
  server.delete<{
    Params: { fileId: string };
  }>('/documents/:fileId', async (request, reply) => {
    try {
      const { fileId } = request.params;
      await ragService.deleteDocument(fileId);
      return reply.code(204).send();
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete document',
        statusCode: 500,
      });
    }
  });
};
