import type { Callbacks } from '@langchain/core/callbacks/manager';
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { createChatModel } from './ai/models';
import { debugCallbacks } from './ai/stepTracer';
import { recentMessages } from './conversationHistory';

const SYSTEM_PROMPT = `You are a helpful booking assistant for a service provider. Your role is to:
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

export interface BookingResponseOptions {
  env?: NodeJS.ProcessEnv;
  /** The fetch the model sends requests with (tests use a fake Ollama). */
  fetch?: typeof fetch;
  callbacks?: Callbacks;
}

/**
 * The default booking reply: the LLM_MODEL chat model over the conversation's
 * latest messages. If Ollama fails or exceeds OLLAMA_TIMEOUT_MS, the request is
 * cancelled and a scripted reply keeps the call moving (C3).
 */
export async function generateBookingResponse(
  message: string,
  conversationId: string,
  options: BookingResponseOptions = {}
): Promise<string> {
  const env = options.env ?? process.env;
  let messages: BaseMessage[];
  try {
    // Conversation history: the latest messages, oldest first.
    const history = await recentMessages(conversationId);
    messages = [
      new SystemMessage(SYSTEM_PROMPT),
      ...history.map((m) => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))),
    ];
    // Add the current user message, unless the caller already stored it as the
    // latest turn (both services save it before asking for a reply).
    const latest = history[history.length - 1];
    if (!(latest && latest.role === 'user' && latest.content === message)) {
      messages.push(new HumanMessage(message));
    }
  } catch (error) {
    console.error('Error generating booking response:', error);
    throw new Error('Failed to generate booking response');
  }

  try {
    // gemma3-4B on CPU can take ~15-20s per turn; a 10s cap silently forced
    // every response into the scripted fallback, so the budget is configurable.
    // The signal goes to the model's fetch, so a timeout cancels the request
    // itself, even before Ollama's first token.
    const signal = AbortSignal.timeout(parseInt(env.OLLAMA_TIMEOUT_MS || '30000', 10));
    const model = createChatModel(env, { signal, fetch: options.fetch });
    const response = await model.invoke(messages, { signal, callbacks: options.callbacks ?? debugCallbacks(env) });
    return response.text.trim();
  } catch (ollamaError) {
    console.warn('Ollama generation failed, using fallback response:', ollamaError);
    return fallbackResponse(message);
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
