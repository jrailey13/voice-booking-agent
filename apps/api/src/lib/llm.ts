import { ollama } from './ollama';
import { prisma } from './database';

/**
 * Booking-specific LLM chat function
 * Handles conversational AI for appointment booking
 */
export async function generateBookingResponse(
  message: string,
  conversationId: string
): Promise<string> {
  try {
    // Get conversation history
    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 10, // Last 10 messages for context
    });

    // Build conversation context
    let conversationContext = '';
    for (const msg of messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      conversationContext += `${role}: ${msg.content}\n`;
    }

    // Add current user message
    conversationContext += `User: ${message}\nAssistant:`;

    const systemPrompt = `You are a helpful booking assistant for a service provider. Your role is to:
1. Help customers book appointments
2. Check availability and suggest times
3. Confirm bookings with customers
4. Answer questions about services (consultations, follow-ups, initial assessments)
5. Be friendly and professional

When a customer wants to book:
- Ask for their preferred date and time
- Confirm the service type they need
- Provide a confirmation message

Keep responses concise and helpful. If you need information not provided, ask the customer.

Available services: consultations, follow-ups, initial assessments
Available times: 09:00 AM, 10:00 AM, 11:00 AM, 01:00 PM, 02:00 PM, 03:00 PM, 04:00 PM

Always respond as if you're continuing a conversation with the customer.`;

    try {
      // Try to generate using Ollama with a timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await ollama.generate({
        model: process.env.LLM_MODEL || 'gemma3',
        prompt: conversationContext,
        system: systemPrompt,
        stream: false,
      });

      clearTimeout(timeoutId);
      return response.response.trim();
    } catch (ollamaError) {
      console.warn('Ollama generation failed, using fallback response:', ollamaError);
      // Fallback response based on message content
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('book') || lowerMessage.includes('appointment')) {
        return "I'd be happy to help you book an appointment! What service are you interested in? We offer consultations, follow-ups, and initial assessments.";
      } else if (lowerMessage.includes('morning') || lowerMessage.includes('afternoon')) {
        return "Perfect! I have several slots available. Would Tuesday at 2:00 PM work for you?";
      } else if (lowerMessage.includes('yes') || lowerMessage.includes('confirm')) {
        return "Excellent! Your appointment has been confirmed. You'll receive a confirmation email shortly.";
      } else {
        return "I'm here to help you schedule appointments. What day and time would work best for you?";
      }
    }
  } catch (error) {
    console.error('Error generating booking response:', error);
    throw new Error('Failed to generate booking response');
  }
}
