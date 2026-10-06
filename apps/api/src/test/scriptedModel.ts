import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { StructuredToolInterface } from '@langchain/core/tools';

/** A scripted reply, a hang until the abort signal fires, or an error to throw. */
export type Step = AIMessage | 'hang' | Error;

/** A chat model that replays scripted replies, one per call, and records what it got. */
export class ScriptedModel extends BaseChatModel {
  seen: BaseMessage[][] = [];
  boundTools: string[] = [];

  constructor(private readonly steps: Step[]) {
    super({});
  }

  _llmType() {
    return 'scripted';
  }

  bindTools(tools: StructuredToolInterface[]) {
    this.boundTools = tools.map((t) => t.name);
    return this as never;
  }

  async _generate(messages: BaseMessage[], options: this['ParsedCallOptions']): Promise<ChatResult> {
    this.seen.push([...messages]);
    const step = this.steps.shift() ?? new AIMessage('(script exhausted)');
    if (step instanceof Error) throw step;
    if (step === 'hang') {
      await new Promise((_, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    const message = step as AIMessage;
    return { generations: [{ message, text: typeof message.content === 'string' ? message.content : '' }] };
  }
}

/** An AIMessage that calls one tool. */
export const toolCall = (name: string, args: Record<string, unknown>, id = `call-${name}`) =>
  new AIMessage({ content: '', tool_calls: [{ name, args, id, type: 'tool_call' }] });
