// Builds the CDK app from context values: `stage` (staging | prod), `alertEmail` (required) and `modelId`.
//   npx cdk deploy -c stage=staging -c alertEmail=you@example.com
import { App } from 'aws-cdk-lib';
import { z } from 'zod';
import { DEPLOY_REGION, JarvelStack, STAGES } from './jarvel-stack.js';

export const DEFAULT_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const contextSchema = z.strictObject({
  stage: z.enum(STAGES, { error: `stage must be one of: ${STAGES.join(', ')}` }),
  alertEmail: z.email({ error: 'alertEmail must be an email address (cdk ... -c alertEmail=you@example.com)' }),
  modelId: z.string().regex(/^[A-Za-z0-9.:-]+$/, { error: 'modelId must be a Bedrock model or inference profile id' }),
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

/** Reads and checks the context, failing fast with every problem named, then adds the stack for that stage. */
export function createApp(app: App = new App()): { app: App; stack: JarvelStack } {
  const parsed = contextSchema.safeParse({
    stage: contextString(app, 'stage'),
    alertEmail: contextString(app, 'alertEmail'),
    modelId: contextString(app, 'modelId') ?? DEFAULT_MODEL_ID,
    modelInputPricePerMTok: contextString(app, 'modelInputPricePerMTok'),
    modelOutputPricePerMTok: contextString(app, 'modelOutputPricePerMTok'),
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid CDK context:\n  ${problems.join('\n  ')}`);
  }
  const { stage, alertEmail, modelId, modelInputPricePerMTok, modelOutputPricePerMTok } = parsed.data;
  if ((modelInputPricePerMTok === undefined) !== (modelOutputPricePerMTok === undefined)) {
    throw new Error('Invalid CDK context: give both modelInputPricePerMTok and modelOutputPricePerMTok, or neither.');
  }
  const stack = new JarvelStack(app, `Jarvel-${stage}`, {
    stage,
    alertEmail,
    modelId,
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
