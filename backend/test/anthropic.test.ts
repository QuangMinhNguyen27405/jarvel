import Anthropic from '@anthropic-ai/sdk';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aiFromEnv } from '../src/handlers/planner.js';
import {
  AiError,
  buildConverseInput,
  chooseStops,
  DEFAULT_MODEL_ID,
  DEFAULT_PRICES,
  TOOL_NAME,
  type SelectionInput,
} from '../src/lib/ai.js';
import {
  anthropicFromParameterStore,
  createAnthropicConverse,
  DEFAULT_ANTHROPIC_MODEL_ID,
  toConverseOutput,
  toMessagesRequest,
  toServiceError,
  type SendMessageFn,
} from '../src/lib/anthropic.js';
import { loadBostonData } from '../src/lib/data.js';
import { listDates } from '../src/lib/time.js';
import { baseSelection } from './fixtures/fake-ai.js';
import { validTripRequest } from './fixtures/requests.js';

// Nothing here calls Anthropic or AWS: the sender, the network and Parameter Store are all fakes.
const ssmMock = mockClient(SSMClient);
const KEY_PARAMETER = '/jarvel/staging/anthropic-api-key';

const input: SelectionInput = {
  request: validTripRequest(),
  dates: listDates('2026-11-18', '2026-11-21'),
  wishlistPlaceIds: ['boston-public-library', 'new-england-aquarium', 'harvard-yard'],
  catalog: loadBostonData().places,
};
const noSleep = vi.fn(async () => {});

function message(content: unknown[], overrides: Record<string, unknown> = {}): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: DEFAULT_ANTHROPIC_MODEL_ID,
    content,
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200 },
    ...overrides,
  } as unknown as Anthropic.Message;
}

const toolCall = (answer: unknown) => message([{ type: 'tool_use', id: 'toolu_1', name: TOOL_NAME, input: answer }]);

function apiError(status: number, type: string): Error {
  const body = { type: 'error', error: { type, message: 'from the fake' } };
  return Anthropic.APIError.generate(status, body, undefined, new Headers());
}

/** A sender that returns the scripted responses in order, repeating the last one, and records every request. */
function fakeSender(responses: (Anthropic.Message | Error)[]) {
  const calls: { body: Anthropic.MessageCreateParamsNonStreaming; signal?: AbortSignal }[] = [];
  const send: SendMessageFn = async (body, options) => {
    calls.push({ body, signal: options?.signal });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    if (next instanceof Error) throw next;
    return next;
  };
  const connect = vi.fn(async () => send);
  return { calls, connect, converse: createAnthropicConverse(connect, () => 0) };
}

const options = (converse: ReturnType<typeof fakeSender>['converse'], abortSignal?: AbortSignal) => ({
  converse,
  modelId: DEFAULT_ANTHROPIC_MODEL_ID,
  prices: DEFAULT_PRICES,
  sleep: noSleep,
  abortSignal,
});

beforeEach(() => {
  ssmMock.reset();
  noSleep.mockClear();
});

