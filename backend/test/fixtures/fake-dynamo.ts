// An in-memory stand-in for the single DynamoDB table, wired into aws-sdk-client-mock. It evaluates the small
// expression subset this backend uses (SET/ADD updates; AND/OR conditions, with parentheses, over attribute_exists,
// attribute_not_exists, IN, =, <, <=, >), so conditional writes behave as they do in DynamoDB. TransactWriteItems
// checks every condition first and applies all writes or none, failing with TransactionCanceledException and one
// reason code per write, as DynamoDB does. Queries return items in sort-key order and can be split into pages.
// No AWS call is made.
import { ConditionalCheckFailedException, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { mockClient, type AwsClientStub } from 'aws-sdk-client-mock';

export const TABLE_NAME = 'jarvel-test';

type Item = Record<string, unknown>;
type Names = Record<string, string> | undefined;
type Values = Record<string, unknown> | undefined;

function ccf(): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });
}

const keyOf = (key: Item): string => `${String(key.pk)}|${String(key.sk)}`;
const attr = (token: string, names: Names): string => (token.startsWith('#') ? (names?.[token] ?? token) : token);

function value(token: string, values: Values): unknown {
  if (!token.startsWith(':')) throw new Error(`Fake table only supports placeholder values, got ${token}`);
  return values?.[token];
}

function clause(item: Item | undefined, text: string, names: Names, values: Values): boolean {
  const exists = /^attribute_exists\((.+)\)$/.exec(text);
  if (exists) return item !== undefined && item[attr(exists[1]!, names)] !== undefined;
  const missing = /^attribute_not_exists\((.+)\)$/.exec(text);
  if (missing) return item === undefined || item[attr(missing[1]!, names)] === undefined;
  const inList = /^(\S+) IN \((.+)\)$/.exec(text);
  if (inList) {
    const options = inList[2]!.split(',').map((token) => value(token.trim(), values));
    return item !== undefined && options.includes(item[attr(inList[1]!, names)]);
  }
  const equals = /^(\S+) = (\S+)$/.exec(text);
  if (equals) return item !== undefined && item[attr(equals[1]!, names)] === value(equals[2]!, values);
  const compare = /^(\S+) (<=|<|>) (\S+)$/.exec(text);
  if (compare) {
    const left = item?.[attr(compare[1]!, names)] as number | undefined;
    const right = value(compare[3]!, values) as number;
    if (left === undefined) return false;
    return compare[2] === '<' ? left < right : compare[2] === '<=' ? left <= right : left > right;
  }
  throw new Error(`Fake table cannot evaluate condition clause: ${text}`);
}

/** Splits `text` at each ` OR ` or ` AND ` that is outside parentheses. */
function splitOutside(text: string, word: 'OR' | 'AND'): string[] {
  const separator = ` ${word} `;
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (depth === 0 && text.startsWith(separator, i)) {
      parts.push(text.slice(start, i));
      start = i + separator.length;
      i = start - 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim());
}

/** True when `text` is one parenthesized group, as in `(a OR b)`, rather than `(a) AND (b)`. */
function isWrapped(text: string): boolean {
  if (!text.startsWith('(') || !text.endsWith(')')) return false;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    if (depth === 0) return i === text.length - 1;
  }
  return false;
}

/** Evaluates a condition with DynamoDB's precedence (AND binds tighter than OR) and parenthesized groups. */
function evaluate(item: Item | undefined, text: string, names: Names, values: Values): boolean {
  const alternatives = splitOutside(text, 'OR');
  if (alternatives.length > 1) return alternatives.some((part) => evaluate(item, part, names, values));
  const conjuncts = splitOutside(text, 'AND');
  if (conjuncts.length > 1) return conjuncts.every((part) => evaluate(item, part, names, values));
  const single = text.trim();
  if (isWrapped(single)) return evaluate(item, single.slice(1, -1), names, values);
  return clause(item, single, names, values);
}

function conditionHolds(item: Item | undefined, expression: string | undefined, names: Names, values: Values): boolean {
  if (!expression) return true;
  return evaluate(item, expression, names, values);
}

