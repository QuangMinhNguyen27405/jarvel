// The same AI call through the Anthropic API instead of Amazon Bedrock (AI_PROVIDER=anthropic). This is an adapter
// with the shape of Bedrock Converse, so lib/ai.ts, its answer checks, its retries (NFR9) and its cost sum (NFR3)
// run unchanged whichever provider is configured. The API key is read from Parameter Store when the first plan
// needs it; it is never logged and never put in an environment variable. The sender is injected, so tests use a
// fake and never call Anthropic.
import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  ConverseCommandInput,
  ConverseCommandOutput,
  StopReason as ConverseStopReason,
} from '@aws-sdk/client-bedrock-runtime';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { ConverseFn } from './ai.js';

/** Default model on the Anthropic API: Claude Haiku 4.5, the same model the Bedrock default runs (D4). */
export const DEFAULT_ANTHROPIC_MODEL_ID = 'claude-haiku-4-5';

/** One request may take this long; three attempts then still fit in the planner's 5 minutes. */
export const REQUEST_TIMEOUT_MS = 90_000;

export type SendMessageFn = (
  body: Anthropic.MessageCreateParamsNonStreaming,
  options?: { signal?: AbortSignal },
) => Promise<Anthropic.Message>;

function textOf(block: { text?: string }, where: string): string {
  if (typeof block.text !== 'string')
    throw new Error(`The Anthropic adapter only sends text, but ${where} is not text`);
  return block.text;
}

/**
 * Turns the planner's Converse request into a Messages request. `temperature` is left out on purpose: the current
 * Anthropic API version rejects sampling settings on every model, so this path samples with the model's defaults.
 */
export function toMessagesRequest(input: ConverseCommandInput): Anthropic.MessageCreateParamsNonStreaming {
  const maxTokens = input.inferenceConfig?.maxTokens;
  if (!input.modelId || !maxTokens) throw new Error('The AI request needs a model id and a token limit');
  const messages: Anthropic.MessageParam[] = (input.messages ?? []).map((message, index) => {
    const content = (message.content ?? []).map((block) => ({
      type: 'text' as const,
      text: textOf(block, `message ${index + 1}`),
    }));
    return message.role === 'assistant' ? { role: 'assistant', content } : { role: 'user', content };
  });
  const tools: Anthropic.Tool[] = (input.toolConfig?.tools ?? []).map((tool) => {
    const spec = tool.toolSpec;
    const schema = spec?.inputSchema?.json;
    if (!spec?.name || typeof schema !== 'object' || schema === null) {
      throw new Error('The Anthropic adapter needs a name and a JSON schema for every tool');
    }
    return { name: spec.name, description: spec.description, input_schema: schema as Anthropic.Tool.InputSchema };
  });
  const choice = input.toolConfig?.toolChoice;
  const forcedTool = choice?.tool?.name;
  return {
    model: input.modelId,
    max_tokens: maxTokens,
    ...(input.system?.length
      ? { system: input.system.map((block) => textOf(block, 'the system prompt')).join('\n') }
      : {}),
    messages,
    ...(tools.length > 0 ? { tools } : {}),
    ...(forcedTool
      ? { tool_choice: { type: 'tool', name: forcedTool } }
      : choice?.any
        ? { tool_choice: { type: 'any' } }
        : {}),
  };
}

const STOP_REASONS: Record<NonNullable<Anthropic.Message['stop_reason']>, ConverseStopReason> = {
  end_turn: 'end_turn',
  max_tokens: 'max_tokens',
  stop_sequence: 'stop_sequence',
  tool_use: 'tool_use',
  pause_turn: 'end_turn',
  refusal: 'content_filtered',
  model_context_window_exceeded: 'model_context_window_exceeded',
};