describe('toMessagesRequest', () => {
  it('sends the planner request as one Messages request with the forced tool', () => {
    const body = toMessagesRequest(buildConverseInput(input, DEFAULT_ANTHROPIC_MODEL_ID));
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.max_tokens).toBe(1500);
    expect(body.system).toContain('Boston trip planner');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ role: 'user', content: [{ type: 'text' }] });
    expect(JSON.stringify(body.messages[0])).toContain('TRIP DATES: 2026-11-18');
    expect(body.tools).toHaveLength(1);
    expect(body.tools![0]).toMatchObject({ name: TOOL_NAME, input_schema: { type: 'object', required: ['days'] } });
    expect(body.tool_choice).toEqual({ type: 'tool', name: TOOL_NAME });
  });

  it('leaves out sampling settings, which the current Anthropic API version rejects', () => {
    const body = toMessagesRequest(buildConverseInput(input, DEFAULT_ANTHROPIC_MODEL_ID));
    for (const setting of ['temperature', 'top_p', 'top_k']) expect(body).not.toHaveProperty(setting);
  });

  it('carries assistant turns and an "any tool" choice, and omits what the request does not have', () => {
    const body = toMessagesRequest({
      modelId: 'claude-haiku-4-5',
      inferenceConfig: { maxTokens: 10 },
      messages: [
        { role: 'user', content: [{ text: 'hello' }] },
        { role: 'assistant', content: [{ text: 'hi' }] },
      ],
      toolConfig: {
        tools: [{ toolSpec: { name: 'a', inputSchema: { json: { type: 'object' } } } }],
        toolChoice: { any: {} },
      },
    });
    expect(body.messages.map((turn) => turn.role)).toEqual(['user', 'assistant']);
    expect(body.tool_choice).toEqual({ type: 'any' });
    expect(body).not.toHaveProperty('system');
    const plain = toMessagesRequest({ modelId: 'claude-haiku-4-5', inferenceConfig: { maxTokens: 10 } });
    expect(plain).toEqual({ model: 'claude-haiku-4-5', max_tokens: 10, messages: [] });
  });

  it('refuses a request it cannot send faithfully', () => {
    const base = { modelId: 'claude-haiku-4-5', inferenceConfig: { maxTokens: 10 } };
    expect(() => toMessagesRequest({ ...base, modelId: undefined })).toThrow(/model id and a token limit/);
    expect(() => toMessagesRequest({ modelId: 'claude-haiku-4-5' })).toThrow(/model id and a token limit/);
    const image = { image: { format: 'png' as const, source: { bytes: new Uint8Array() } } };
    expect(() => toMessagesRequest({ ...base, messages: [{ role: 'user', content: [image] }] })).toThrow(
      /message 1 is not text/,
    );
    expect(() => toMessagesRequest({ ...base, system: [{ cachePoint: { type: 'default' } }] })).toThrow(
      /the system prompt is not text/,
    );
    const noSchema = { toolSpec: { name: 'a', inputSchema: undefined } };
    expect(() => toMessagesRequest({ ...base, toolConfig: { tools: [noSchema] } })).toThrow(/JSON schema/);
  });
});

describe('toConverseOutput', () => {
  it('maps the tool call, text, token counts and stop reason', () => {
    const output = toConverseOutput(
      message([
        { type: 'text', text: 'Here you go' },
        { type: 'tool_use', id: 'toolu_9', name: TOOL_NAME, input: { days: [] } },
        { type: 'thinking', thinking: '', signature: 's' },
      ]),
      12,
    );
    expect(output.output?.message?.content).toEqual([
      { text: 'Here you go' },
      { toolUse: { toolUseId: 'toolu_9', name: TOOL_NAME, input: { days: [] } } },
    ]);
    expect(output.usage).toEqual({ inputTokens: 1000, outputTokens: 200, totalTokens: 1200 });
    expect(output.stopReason).toBe('tool_use');
    expect(output.metrics).toEqual({ latencyMs: 12 });
  });

  it('maps a refusal and a missing stop reason', () => {
    expect(toConverseOutput(message([], { stop_reason: 'refusal' })).stopReason).toBe('content_filtered');
    expect(toConverseOutput(message([], { stop_reason: null })).stopReason).toBe('end_turn');
  });
});

describe('toServiceError', () => {
  it.each([
    [429, 'rate_limit_error', 'ThrottlingException'],
    [529, 'overloaded_error', 'ServiceUnavailableException'],
    [503, 'api_error', 'ServiceUnavailableException'],
    [504, 'timeout_error', 'ModelTimeoutException'],
    [408, 'timeout_error', 'ModelTimeoutException'],
    [500, 'api_error', 'InternalServerException'],
    [401, 'authentication_error', 'AnthropicAuthenticationError'],
    [403, 'permission_error', 'AnthropicPermissionDeniedError'],
    [404, 'not_found_error', 'AnthropicNotFoundError'],
    [400, 'invalid_request_error', 'AnthropicBadRequestError'],
    [402, 'billing_error', 'AnthropicApiError'],
  ])('names an HTTP %i (%s) %s', (status, type, name) => {
    const original = apiError(status, type);
    const mapped = toServiceError(original) as Error;
    expect(mapped.name).toBe(name);
    expect(mapped.message).toBe(`The Anthropic API call failed with HTTP ${status}`);
    expect(mapped.cause).toBe(original);
  });

  it('names network failures, and passes an aborted call and other errors through', () => {
    const timeout = toServiceError(new Anthropic.APIConnectionTimeoutError()) as Error;
    expect(timeout.name).toBe('ModelTimeoutException');
    expect(timeout.message).toBe('The Anthropic API call failed');
    expect((toServiceError(new Anthropic.APIConnectionError({ message: 'offline' })) as Error).name).toBe(
      'ServiceUnavailableException',
    );
    const aborted = new Anthropic.APIUserAbortError();
    expect(toServiceError(aborted)).toBe(aborted);
    const other = new TypeError('not from the SDK');
    expect(toServiceError(other)).toBe(other);
  });
});

