// Load .env before any other module evaluates. Route imports below pull in
// services (e.g. whisper.ts) that read process.env at module load, so dotenv
// must run first — a plain `dotenv.config()` after these imports is too late.
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { ragRoutes } from './routes/rag';
import { bookingRoutes } from './routes/booking';
import { voiceRoutes } from './routes/voice';
import { assertNoRemoteTracing } from './lib/ai/guards';
import { assertBookingAgentReady } from './lib/booking/respond';

const server = Fastify({
  logger: process.env.NODE_ENV === 'development' ? {
    level: process.env.LOG_LEVEL || 'info',
  } : true,
});

const start = async () => {
  try {
    // Refuse to run if LangChain tracing would ship prompts/documents off-host.
    assertNoRemoteTracing();
    await assertBookingAgentReady();

    // Register plugins
    await server.register(cors, {
      origin: process.env.CORS_ORIGIN || 'http://localhost:8080',
      credentials: true,
    });

    await server.register(multipart, {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    });

    await server.register(websocket);

    // Root endpoint
    server.get('/', async () => {
      return {
        name: 'AI Services API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
          health: '/health',
          rag: '/api/rag/*',
          booking: '/api/booking/*',
          voice: '/api/voice/*',
        },
      };
    });

    // Health check
    server.get('/health', async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // Register routes
    await server.register(ragRoutes, { prefix: '/api/rag' });
    await server.register(bookingRoutes, { prefix: '/api/booking' });
    await server.register(voiceRoutes, { prefix: '/api/voice' });

    const port = parseInt(process.env.PORT || '3001', 10);

    await server.listen({ port, host: 'localhost' });
    console.log(`🚀 Server running at http://localhost:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
