// PlannerFn: invoked asynchronously by ApiFn with { userId, planId } (D2). Builds the plan with lib/planner.ts.
import { z } from 'zod';
import { createBedrockConverse, DEFAULT_MODEL_ID, pricesFromEnv, type ConverseFn } from '../lib/ai.js';
import { anthropicFromParameterStore, createAnthropicConverse, DEFAULT_ANTHROPIC_MODEL_ID } from '../lib/anthropic.js';
import { loadBostonData } from '../lib/data.js';
import { createDocumentClient, requiredEnv } from '../lib/dynamo.js';
import { createLogger, createMetrics } from '../lib/log.js';
import { runPlanner, type PlannerDeps } from '../lib/planner.js';
import { QuotaStore } from '../lib/quota.js';
import { PlanStore } from '../lib/store.js';

const eventSchema = z.strictObject({ userId: z.string().min(1).max(200), planId: z.uuid() });

/**
 * The AI client and model for the configured provider. AI_PROVIDER is `bedrock` (the default) or `anthropic`;
 * the Anthropic path also needs ANTHROPIC_KEY_PARAMETER, the name of the SecureString parameter holding the key.
 */
export function aiFromEnv(env: NodeJS.ProcessEnv = process.env): { converse: ConverseFn; modelId: string } {
  const provider = env.AI_PROVIDER || 'bedrock';
  if (provider === 'bedrock') {
    return { converse: createBedrockConverse(env.AWS_REGION), modelId: env.MODEL_ID || DEFAULT_MODEL_ID };
  }
  if (provider !== 'anthropic') throw new Error(`AI_PROVIDER must be bedrock or anthropic, got ${provider}`);
  const parameterName = env.ANTHROPIC_KEY_PARAMETER;
  if (!parameterName) throw new Error('ANTHROPIC_KEY_PARAMETER is required when AI_PROVIDER is anthropic');
  return {
    converse: createAnthropicConverse(anthropicFromParameterStore(parameterName)),
    modelId: env.MODEL_ID || DEFAULT_ANTHROPIC_MODEL_ID,
  };
}

/** Production wiring from the Lambda environment (TABLE_NAME, AI_PROVIDER, MODEL_ID, STAGE, optional model prices). */
export function defaultPlannerDeps(): PlannerDeps {
  const tableName = requiredEnv('TABLE_NAME');
  const stage = process.env.STAGE ?? 'unknown';
  const doc = createDocumentClient();
  return {
    store: new PlanStore(doc, tableName),
    quota: new QuotaStore(doc, tableName),
    data: loadBostonData(),
    ...aiFromEnv(),
    prices: pricesFromEnv(),
    now: () => new Date(),
    log: createLogger({ service: 'planner', stage }),
    metrics: createMetrics(stage),
  };
}

export function createPlannerHandler(deps: PlannerDeps) {
  return async (event: unknown): Promise<string> => {
    const parsed = eventSchema.safeParse(event);
    if (!parsed.success) {
      deps.log.error('planner invoked with an invalid event', { issues: parsed.error.issues.map((i) => i.message) });
      throw new Error('Invalid planner event');
    }
    return runPlanner(parsed.data, deps);
  };
}

let wired: ((event: unknown) => Promise<string>) | undefined;

export const handler = (event: unknown): Promise<string> => {
  wired ??= createPlannerHandler(defaultPlannerDeps());
  return wired(event);
};
