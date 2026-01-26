import { FastifyPluginAsync } from 'fastify';
import { VoiceService } from '../services/voice.service';

const voiceService = new VoiceService();

export const voiceRoutes: FastifyPluginAsync = async (server) => {
  // Start voice call
  server.post('/start', async (request, reply) => {
    try {
      const result = await voiceService.startCall();
      return reply.code(200).send(result);
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to start call',
        statusCode: 500,
      });
    }
  });

  // End voice call
  server.post<{
    Body: { callId: string };
  }>('/end', async (request, reply) => {
    try {
      const { callId } = request.body;

      if (!callId) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Call ID is required',
          statusCode: 400,
        });
      }

      await voiceService.endCall(callId);
      return reply.code(204).send();
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to end call',
        statusCode: 500,
      });
    }
  });

  // WebSocket for voice call
  server.get<{
    Params: { callId: string };
  }>('/:callId', { websocket: true }, (connection, request) => {
    const { callId } = request.params;

    server.log.info(`WebSocket connected for call: ${callId}`);

    // Send initial connection message
    connection.send(JSON.stringify({
      type: 'state',
      state: 'connected',
    }));

    connection.on('message', async (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString());
        await voiceService.handleWebSocketMessage(callId, data, connection);
      } catch (error) {
        server.log.error({ error }, 'WebSocket message error');
      }
    });

    connection.on('close', () => {
      server.log.info(`WebSocket closed for call: ${callId}`);
      voiceService.cleanupCall(callId);
    });

    connection.on('error', (error: Error) => {
      server.log.error({ error }, 'WebSocket error');
    });
  });
};
