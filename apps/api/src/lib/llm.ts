import { ollama } from './ollama';
import { prisma } from './database';

/**
 * Parse user message to extract booking details
 */
function parseBookingDetails(message: string) {
  const lower = message.toLowerCase();
  
  // Try to find date references
  const datePatterns = [
    /monday|tuesday|wednesday|thursday|friday|saturday|sunday/i,
    /today|tomorrow|next week/i,
    /\d{4}-\d{2}-\d{2}/,
  ];
  
  let date = '';
  for (const pattern of datePatterns) {
    const match = lower.match(pattern);
    if (match) {
      date = match[0];
      break;
    }
  }
  
  // Try to find time references
  const timePatterns = [
    /(\d{1,2}):(\d{2})\s*(am|pm)/i,
    /(\d{1,2})\s*(am|pm)/i,
    /(morning|afternoon|evening)/i,
  ];
  
  let time = '';
  for (const pattern of timePatterns) {
    const match = lower.match(pattern);
    if (match) {
      time = match[0];
      break;
    }
  }
  
  // Try to find service type
  const serviceMatch = lower.match(/consultation|follow-?up|initial assessment|check-?up|appointment/i);
  const service = serviceMatch ? serviceMatch[0] : '';
  
  return { date, time, service };
}

/**
 * Check if user is confirming an appointment
 */
function isConfirmingAppointment(message: string): boolean {
  const confirmationWords = ['yes', 'yep', 'yeah', 'sure', 'okay', 'ok', 'sounds good', 'perfect', 'great', 'works', 'absolutely', 'definitely', 'can do', 'let\'s do it', 'book it', 'confirm'];
  const lower = message.toLowerCase();
  return confirmationWords.some(word => lower.includes(word));
}

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
      // Generate using Ollama, but fall back if it stalls past the timeout.
      // ollama-js has no per-request abort signal, so race the call against a
      // rejecting timer; a timeout rejects into the fallback branch below.
      const TIMEOUT_MS = 10000;
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
      // Fallback response based on message content
      const lowerMessage = message.toLowerCase();
      let fallbackResponse = '';
      
      if (lowerMessage.includes('book') || lowerMessage.includes('appointment')) {
        fallbackResponse = "I'd be happy to help you book an appointment! What service are you interested in? We offer consultations, follow-ups, and initial assessments.";
      } else if (lowerMessage.includes('morning') || lowerMessage.includes('afternoon')) {
        fallbackResponse = "Perfect! I have several slots available. Would Tuesday at 2:00 PM work for you?";
      } else if (lowerMessage.includes('yes') || lowerMessage.includes('confirm')) {
        fallbackResponse = "Great! Your booking preferences have been noted. Please click 'Create Appointment' to finalize.";
      } else {
        fallbackResponse = "I'm here to help you schedule appointments. What day and time would work best for you?";
      }
      
      return fallbackResponse;
    }
  } catch (error) {
    console.error('Error generating booking response:', error);
    throw new Error('Failed to generate booking response');
  }
}
