import { ollama } from './ollama';
import { recentMessages } from './conversationHistory';

/**
 * Booking-specific LLM chat function
 * Handles conversational AI for appointment booking
 */
export async function generateBookingResponse(
  message: string,
  conversationId: string
): Promise<string> {
  try {
    // Get conversation history (the latest messages, oldest first)
    const messages = await recentMessages(conversationId);

    // Build conversation context
    let conversationContext = '';
    for (const msg of messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      conversationContext += `${role}: ${msg.content}\n`;
    }

    // Add the current user message, unless the caller already stored it as the
    // latest turn (both services save it before asking for a reply).
    const latest = messages[messages.length - 1];
    if (!(latest && latest.role === 'user' && latest.content === message)) {
      conversationContext += `User: ${message}\n`;
    }
    conversationContext += 'Assistant:';

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
      // Generate using Ollama, but fall back if it stalls past the timeout.
      // ollama-js has no per-request abort signal, so race the call against a
      // rejecting timer; a timeout rejects into the fallback branch below.
      // Configurable so slower local hardware can actually reach the model.
      // gemma3-4B on CPU can take ~15-20s per turn; a 10s cap silently forces
      // every response into the scripted fallback below.
      const TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || '30000', 10);
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error('Ollama generation timed out')),
          TIMEOUT_MS
        );
      });

      try {
        const response = await Promise.race([
          ollama.generate({
            model: process.env.LLM_MODEL || 'gemma3',
            prompt: conversationContext,
            system: systemPrompt,
            stream: false,
          }),
          timeout,
        ]);
        return response.response.trim();
      } finally {
        clearTimeout(timeoutHandle);
      }
    } catch (ollamaError) {
      console.warn('Ollama generation failed, using fallback response:', ollamaError);
      return fallbackResponse(message);
    }
  } catch (error) {
    console.error('Error generating booking response:', error);
    throw new Error('Failed to generate booking response');
  }
}

/**
 * Scripted reply for when the model is slow or unreachable, chosen by keyword
 * so the call keeps moving (C3). Shared with the booking agent.
 */
export function fallbackResponse(message: string): string {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('book') || lowerMessage.includes('appointment')) {
    return "I'd be happy to help you book an appointment! What service are you interested in? We offer consultations, follow-ups, and initial assessments.";
  } else if (lowerMessage.includes('morning') || lowerMessage.includes('afternoon')) {
    return "Perfect! I have several slots available. Would Tuesday at 2:00 PM work for you?";
  } else if (lowerMessage.includes('yes') || lowerMessage.includes('confirm')) {
    return "Great! Your booking preferences have been noted. Please click 'Create Appointment' to finalize.";
  }
  return "I'm here to help you schedule appointments. What day and time would work best for you?";
}