function applyUpdate(item: Item, expression: string, names: Names, values: Values): void {
  const sections = expression.split(/\b(SET|ADD)\b/).filter((part) => part.trim() !== '');
  for (let i = 0; i < sections.length; i += 2) {
    const kind = sections[i]!.trim();
    const body = sections[i + 1] ?? '';
    for (const assignment of body
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)) {
      if (kind === 'SET') {
        const [left, right] = assignment.split('=').map((part) => part.trim()) as [string, string];
        item[attr(left, names)] = structuredClone(value(right, values));
      } else {
        const [left, right] = assignment.split(/\s+/) as [string, string];
        const name = attr(left, names);
        item[name] = Number(item[name] ?? 0) + Number(value(right, values));
      }
    }
  }
}

/** One write of a transaction, checked before anything is applied. */
interface PendingWrite {
  key: Item;
  condition: string | undefined;
  names: Names;
  values: Values;
  apply: () => void;
}

type TransactItem = NonNullable<TransactWriteCommand['input']['TransactItems']>[number];

export type FakeCommand = 'Put' | 'Get' | 'Update' | 'Delete' | 'Query' | 'BatchWrite' | 'TransactWrite';

export interface FakeTable {
  doc: DynamoDBDocumentClient;
  mock: AwsClientStub<DynamoDBDocumentClient>;
  items: Map<string, Item>;
  get(pk: string, sk: string): Item | undefined;
  put(item: Item): void;
  /** Every item whose attributes mention `text` anywhere (keys or values). */
  itemsMentioning(text: string): Item[];
  /** Makes the next command of this type fail with `error` (once). */
  failNext(command: FakeCommand, error: Error): void;
  /** Splits every query answer into pages of at most `size` items, with LastEvaluatedKey, as DynamoDB can. */
  setQueryPageSize(size: number | undefined): void;
}

