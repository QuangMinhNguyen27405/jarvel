// Builds the CDK app from context values: `stage` (staging | prod), `alertEmail` (required), `aiProvider`
// (bedrock | anthropic), `modelId` and `mapReferers` (the pages that may use the maps key).
//   npx cdk deploy -c stage=staging -c alertEmail=you@example.com
import { App } from 'aws-cdk-lib';
import { z } from 'zod';
import {
  AI_PROVIDERS,
  DEPLOY_REGION,
  JarvelStack,
  MAP_REFERER_PATTERN,
  MAX_MAP_REFERERS,
  STAGES,
  type AiProvider,
} from './jarvel-stack.js';

/** Default model on Amazon Bedrock: Claude Haiku 4.5 through the US cross-Region inference profile. */
export const DEFAULT_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
/** Default model on the Anthropic API: Claude Sonnet 5.5. Keep it the same as the backend's default. */
export const DEFAULT_ANTHROPIC_MODEL_ID = 'claude-sonnet-5-5';

const DEFAULT_MODEL_IDS: Record<AiProvider, string> = {
  bedrock: DEFAULT_MODEL_ID,
  anthropic: DEFAULT_ANTHROPIC_MODEL_ID,
};

const contextSchema = z.strictObject({
  stage: z.enum(STAGES, { error: `stage must be one of: ${STAGES.join(', ')}` }),
  alertEmail: z.email({ error: 'alertEmail must be an email address (cdk ... -c alertEmail=you@example.com)' }),
  aiProvider: z.enum(AI_PROVIDERS, { error: `aiProvider must be one of: ${AI_PROVIDERS.join(', ')}` }),
  modelId: z
    .string()
    .regex(/^[A-Za-z0-9.:-]+$/, { error: 'modelId must be a model id (letters, digits, dots, colons and hyphens)' })
    .optional(),
  mapReferers: z
    .array(
      z.string().regex(MAP_REFERER_PATTERN, {
        error: 'each mapReferers entry must be an address pattern without spaces, for example https://example.com/*',
      }),
    )
    .min(1, { error: 'mapReferers must name at least one page' })
    .max(MAX_MAP_REFERERS, { error: `mapReferers can name at most ${MAX_MAP_REFERERS} pages` })
    .optional(),
  modelInputPricePerMTok: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  modelOutputPricePerMTok: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
});

function contextString(app: App, key: string): string | undefined {
  const value: unknown = app.node.tryGetContext(key);
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

/** A list from the context: an array in cdk.json, or one value with spaces between the entries on the command line. */
function contextList(app: App, key: string): string[] | undefined {
  const value: unknown = app.node.tryGetContext(key);
  if (value === undefined || value === null || value === '') return undefined;
  return Array.isArray(value) ? value.map(String) : String(value).trim().split(/\s+/);
}

/** Reads and checks the context, failing fast with every problem named, then adds the stack for that stage. */
export function createApp(app: App = new App()): { app: App; stack: JarvelStack } {
  const parsed = contextSchema.safeParse({
    stage: contextString(app, 'stage'),
    alertEmail: contextString(app, 'alertEmail'),
    aiProvider: contextString(app, 'aiProvider') ?? 'bedrock',
    modelId: contextString(app, 'modelId'),
    mapReferers: contextList(app, 'mapReferers'),
    modelInputPricePerMTok: contextString(app, 'modelInputPricePerMTok'),
    modelOutputPricePerMTok: contextString(app, 'modelOutputPricePerMTok'),
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid CDK context:\n  ${problems.join('\n  ')}`);
  }
  const { stage, alertEmail, aiProvider, mapReferers, modelInputPricePerMTok, modelOutputPricePerMTok } = parsed.data;
  const modelId = parsed.data.modelId ?? DEFAULT_MODEL_IDS[aiProvider];
  // A Bedrock id sent to the Anthropic API (or the other way round) fails every plan, so it is refused here.
  if ((aiProvider === 'anthropic') !== /^claude-[a-z0-9-]+$/.test(modelId)) {
    throw new Error(
      `Invalid CDK context: modelId ${modelId} is not a model id for aiProvider ${aiProvider}. ` +
        `Use an id like ${DEFAULT_MODEL_IDS[aiProvider]}, or leave modelId out for the default.`,
    );
  }
  if ((modelInputPricePerMTok === undefined) !== (modelOutputPricePerMTok === undefined)) {
    throw new Error('Invalid CDK context: give both modelInputPricePerMTok and modelOutputPricePerMTok, or neither.');
  }
  const stack = new JarvelStack(app, `Jarvel-${stage}`, {
    stage,
    alertEmail,
    aiProvider,
    modelId,
    mapReferers,
    modelPrices:
      modelInputPricePerMTok && modelOutputPricePerMTok
        ? { inputPerMTok: modelInputPricePerMTok, outputPerMTok: modelOutputPricePerMTok }
        : undefined,
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: DEPLOY_REGION },
    description: `Jarvel Boston trip planner API (${stage})`,
    tags: { project: 'jarvel', stage },
  });
  return { app, stack };
}