describe('chooseStops through the Anthropic adapter (D3, NFR9)', () => {
  it('returns a checked selection and its token-based cost (NFR3)', async () => {
    const fake = fakeSender([toolCall(baseSelection())]);
    const result = await chooseStops(input, options(fake.converse));
    expect(result.selection).toEqual(baseSelection());
    expect(result.attempts).toBe(1);
    expect(result.costUSD).toBeCloseTo((1000 * 1 + 200 * 5) / 1_000_000, 10);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.body.model).toBe(DEFAULT_ANTHROPIC_MODEL_ID);
  });

  it('retries a rate-limited call and an unusable answer, then uses the good answer', async () => {
    const fake = fakeSender([
      apiError(429, 'rate_limit_error'),
      message([{ type: 'text', text: 'Here is your plan!' }], { stop_reason: 'end_turn' }),
      toolCall(baseSelection()),
    ]);
    const result = await chooseStops(input, options(fake.converse));
    expect(result.attempts).toBe(3);
    expect(fake.calls).toHaveLength(3);
    expect(fake.connect).toHaveBeenCalledTimes(1);
  });

  it('gives up after three busy answers with a service error', async () => {
    const fake = fakeSender([apiError(529, 'overloaded_error')]);
    const error = await chooseStops(input, options(fake.converse)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).failure).toBe('service');
    expect(fake.calls).toHaveLength(3);
  });

  it('does not retry a refused key, and reads the key again for the next plan', async () => {
    const fake = fakeSender([apiError(401, 'authentication_error'), toolCall(baseSelection())]);
    const error = await chooseStops(input, options(fake.converse)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).message).toContain('AnthropicAuthenticationError');
    expect((error as AiError).attempts).toBe(1);
    expect(fake.calls).toHaveLength(1);

    expect((await chooseStops(input, options(fake.converse))).attempts).toBe(1);
    expect(fake.connect).toHaveBeenCalledTimes(2);
  });

  it('reports a key that cannot be read, and tries to read it again for the next plan', async () => {
    const fake = fakeSender([toolCall(baseSelection())]);
    fake.connect.mockRejectedValueOnce(Object.assign(new Error('no such parameter'), { name: 'ParameterNotFound' }));
    const error = await chooseStops(input, options(fake.converse)).catch((e: unknown) => e);
    expect((error as AiError).failure).toBe('service');
    expect((error as AiError).message).toContain('ParameterNotFound');
    expect(fake.calls).toHaveLength(0);

    expect((await chooseStops(input, options(fake.converse))).selection).toEqual(baseSelection());
    expect(fake.connect).toHaveBeenCalledTimes(2);
  });

  it('hands the planner’s abort signal to the request and stops with its reason', async () => {
    const controller = new AbortController();
    const reason = new Error('out of time');
    const calls: (AbortSignal | undefined)[] = [];
    const converse = createAnthropicConverse(async () => async (_body, requestOptions) => {
      calls.push(requestOptions?.signal);
      controller.abort(reason);
      throw new Anthropic.APIUserAbortError();
    });
    await expect(chooseStops(input, options(converse, controller.signal))).rejects.toBe(reason);
    expect(calls).toEqual([controller.signal]);
  });
});

