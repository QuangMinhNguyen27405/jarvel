// A fake Bedrock Converse client. It never calls AWS; each call returns the next scripted response.
import type { ConverseCommandInput, ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import type { ConverseFn } from '../../src/lib/ai.js';
import { TOOL_NAME } from '../../src/lib/ai.js';

export type ScriptedResponse = ConverseCommandOutput | Error | 'hang';

/** A Converse response whose tool call carries `input`; token counts default to 1000 in / 200 out. */
export function toolAnswer(input: unknown, usage = { inputTokens: 1000, outputTokens: 200 }): ConverseCommandOutput {
  return {
    $metadata: {},
    output: {
      message: {
        role: 'assistant',
        content: [{ toolUse: { toolUseId: 't1', name: TOOL_NAME, input: input as never } }],
      },
    },
    stopReason: 'tool_use',
    usage: { ...usage, totalTokens: usage.inputTokens + usage.outputTokens },
    metrics: { latencyMs: 1 },
  };
}

/** A response with plain text and no tool call (badly structured output). */
export function textAnswer(text = 'Here is your plan!'): ConverseCommandOutput {
  return {
    $metadata: {},
    output: { message: { role: 'assistant', content: [{ text }] } },
    stopReason: 'end_turn',
    usage: { inputTokens: 1000, outputTokens: 50, totalTokens: 1050 },
    metrics: { latencyMs: 1 },
  };
}

export function serviceError(name: string): Error {
  return Object.assign(new Error(`${name} from the fake`), { name });
}

export interface FakeConverse {
  converse: ConverseFn;
  calls: ConverseCommandInput[];
}

/** Returns the scripted responses in order; 'hang' waits until the call is aborted. */
export function fakeConverse(responses: ScriptedResponse[]): FakeConverse {
  const calls: ConverseCommandInput[] = [];
  const converse: ConverseFn = async (input, options) => {
    calls.push(input);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next === undefined) throw new Error('fake converse has no scripted response');
    if (next === 'hang') {
      return new Promise<never>((_, reject) => {
        options?.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason), { once: true });
      });
    }
    if (next instanceof Error) throw next;
    return next;
  };
  return { converse, calls };
}

/** A valid answer for the base 4-day trip (Nov 18-21 2026). */
export function baseSelection() {
  return {
    days: [
      { date: '2026-11-18', placeIds: ['boston-public-library'] },
      { date: '2026-11-19', placeIds: ['new-england-aquarium', 'faneuil-hall-marketplace'] },
      { date: '2026-11-20', placeIds: ['harvard-yard'] },
      { date: '2026-11-21', placeIds: [] },
    ],
  };
}
