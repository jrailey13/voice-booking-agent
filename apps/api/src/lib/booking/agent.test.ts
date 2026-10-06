import { describe, it, expect, beforeEach } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { runBookingTurn, TENTATIVE_REPLY, MAX_MODEL_CALLS } from './agent';
import { fallbackResponse } from '../llm';
import { FakeBookingDb } from '../../test/fakes';
import { ScriptedModel, toolCall } from '../../test/scriptedModel';

const REF = new Date(2026, 9, 5, 10, 0); // Monday 5 October 2026

const BOOK_TUESDAY = toolCall('book_appointment', { date: 'tomorrow', time: '2pm', service: 'consultation', customerName: 'Jane' });

let db: FakeBookingDb;
beforeEach(() => {
  db = new FakeBookingDb();
  db.conversations.push({ id: 'conv-1', appointmentId: null });
});

const turn = (model: BaseChatModel, message: string, extra: Partial<Parameters<typeof runBookingTurn>[1]> = {}) =>
  runBookingTurn({ model, db: db as never }, { message, conversationId: 'conv-1', history: [], ref: REF, ...extra });

describe('runBookingTurn', () => {
  it('books through the tool, then speaks the model reply', async () => {
    const model = new ScriptedModel([BOOK_TUESDAY, new AIMessage("You're booked for Tuesday at 2 PM, Jane.")]);

    const result = await turn(model, 'Tuesday at 2 for a consultation please, I am Jane');

    expect(model.boundTools).toEqual(['check_availability', 'book_appointment']);
    expect(result.reply).toBe("You're booked for Tuesday at 2 PM, Jane.");
    expect(result.booking).toMatchObject({ date: '2026-10-06', time: '02:00 PM', service: 'consultation', customerName: 'Jane' });
    // The tool result went back to the model, tied to its call id.
    const toolMessage = model.seen[1].at(-1) as ToolMessage;
    expect(toolMessage).toBeInstanceOf(ToolMessage);
    expect(toolMessage.tool_call_id).toBe('call-book_appointment');
    expect(toolMessage.content).toMatch(/^Booked: /);
  });

  it("gives the model today's date, the history, and the new message once", async () => {
    const model = new ScriptedModel([new AIMessage('Which day suits you?')]);

    await turn(model, 'I need an appointment', {
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello! How can I help?' },
        { role: 'user', content: 'I need an appointment' },
      ],
    });

    const [system, ...rest] = model.seen[0];
    expect(system.getType()).toBe('system');
    expect(system.content).toContain('Monday, October 5, 2026');
    expect(rest.map((m) => [m.getType(), m.content])).toEqual([
      ['human', 'Hi'],
      ['ai', 'Hello! How can I help?'],
      ['human', 'I need an appointment'],
    ]);
  });

  describe('FR2: never confirm a booking that was not written', () => {
    it('replaces a confirmation the model made without booking', async () => {
      const result = await turn(new ScriptedModel([new AIMessage("Great, you're all set for Tuesday at 2!")]), 'Tuesday at 2');
      expect(result.reply).toBe(TENTATIVE_REPLY);
      expect(result.booking).toBeNull();
      expect(db.appointments).toEqual([]);
    });

    it('replaces a confirmation after a refusal with the refusal itself', async () => {
      db.appointments.push({ id: 'x', date: '2026-10-06', time: '02:00 PM', service: 'consultation', customerName: null, customerContact: null, status: 'confirmed' });
      // Also covers the false positive seen live: "2 PM is already booked" trips the cue.
      for (const said of ["You're booked!", '2 PM is already booked, sorry.']) {
        const result = await turn(new ScriptedModel([BOOK_TUESDAY, new AIMessage(said)]), 'Tuesday at 2');
        expect(result.reply).toMatch(/^Sorry, 02:00 PM on Tuesday, October 6 is already taken\. Open times: 09:00 AM, .*03:00 PM/);
        expect(result.booking).toBeNull();
      }
    });

    it('lets the model relay the refusal in its own words', async () => {
      db.appointments.push({ id: 'x', date: '2026-10-06', time: '02:00 PM', service: 'consultation', customerName: null, customerContact: null, status: 'confirmed' });
      const result = await turn(new ScriptedModel([BOOK_TUESDAY, new AIMessage('2 PM is taken. Would 3 PM work?')]), 'Tuesday at 2');
      expect(result.reply).toBe('2 PM is taken. Would 3 PM work?');
    });

    it('allows confirmation language once the conversation is already booked', async () => {
      db.appointments.push({ id: 'appt-0', date: '2026-10-06', time: '02:00 PM', service: 'consultation', customerName: null, customerContact: null, status: 'confirmed' });
      db.conversations[0].appointmentId = 'appt-0';
      const model = new ScriptedModel([new AIMessage("You're all set, see you Tuesday!")]);

      const result = await turn(model, 'thanks!');

      expect(result.reply).toBe("You're all set, see you Tuesday!");
      expect(result.booking).toBeNull(); // nothing new was written this turn
      expect(model.seen[0][0].content).toContain('already booked: consultation on Tuesday, October 6 at 02:00 PM');
    });
  });

  describe('bounds and failures (C3)', () => {
    it(`stops after ${MAX_MODEL_CALLS} model calls and falls back`, async () => {
      const looping = Array.from({ length: 10 }, (_, i) => toolCall('check_availability', { date: 'tomorrow' }, `c${i}`));
      const model = new ScriptedModel(looping);

      const result = await turn(model, 'what is open tomorrow?');

      expect(model.seen).toHaveLength(MAX_MODEL_CALLS);
      expect(result.reply).toBe(fallbackResponse('what is open tomorrow?'));
    });

    it('falls back to the scripted reply when the model fails', async () => {
      const result = await turn(new ScriptedModel([new Error('connection refused')]), 'I want to book');
      expect(result).toEqual({ reply: fallbackResponse('I want to book'), booking: null });
    });

    it('cancels a slow model through the abort signal and falls back', async () => {
      const result = await turn(new ScriptedModel(['hang']), 'I want to book', { signal: AbortSignal.timeout(20) });
      expect(result).toEqual({ reply: fallbackResponse('I want to book'), booking: null });
    });

    it('still confirms, truthfully, a booking written before the model failed', async () => {
      const result = await turn(new ScriptedModel([BOOK_TUESDAY, new Error('timeout')]), 'Tuesday at 2');
      expect(result.booking).toMatchObject({ date: '2026-10-06', time: '02:00 PM' });
      expect(result.reply).toBe("You're booked for a consultation on Tuesday, October 6 at 02:00 PM.");
    });

    it('tells the model about a tool it does not have', async () => {
      const model = new ScriptedModel([toolCall('cancel_everything', {}), new AIMessage('Which day would you like?')]);
      await turn(model, 'hi');
      expect(model.seen[1].at(-1)?.content).toMatch(/^Error: unknown tool cancel_everything/);
    });
  });

  it('passes callbacks to the model and the tools', async () => {
    const events: string[] = [];
    const handler = {
      handleChatModelStart: async () => { events.push('model'); },
      handleToolStart: async () => { events.push('tool'); },
    };
    await runBookingTurn(
      { model: new ScriptedModel([BOOK_TUESDAY, new AIMessage('Done.')]), db: db as never, callbacks: [handler] },
      { message: 'Tuesday at 2', conversationId: 'conv-1', history: [], ref: REF }
    );
    expect(events).toEqual(['model', 'tool', 'model']);
  });
});
