import { FastifyPluginAsync } from 'fastify';
import { BookingService } from '../services/booking.service';

const bookingService = new BookingService();

export const bookingRoutes: FastifyPluginAsync = async (server) => {
  // Check availability
  server.get<{
    Querystring: { date: string };
  }>('/availability', async (request, reply) => {
    try {
      const { date } = request.query;

      if (!date) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Date parameter is required',
          statusCode: 400,
        });
      }

      const result = await bookingService.checkAvailability(date);
      return reply.code(200).send(result);
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to check availability',
        statusCode: 500,
      });
    }
  });

  // Create appointment
  server.post<{
    Body: { date: string; time: string; service: string };
  }>('/appointments', async (request, reply) => {
    try {
      const { date, time, service } = request.body;

      if (!date || !time || !service) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Date, time, and service are required',
          statusCode: 400,
        });
      }

      const result = await bookingService.createAppointment({ date, time, service });
      return reply.code(201).send(result);
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create appointment',
        statusCode: 500,
      });
    }
  });

  // Get appointments
  server.get('/appointments', async (request, reply) => {
    try {
      const result = await bookingService.getAppointments();
      return reply.code(200).send(result);
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get appointments',
        statusCode: 500,
      });
    }
  });

  // Chat with booking agent
  server.post<{
    Body: { message: string; conversationId?: string };
  }>('/chat', async (request, reply) => {
    try {
      const { message, conversationId } = request.body;

      if (!message) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Message is required',
          statusCode: 400,
        });
      }

      const result = await bookingService.chat(message, conversationId);
      return reply.code(200).send(result);
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to process chat message',
        statusCode: 500,
      });
    }
  });
};