describe('anthropicFromParameterStore', () => {
  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function fakeFetch(responses: (() => Response)[]) {
    const requests: { url: string; method?: string; headers: Headers; body: Record<string, unknown> }[] = [];
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return responses[Math.min(requests.length - 1, responses.length - 1)]!();
    };
    return { requests, fetch };
  }

  it('reads the key once, decrypted, and sends the request to the Anthropic API with it', async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: ' test-key-123\n' } });
    const network = fakeFetch([() => jsonResponse(200, toolCall(baseSelection()))]);
    const converse = createAnthropicConverse(anthropicFromParameterStore(KEY_PARAMETER, { fetch: network.fetch }));

    const first = await chooseStops(input, { ...options(converse) });
    await chooseStops(input, { ...options(converse) });
    expect(first.selection).toEqual(baseSelection());

    const reads = ssmMock.commandCalls(GetParameterCommand);
    expect(reads).toHaveLength(1);
    expect(reads[0]!.args[0].input).toEqual({ Name: KEY_PARAMETER, WithDecryption: true });

    expect(network.requests).toHaveLength(2);
    const sent = network.requests[0]!;
    expect(sent.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent.method?.toUpperCase()).toBe('POST');
    expect(`${sent.headers.get('authorization')} ${sent.headers.get('x-api-key')}`).toContain('test-key-123');
    expect(sent.body).toMatchObject({ model: 'claude-haiku-4-5', max_tokens: 1500, tool_choice: { type: 'tool' } });
    expect(sent.body).not.toHaveProperty('temperature');
  });

  it('refuses an empty parameter', async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: '  ' } });
    await expect(anthropicFromParameterStore(KEY_PARAMETER)()).rejects.toMatchObject({ name: 'AnthropicKeyMissing' });
  });

  it('does not retry inside the SDK, and reads a replaced key after Anthropic refuses the old one', async () => {
    ssmMock
      .on(GetParameterCommand)
      .resolvesOnce({ Parameter: { Value: 'old-key' } })
      .resolves({ Parameter: { Value: 'new-key' } });
    const refused = { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } };
    const network = fakeFetch([() => jsonResponse(401, refused), () => jsonResponse(200, toolCall(baseSelection()))]);
    const converse = createAnthropicConverse(anthropicFromParameterStore(KEY_PARAMETER, { fetch: network.fetch }));

    const error = await chooseStops(input, options(converse)).catch((e: unknown) => e);
    expect((error as AiError).message).toContain('AnthropicAuthenticationError');
    expect(network.requests).toHaveLength(1);

    await chooseStops(input, options(converse));
    expect(ssmMock.commandCalls(GetParameterCommand)).toHaveLength(2);
    const last = network.requests[1]!.headers;
    expect(`${last.get('authorization')} ${last.get('x-api-key')}`).toContain('new-key');
  });
});

describe('aiFromEnv', () => {
  it('uses Bedrock and its default model unless told otherwise', () => {
    expect(aiFromEnv({}).modelId).toBe(DEFAULT_MODEL_ID);
    expect(aiFromEnv({ AI_PROVIDER: 'bedrock', MODEL_ID: 'anthropic.claude-x' }).modelId).toBe('anthropic.claude-x');
    expect(aiFromEnv({}).converse).toBeTypeOf('function');
  });

  it('uses the Anthropic API when configured, with the key parameter named', () => {
    const env = { AI_PROVIDER: 'anthropic', ANTHROPIC_KEY_PARAMETER: KEY_PARAMETER };
    expect(aiFromEnv(env).modelId).toBe('claude-haiku-4-5');
    expect(aiFromEnv({ ...env, MODEL_ID: 'claude-haiku-5-5' }).modelId).toBe('claude-haiku-5-5');
    expect(aiFromEnv(env).converse).toBeTypeOf('function');
  });

  it('fails fast on a missing key parameter or an unknown provider', () => {
    expect(() => aiFromEnv({ AI_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_KEY_PARAMETER is required/);
    expect(() => aiFromEnv({ AI_PROVIDER: 'openai' })).toThrow(/must be bedrock or anthropic, got openai/);
  });
});
