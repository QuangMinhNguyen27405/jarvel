import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp, DEFAULT_ANTHROPIC_MODEL_ID, DEFAULT_MODEL_ID } from '../lib/app.js';
import {
  anthropicKeyParameterName,
  BUDGET_ALERT_USD,
  bedrockModelArns,
  JarvelStack,
  MONTHLY_BUDGET_USD,
} from '../lib/jarvel-stack.js';

// Skip esbuild bundling: these tests check the template, not the Lambda bundles.
const NO_BUNDLING = { 'aws:cdk:bundling-stacks': [] };

function synth(context: Record<string, unknown>): { stack: JarvelStack; template: Template } {
  const { stack } = createApp(new App({ context: { ...NO_BUNDLING, ...context } }));
  return { stack, template: Template.fromStack(stack) };
}

type Statement = { Action: string | string[]; Resource: unknown; Effect: string };

function statements(template: Template): Statement[] {
  return Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
    (policy) =>
      (policy as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties.PolicyDocument.Statement,
  );
}

const asList = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

describe('JarvelStack (staging)', () => {
  let stack: JarvelStack;
  let template: Template;
  beforeAll(() => {
    ({ stack, template } = synth({ stage: 'staging', alertEmail: 'admin@example.com' }));
  });

  it('is deployed to us-east-1, a US Region (NFR6)', () => {
    expect(stack.region).toBe('us-east-1');
    expect(stack.stackName).toBe('Jarvel-staging');
  });

  it('has invite-only sign-in with email usernames and 1-hour tokens (D8, AC1.2.3)', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      UsernameAttributes: ['email'],
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      AccessTokenValidity: 60,
      IdTokenValidity: 60,
      TokenValidityUnits: Match.objectLike({ AccessToken: 'minutes', IdToken: 'minutes' }),
      // No ALLOW_USER_PASSWORD_AUTH: the only password flow besides SRP needs the admin's IAM credentials.
      ExplicitAuthFlows: ['ALLOW_ADMIN_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      GenerateSecret: false,
      PreventUserExistenceErrors: 'ENABLED',
      AllowedOAuthFlows: Match.absent(),
      CallbackURLs: Match.absent(),
    });
  });

  it('puts the JWT authorizer on every route except /health (AC1.2.1, AC1.2.4)', () => {
    const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map(
      (route) => (route as { Properties: { RouteKey: string; AuthorizationType?: string } }).Properties,
    );
    expect(routes.map((route) => route.RouteKey).sort()).toEqual([
      'DELETE /plans/{planId}',
      'GET /health',
      'GET /plans',
      'GET /plans/{planId}',
      'PATCH /plans/{planId}',
      'POST /plans',
    ]);
    for (const route of routes) {
      expect(route.AuthorizationType, route.RouteKey).toBe(route.RouteKey === 'GET /health' ? 'NONE' : 'JWT');
    }
    template.resourceCountIs('AWS::ApiGatewayV2::Authorizer', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', { AuthorizerType: 'JWT' });
  });

  it('throttles the stage to 5 requests per second', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      AutoDeploy: true,
      DefaultRouteSettings: { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 },
    });
  });

  it('has an on-demand table with TTL, point-in-time recovery and encryption (NFR4)', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      SSESpecification: { SSEEnabled: true },
    });
  });

  it('runs both functions on arm64 Node 22 with 2-week logs; the planner has 5 minutes and no async retry', () => {
    template.allResourcesProperties('AWS::Lambda::Function', { Architectures: ['arm64'], Runtime: 'nodejs22.x' });
    template.allResourcesProperties('AWS::Logs::LogGroup', { RetentionInDays: 14 });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 300,
      Environment: {
        Variables: Match.objectLike({
          AI_PROVIDER: 'bedrock',
          MODEL_ID: DEFAULT_MODEL_ID,
          STAGE: 'staging',
          ANTHROPIC_KEY_PARAMETER: Match.absent(),
        }),
      },
    });
    template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', { MaximumRetryAttempts: 0 });
  });

  it('never grants a * resource for DynamoDB, Bedrock or Lambda actions (NFR4)', () => {
    const data = statements(template).filter((statement) =>
      asList(statement.Action).some((action) => /^(dynamodb|bedrock|lambda):/.test(action)),
    );
    expect(data.length).toBeGreaterThanOrEqual(4);
    for (const statement of data) {
      expect(asList(statement.Action).every((action) => !action.includes('*'))).toBe(true);
      expect(asList(statement.Resource)).not.toContain('*');
      expect(JSON.stringify(statement.Resource)).not.toMatch(/"\*"|:\*"/);
    }
  });

  it('gives only the API function the condition check on the plan table, and nothing else new (R-08)', () => {
    const withCheck = statements(template).filter((statement) =>
      asList(statement.Action).includes('dynamodb:ConditionCheckItem'),
    );
    expect(withCheck).toHaveLength(1);
    const [statement] = withCheck;
    expect(asList(statement!.Action).sort()).toEqual([
      'dynamodb:ConditionCheckItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ]);
    const [tableId] = Object.keys(template.findResources('AWS::DynamoDB::Table'));
    expect(asList(statement!.Resource)).toEqual([{ 'Fn::GetAtt': [tableId, 'Arn'] }]);
  });

  it('lets the planner call only the configured Bedrock model and its inference-profile Regions', () => {
    const bedrock = statements(template).find((statement) => asList(statement.Action).includes('bedrock:InvokeModel'))!;
    const resources = JSON.stringify(bedrock.Resource);
    expect(resources).toContain('inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0');
    for (const region of ['us-east-1', 'us-east-2', 'us-west-2']) {
      expect(resources).toContain(
        `arn:aws:bedrock:${region}::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
      );
    }
  });

  it('alarms on API 5xx and on PlansFailed, both to the alert topic (NFR8, AC6.5.3)', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 2);
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: '5xx',
      Namespace: 'AWS/ApiGateway',
      Threshold: 1,
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'PlansFailed',
      Namespace: 'Jarvel',
      Dimensions: [{ Name: 'Stage', Value: 'staging' }],
      AlarmActions: [Match.objectLike({ Ref: Match.stringLikeRegexp('Alerts') })],
    });
    template.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'admin@example.com' });
  });

  it('has a $25 monthly budget that emails at $20 actual spend (NFR3, AC6.5.2)', () => {
    expect([MONTHLY_BUDGET_USD, BUDGET_ALERT_USD]).toEqual([25, 20]);
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: { BudgetLimit: { Amount: 25, Unit: 'USD' }, BudgetType: 'COST', TimeUnit: 'MONTHLY' },
      NotificationsWithSubscribers: [
        {
          Notification: { NotificationType: 'ACTUAL', Threshold: 20, ThresholdType: 'ABSOLUTE_VALUE' },
          Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'admin@example.com' }],
        },
      ],
    });
  });

  it('outputs the API URL, user pool, client and table name', () => {
    for (const name of ['ApiUrl', 'UserPoolId', 'UserPoolClientId', 'TableName']) template.hasOutput(name, {});
  });
});

describe('JarvelStack with the Anthropic API (aiProvider=anthropic)', () => {
  let template: Template;
  beforeAll(() => {
    ({ template } = synth({ stage: 'staging', alertEmail: 'admin@example.com', aiProvider: 'anthropic' }));
  });

  it('tells the planner the provider, the Anthropic model and the name of the key parameter, never the key', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 300,
      Environment: {
        Variables: Match.objectLike({
          AI_PROVIDER: 'anthropic',
          MODEL_ID: DEFAULT_ANTHROPIC_MODEL_ID,
          ANTHROPIC_KEY_PARAMETER: '/jarvel/staging/anthropic-api-key',
        }),
      },
    });
    expect(anthropicKeyParameterName('prod')).toBe('/jarvel/prod/anthropic-api-key');
    template.resourceCountIs('AWS::SSM::Parameter', 0);
    expect(JSON.stringify(template.toJSON())).not.toMatch(/sk-ant/);
  });

  it('lets the planner read only that one parameter, and no Bedrock model (NFR4)', () => {
    const all = statements(template);
    expect(all.some((statement) => asList(statement.Action).some((action) => action.startsWith('bedrock:')))).toBe(
      false,
    );
    const ssm = all.filter((statement) => asList(statement.Action).some((action) => action.startsWith('ssm:')));
    expect(ssm).toHaveLength(1);
    expect(asList(ssm[0]!.Action)).toEqual(['ssm:GetParameter']);
    const resource = JSON.stringify(ssm[0]!.Resource);
    expect(resource).toContain('arn:aws:ssm:us-east-1:');
    expect(resource).toContain(':parameter/jarvel/staging/anthropic-api-key');
    expect(resource).not.toContain('*');
    expect(all.some((statement) => asList(statement.Action).some((action) => action.startsWith('kms:')))).toBe(false);
  });
});

describe('context checks', () => {
  it('refuses an unknown provider, and a model id that belongs to the other provider', () => {
    const base = { stage: 'staging', alertEmail: 'admin@example.com' };
    expect(() => synth({ ...base, aiProvider: 'openai' })).toThrow(/aiProvider must be one of: bedrock, anthropic/);
    expect(() => synth({ ...base, aiProvider: 'anthropic', modelId: DEFAULT_MODEL_ID })).toThrow(
      /not a model id for aiProvider anthropic/,
    );
    expect(() => synth({ ...base, modelId: 'claude-haiku-4-5' })).toThrow(/not a model id for aiProvider bedrock/);
    const { template } = synth({ ...base, aiProvider: 'anthropic', modelId: 'claude-haiku-5-5' });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ MODEL_ID: 'claude-haiku-5-5' }) },
    });
  });

  it('fails fast when alertEmail or stage is missing or wrong', () => {
    expect(() => synth({ stage: 'staging' })).toThrow(/alertEmail/);
    expect(() => synth({ stage: 'dev', alertEmail: 'admin@example.com' })).toThrow(
      /stage must be one of: staging, prod/,
    );
    expect(() => synth({ stage: 'prod', alertEmail: 'a@example.com', modelId: 'bad id *' })).toThrow(/modelId/);
    expect(() => synth({ stage: 'prod', alertEmail: 'a@example.com', modelInputPricePerMTok: '3' })).toThrow(
      /or neither/,
    );
  });

  it('builds a prod stack with a chosen model and its prices', () => {
    const { stack, template } = synth({
      stage: 'prod',
      alertEmail: 'a@example.com',
      modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      modelInputPricePerMTok: '3',
      modelOutputPricePerMTok: '15',
    });
    expect(stack.stackName).toBe('Jarvel-prod');
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          MODEL_INPUT_PRICE_PER_MTOK: '3',
          MODEL_OUTPUT_PRICE_PER_MTOK: '15',
          STAGE: 'prod',
        }),
      },
    });
  });

  it('maps a plain model id to its foundation model only', () => {
    expect(bedrockModelArns('anthropic.claude-x', '123')).toEqual([
      'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-x',
    ]);
    expect(bedrockModelArns('us.anthropic.claude-x', '123')).toHaveLength(4);
  });
});