export function createFakeTable(): FakeTable {
  const items = new Map<string, Item>();
  const failures = new Map<string, Error>();
  let queryPageSize: number | undefined;

  const updateItem = (key: Item, expression: string, names: Names, values: Values): Item => {
    const existing = items.get(keyOf(key));
    const next: Item = existing ? structuredClone(existing) : { ...key };
    applyUpdate(next, expression, names, values);
    items.set(keyOf(key), next);
    return next;
  };

  const pendingWrite = (entry: TransactItem): PendingWrite => {
    if (entry.Update) {
      const { Key, UpdateExpression, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues } =
        entry.Update;
      return {
        key: Key as Item,
        condition: ConditionExpression,
        names: ExpressionAttributeNames,
        values: ExpressionAttributeValues,
        apply: () =>
          updateItem(Key as Item, UpdateExpression ?? '', ExpressionAttributeNames, ExpressionAttributeValues),
      };
    }
    if (entry.Put) {
      const item = entry.Put.Item as Item;
      return {
        key: item,
        condition: entry.Put.ConditionExpression,
        names: entry.Put.ExpressionAttributeNames,
        values: entry.Put.ExpressionAttributeValues,
        apply: () => items.set(keyOf(item), structuredClone(item)),
      };
    }
    const check = entry.Delete ?? entry.ConditionCheck;
    if (!check) throw new Error('Fake table: empty transaction entry');
    const key = check.Key as Item;
    return {
      key,
      condition: check.ConditionExpression,
      names: check.ExpressionAttributeNames,
      values: check.ExpressionAttributeValues,
      apply: () => (entry.Delete ? items.delete(keyOf(key)) : undefined),
    };
  };
  const mock = mockClient(DynamoDBDocumentClient);
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
  const maybeFail = (name: string) => {
    const error = failures.get(name);
    if (error) {
      failures.delete(name);
      throw error;
    }
  };

  mock.on(PutCommand).callsFake((input: PutCommand['input']) => {
    maybeFail('Put');
    const item = input.Item as Item;
    const existing = items.get(keyOf(item));
    const ok = conditionHolds(
      existing,
      input.ConditionExpression,
      input.ExpressionAttributeNames,
      input.ExpressionAttributeValues,
    );
    if (!ok) throw ccf();
    items.set(keyOf(item), structuredClone(item));
    return {};
  });
  mock.on(GetCommand).callsFake((input: GetCommand['input']) => {
    maybeFail('Get');
    const item = items.get(keyOf(input.Key as Item));
    return { Item: item ? structuredClone(item) : undefined };
  });
  mock.on(UpdateCommand).callsFake((input: UpdateCommand['input']) => {
    maybeFail('Update');
    const key = input.Key as Item;
    const existing = items.get(keyOf(key));
    const names = input.ExpressionAttributeNames;
    const values = input.ExpressionAttributeValues;
    if (!conditionHolds(existing, input.ConditionExpression, names, values)) throw ccf();
    const next = updateItem(key, input.UpdateExpression ?? '', names, values);
    return { Attributes: structuredClone(next) };
  });
  mock.on(TransactWriteCommand).callsFake((input: TransactWriteCommand['input']) => {
    maybeFail('TransactWrite');
    const writes = (input.TransactItems ?? []).map(pendingWrite);
    if (new Set(writes.map((write) => keyOf(write.key))).size !== writes.length) {
      throw Object.assign(new Error('Transaction request cannot include multiple operations on one item'), {
        name: 'ValidationException',
      });
    }
    const codes = writes.map((write) =>
      conditionHolds(items.get(keyOf(write.key)), write.condition, write.names, write.values)
        ? 'None'
        : 'ConditionalCheckFailed',
    );
    if (codes.some((code) => code !== 'None')) {
      throw new TransactionCanceledException({
        message: `Transaction cancelled, please refer cancellation reasons for specific reasons [${codes.join(', ')}]`,
        $metadata: {},
        CancellationReasons: codes.map((Code) => ({ Code })),
      });
    }
    for (const write of writes) write.apply();
    return {};
  });
  mock.on(DeleteCommand).callsFake((input: DeleteCommand['input']) => {
    maybeFail('Delete');
    const key = keyOf(input.Key as Item);
    const old = items.get(key);
    items.delete(key);
    return { Attributes: input.ReturnValues === 'ALL_OLD' ? old : undefined };
  });
  mock.on(QueryCommand).callsFake((input: QueryCommand['input']) => {
    maybeFail('Query');
    const pk = input.ExpressionAttributeValues?.[':pk'];
    const prefix = input.ExpressionAttributeValues?.[':prefix'] as string | undefined;
    const after = input.ExclusiveStartKey?.sk as string | undefined;
    const matches = [...items.values()]
      .filter((item) => item.pk === pk && (prefix === undefined || String(item.sk).startsWith(prefix)))
      .filter((item) => after === undefined || String(item.sk) > after)
      .sort((a, b) => (String(a.sk) < String(b.sk) ? -1 : 1)); // code-unit order, as the `>` above
    const page = queryPageSize === undefined ? matches : matches.slice(0, queryPageSize);
    const last = page.at(-1);
    const more = page.length < matches.length && last !== undefined;
    return {
      Items: page.map((item) => structuredClone(item)),
      LastEvaluatedKey: more ? { pk: last.pk, sk: last.sk } : undefined,
    };
  });
  mock.on(BatchWriteCommand).callsFake((input: BatchWriteCommand['input']) => {
    maybeFail('BatchWrite');
    for (const requests of Object.values(input.RequestItems ?? {})) {
      for (const request of requests) {
        if (request.DeleteRequest?.Key) items.delete(keyOf(request.DeleteRequest.Key as Item));
      }
    }
    return { UnprocessedItems: {} };
  });

  return {
    doc,
    mock,
    items,
    get: (pk, sk) => items.get(`${pk}|${sk}`),
    put: (item) => items.set(keyOf(item), structuredClone(item)),
    itemsMentioning: (text) => [...items.values()].filter((item) => JSON.stringify(item).includes(text)),
    failNext: (command, error) => failures.set(command, error),
    setQueryPageSize: (size) => {
      queryPageSize = size;
    },
  };
}