/** Turns a Messages response into the Converse shape lib/ai.ts reads: the tool call, any text, and the token counts. */
export function toConverseOutput(message: Anthropic.Message, latencyMs = 0): ConverseCommandOutput {
  const content: ContentBlock[] = [];
  for (const block of message.content) {
    if (block.type === 'text') content.push({ text: block.text });
    else if (block.type === 'tool_use') {
      content.push({ toolUse: { toolUseId: block.id, name: block.name, input: block.input as never } });
    }
  }
  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;
  return {
    $metadata: {},
    output: { message: { role: 'assistant', content } },
    stopReason: message.stop_reason ? STOP_REASONS[message.stop_reason] : 'end_turn',
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    metrics: { latencyMs },
  };
}

// Most specific class first. The names on the left of lib/ai.ts's retry list are reused, so a busy or slow
// Anthropic API is retried exactly like a busy Bedrock, and a refused request (bad key, unknown model) is not.
const ERROR_NAMES: [new (...args: never[]) => Error, string][] = [
  [Anthropic.APIConnectionTimeoutError, 'ModelTimeoutException'],
  [Anthropic.APIConnectionError, 'ServiceUnavailableException'],
  [Anthropic.RateLimitError, 'ThrottlingException'],
  [Anthropic.OverloadedError, 'ServiceUnavailableException'],
  [Anthropic.ServiceUnavailableError, 'ServiceUnavailableException'],
  [Anthropic.GatewayTimeoutError, 'ModelTimeoutException'],
  [Anthropic.RequestTimeoutError, 'ModelTimeoutException'],
  [Anthropic.InternalServerError, 'InternalServerException'],
  [Anthropic.AuthenticationError, 'AnthropicAuthenticationError'],
  [Anthropic.PermissionDeniedError, 'AnthropicPermissionDeniedError'],
  [Anthropic.NotFoundError, 'AnthropicNotFoundError'],
  [Anthropic.BadRequestError, 'AnthropicBadRequestError'],
  [Anthropic.APIError, 'AnthropicApiError'],
];

/** Gives an Anthropic SDK error the name lib/ai.ts decides on. Anything else, and an aborted call, passes through. */
export function toServiceError(error: unknown): unknown {
  if (error instanceof Anthropic.APIUserAbortError) return error;
  const match = ERROR_NAMES.find(([errorClass]) => error instanceof errorClass);
  if (!match) return error;
  const status = (error as { status?: number }).status;
  const message = `The Anthropic API call failed${status ? ` with HTTP ${status}` : ''}`;
  return Object.assign(new Error(message, { cause: error }), { name: match[1] });
}

/**
 * A Converse-shaped function backed by the Anthropic API. `connect` is called for the first plan and its result is
 * kept while this Lambda instance lives. It is called again after a failed connect, and after Anthropic refuses the
 * key, so a key replaced in Parameter Store is picked up without a deploy.
 */
export function createAnthropicConverse(
  connect: () => Promise<SendMessageFn>,
  now: () => number = Date.now,
): ConverseFn {
  let connecting: Promise<SendMessageFn> | undefined;
  return async (input, options) => {
    const body = toMessagesRequest(input);
    connecting ??= connect();
    let send: SendMessageFn;
    try {
      send = await connecting;
    } catch (error) {
      connecting = undefined;
      throw error;
    }
    const started = now();
    try {
      return toConverseOutput(await send(body, { signal: options?.abortSignal }), now() - started);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) connecting = undefined;
      throw toServiceError(error);
    }
  };
}

/**
 * Reads the API key from a SecureString parameter and returns a sender that uses it. The SDK's own retries are
 * off, because lib/ai.ts already retries at most twice (NFR9). `fetch` is replaceable only so tests stay offline.
 */
export function anthropicFromParameterStore(
  parameterName: string,
  options: { fetch?: ClientOptions['fetch'] } = {},
): () => Promise<SendMessageFn> {
  return async () => {
    const result = await new SSMClient({}).send(new GetParameterCommand({ Name: parameterName, WithDecryption: true }));
    const apiKey = result.Parameter?.Value?.trim();
    if (!apiKey) {
      throw Object.assign(new Error(`Parameter ${parameterName} holds no API key`), { name: 'AnthropicKeyMissing' });
    }
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: REQUEST_TIMEOUT_MS, fetch: options.fetch });
    return (body, requestOptions) => client.messages.create(body, { signal: requestOptions?.signal });
  };
}
