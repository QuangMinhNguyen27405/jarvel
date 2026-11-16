// One Jarvel environment (D13): sign-in, the HTTP API, the two Lambdas, the plan table, alarms and the budget.
// Deployed once per stage (`staging`, `prod`) into us-east-1, a US Region (NFR6).
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { CorsHttpMethod, HttpApi, HttpMethod, HttpNoneAuthorizer, HttpStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { AccountRecovery, UserPool } from 'aws-cdk-lib/aws-cognito';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

export const STAGES = ['staging', 'prod'] as const;
export type StageName = (typeof STAGES)[number];

/** Where PlannerFn sends its one AI call: Amazon Bedrock, or the Anthropic API with a key from Parameter Store. */
export const AI_PROVIDERS = ['bedrock', 'anthropic'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/**
 * The SecureString parameter that holds a stage's Anthropic API key. The stack does not create it and never sees
 * its value: the admin stores the key there by hand, encrypted with the account's default `aws/ssm` key.
 */
export function anthropicKeyParameterName(stage: StageName): string {
  return `/jarvel/${stage}/anthropic-api-key`;
}

/** The Region every stage is deployed to (NFR6: personal data stays in a US Region). */
export const DEPLOY_REGION = 'us-east-1';
/** Regions a `us.` cross-Region inference profile may route a Bedrock call to. */
export const INFERENCE_PROFILE_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2'] as const;
export const MONTHLY_BUDGET_USD = 25;
export const BUDGET_ALERT_USD = 20;
export const API_RATE_LIMIT = 5;
export const API_BURST_LIMIT = 10;

export interface JarvelStackProps extends StackProps {
  stage: StageName;
  /** Which AI service PlannerFn calls (AI_PROVIDER). */
  aiProvider: AiProvider;
  /** Model used by PlannerFn (MODEL_ID): a Bedrock model or `us.` inference profile id, or an Anthropic API model id. */
  modelId: string;
  /** Address that receives the alarm and budget emails. */
  alertEmail: string;
  /** Optional price overrides in USD per million tokens, for a model other than the default. */
  modelPrices?: { inputPerMTok: string; outputPerMTok: string };
}

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BACKEND_HANDLERS = fileURLToPath(new URL('../../backend/src/handlers/', import.meta.url));

/** Splits a model id into the inference profile (if any) and the foundation model it runs. */
export function bedrockModelArns(modelId: string, account: string): string[] {
  const profile = /^(us|global)\.(.+)$/.exec(modelId);
  if (!profile) return [`arn:aws:bedrock:${DEPLOY_REGION}::foundation-model/${modelId}`];
  const foundationModel = profile[2]!;
  return [
    `arn:aws:bedrock:${DEPLOY_REGION}:${account}:inference-profile/${modelId}`,
    ...INFERENCE_PROFILE_REGIONS.map((region) => `arn:aws:bedrock:${region}::foundation-model/${foundationModel}`),
  ];
}

export class JarvelStack extends Stack {
  constructor(scope: Construct, id: string, props: JarvelStackProps) {
    super(scope, id, props);
    const { stage, aiProvider, modelId, alertEmail } = props;
    const anthropicKeyParameter = anthropicKeyParameterName(stage);

    // --- Sign-in (D8): invite-only, email as the username, Cognito's default password policy, 1-hour tokens.
    const userPool = new UserPool(this, 'Users', {
      userPoolName: `jarvel-${stage}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const userPoolClient = userPool.addClient('AppClient', {
      // Travelers sign in with SRP. ADMIN_USER_PASSWORD_AUTH is only callable with the admin's AWS credentials
      // (cognito-idp:AdminInitiateAuth) and lets the post-deploy smoke check get a token from the CLI.
      authFlows: { userSrp: true, adminUserPassword: true },
      // Sign-in is SRP only; CDK's default OAuth (implicit + code flows to a placeholder callback) stays off.
      disableOAuth: true,
      generateSecret: false,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
    });

    // --- Storage: one table, on-demand, TTL on expiresAt, point-in-time recovery, encrypted at rest (NFR4).
    const table = new Table(this, 'Plans', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // --- Lambdas: arm64, Node 22, ESM, every dependency bundled at the versions the tests ran against.
    const common = (name: string): NodejsFunctionProps => ({
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      entry: `${BACKEND_HANDLERS}${name}.ts`,
      handler: 'handler',
      projectRoot: REPO_ROOT,
      depsLockFilePath: `${REPO_ROOT}package-lock.json`,
      logGroup: new LogGroup(this, `${name === 'api' ? 'Api' : 'Planner'}FnLogs`, {
        retention: RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        mainFields: ['module', 'main'],
        externalModules: [],
        minify: true,
        sourceMap: true,
        // Some bundled CommonJS code calls require(); give the ESM bundle one.
        banner: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });

    const plannerFn = new NodejsFunction(this, 'PlannerFn', {
      ...common('planner'),
      description: 'Builds one trip plan (invoked asynchronously by ApiFn).',
      memorySize: 512,
      timeout: Duration.minutes(5),
      retryAttempts: 0,
      environment: {
        TABLE_NAME: table.tableName,
        AI_PROVIDER: aiProvider,
        MODEL_ID: modelId,
        STAGE: stage,
        NODE_OPTIONS: '--enable-source-maps',
        // Only the parameter's name is here. The key itself is read at run time and is never in the template.
        ...(aiProvider === 'anthropic' ? { ANTHROPIC_KEY_PARAMETER: anthropicKeyParameter } : {}),
        ...(props.modelPrices
          ? {
              MODEL_INPUT_PRICE_PER_MTOK: props.modelPrices.inputPerMTok,
              MODEL_OUTPUT_PRICE_PER_MTOK: props.modelPrices.outputPerMTok,
            }
          : {}),
      },
    });

    const apiFn = new NodejsFunction(this, 'ApiFn', {
      ...common('api'),
      description: 'Every HTTP route of the Jarvel API.',
      memorySize: 256,
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: table.tableName,
        PLANNER_FUNCTION_NAME: plannerFn.functionName,
        STAGE: stage,
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    // --- IAM (NFR4): only the actions each function calls, only on this table, this function and this model.
    apiFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'PlanTableReadWrite',
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          // A plan request's writes go in a transaction with a check that the account is not deleted (R-08).
          'dynamodb:ConditionCheckItem',
        ],
        resources: [table.tableArn],
      }),
    );
    apiFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'StartPlanner',
        actions: ['lambda:InvokeFunction'],
        resources: [plannerFn.functionArn],
      }),
    );
    plannerFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'PlanTableReadUpdate',
        actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [table.tableArn],
      }),
    );
    plannerFn.addToRolePolicy(
      aiProvider === 'anthropic'
        ? new PolicyStatement({
            // Reading the one key parameter is all this path needs from AWS. Decrypting it with the default
            // `aws/ssm` key is allowed by that key's own policy for callers that come through Parameter Store.
            sid: 'ReadAnthropicApiKey',
            actions: ['ssm:GetParameter'],
            resources: [`arn:aws:ssm:${DEPLOY_REGION}:${this.account}:parameter${anthropicKeyParameter}`],
          })
        : new PolicyStatement({
            // The Converse API is authorised by bedrock:InvokeModel; there is no separate Converse action.
            sid: 'ConverseWithConfiguredModel',
            actions: ['bedrock:InvokeModel'],
            resources: bedrockModelArns(modelId, this.account),
          }),
    );

    // --- HTTP API (D9): a JWT authorizer on every route except /health, and a stage throttle (NFR3 cost guard).
    const authorizer = new HttpUserPoolAuthorizer('CognitoAuthorizer', userPool, {
      userPoolClients: [userPoolClient],
      identitySource: ['$request.header.Authorization'],
    });
    const httpApi = new HttpApi(this, 'Api', {
      apiName: `jarvel-${stage}`,
      createDefaultStage: false,
      defaultAuthorizer: authorizer,
      // The web app is served from another origin. Requests carry a bearer token, never cookies, so any origin may call.
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PATCH, CorsHttpMethod.DELETE],
        allowHeaders: ['authorization', 'content-type', 'idempotency-key'],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new HttpLambdaIntegration('ApiIntegration', apiFn);
    httpApi.addRoutes({
      path: '/health',
      methods: [HttpMethod.GET],
      integration,
      authorizer: new HttpNoneAuthorizer(), // Deliberately public: returns { status: 'ok' } and no data (AC1.2.4).
    });
    httpApi.addRoutes({ path: '/plans', methods: [HttpMethod.GET, HttpMethod.POST], integration });
    httpApi.addRoutes({
      path: '/plans/{planId}',
      methods: [HttpMethod.GET, HttpMethod.PATCH, HttpMethod.DELETE],
      integration,
    });
    const apiStage = new HttpStage(this, 'DefaultStage', {
      httpApi,
      stageName: '$default',
      autoDeploy: true,
      throttle: { rateLimit: API_RATE_LIMIT, burstLimit: API_BURST_LIMIT },
    });

    // --- Alarms and budget (D12, NFR3, NFR8).
    const alerts = new Topic(this, 'Alerts', { displayName: `Jarvel ${stage} alerts` });
    alerts.addSubscription(new EmailSubscription(alertEmail));
    const notify = new SnsAction(alerts);

    const api5xx = new Alarm(this, 'Api5xxAlarm', {
      alarmDescription: `Jarvel ${stage}: the API answered with a 5xx error.`,
      metric: httpApi.metricServerError({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    api5xx.addAlarmAction(notify);

    const plansFailed = new Alarm(this, 'PlansFailedAlarm', {
      alarmDescription: `Jarvel ${stage}: at least one plan ended FAILED.`,
      metric: new Metric({
        namespace: 'Jarvel',
        metricName: 'PlansFailed',
        dimensionsMap: { Stage: stage },
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    plansFailed.addAlarmAction(notify);

    // The budget covers the whole account's cost, because NFR3's $25 cap covers everything.
    new CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `jarvel-${stage}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: MONTHLY_BUDGET_USD, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: BUDGET_ALERT_USD,
            thresholdType: 'ABSOLUTE_VALUE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: alertEmail }],
        },
      ],
    });

    new CfnOutput(this, 'ApiUrl', { value: apiStage.url });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
