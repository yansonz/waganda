/**
 * trigger-upload Lambda
 * 
 * SQS에서 오디오 업로드 이벤트를 소비하고 AgentCore Runtime 호출 (세션 A)
 * - SQS 메시지 파싱
 * - Job 상태 확인 및 생성
 * - InvokeAgentRuntime 호출 (세션 ID: waganda-tasting-<tastingId>-<env>)
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';

const dynamoDb = new DynamoDBClient({});
const agentCore = new BedrockAgentCoreClient({});

/** AgentCore 응답 본문(스트림 또는 바이트)을 문자열로 모은다 */
async function readAgentResponse(body: unknown): Promise<string> {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  const maybeStream = body as { transformToString?: () => Promise<string> };
  if (typeof maybeStream.transformToString === 'function') {
    return await maybeStream.transformToString();
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

interface SqsRecord {
  Records: Array<{
    body: string;
    receiptHandle: string;
  }>;
}

interface S3Event {
  Records: Array<{
    s3: {
      bucket: {
        name: string;
      };
      object: {
        key: string;
      };
    };
  }>;
}

// 세션 ID 생성 및 검증
function generateSessionId(tastingId: string, env: string): string {
  // 형식: waganda-tasting-<tastingId>-<env>
  // 33자 이상 보장
  const sessionId = `waganda-tasting-${tastingId}-${env}`;

  /*
   * AgentCore 최소 세션 ID 길이는 33자다. 앱(`lib/agent/client.ts` 의
   * `buildRuntimeSessionId`)은 부족하면 `0` 으로 패딩한다 — 세션 A/B 가 같은 세션을
   * 공유해야 하므로 **여기서도 같은 방식으로** 맞춘다(예전에는 예외를 던져 규칙이 어긋났다).
   */
  return sessionId.length >= 33 ? sessionId : sessionId.padEnd(33, '0');
}

/**
 * 신규 Job 레코드를 만든다.
 *
 * `@waganda/schemas` 의 Job 스키마가 요구하는 필드를 빠짐없이 채운다.
 * type·schemaVersion·rev 가 없으면 에이전트(AgentCore)의 getJob 이 Zod 검증에서
 * 터져 500 을 반환하고, 전사가 시작되지 않은 채 Job 이 'transcribing' 에서
 * 영구히 멈춘다. schemaVersion 은 CURRENT_SCHEMA_VERSION(=2) 과 일치시킨다.
 * (인프라 Lambda 는 스키마 패키지를 번들에 넣지 않으므로 값을 인라인한다 —
 *  대신 test/trigger-upload-job.test.ts 가 실제 Job 스키마로 검증한다.)
 */
export function buildNewJobRecord(tastingId: string): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  return {
    type: 'JOB',
    pk: `TASTING#${tastingId}`,
    sk: 'JOB',
    tastingId,
    status: 'queued',
    completedSteps: [],
    attempts: 0,
    schemaVersion: 2,
    rev: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function handler(event: SqsRecord) {
  console.log('trigger-upload Lambda invoked', JSON.stringify(event, null, 2));

  const tableName = process.env.TABLE_NAME!;
  const environment = process.env.ENVIRONMENT!;

  for (const record of event.Records) {
    try {
      // S3 이벤트 파싱
      const s3Event: S3Event = JSON.parse(record.body);
      const s3Record = s3Event.Records[0];
      
      if (!s3Record) {
        console.warn('No S3 record found in SQS message');
        continue;
      }

      const objectKey = s3Record.s3.object.key;

      /*
       * 키 규약은 `lib/upload/presign.ts` 의 `buildAudioKey` 다:
       *   recordings/<tastingId>/<recordingId>.<format>
       *
       * 예전에는 `audio/tasting-<id>/rec-<id>.mp3` 를 가정해 파싱이 항상 실패했고,
       * 분석이 `queued` 에서 멈춘 채 로그에만 경고가 남았다.
       * 프리픽스와 세그먼트 수를 함께 확인해 형식이 바뀌면 즉시 드러나게 한다.
       */
      const match = objectKey.match(/^recordings\/([^/]+)\/([^/]+)\.[^.]+$/);
      if (!match) {
        console.warn(
          `Could not parse tastingId from key: ${objectKey} ` +
            '(expected recordings/<tastingId>/<recordingId>.<format>)',
        );
        continue;
      }

      const tastingId = match[1];
      const recordingId = match[2];
      console.log(`parsed key: tastingId=${tastingId} recordingId=${recordingId}`);
      const sessionId = generateSessionId(tastingId, environment);

      // Job 레코드 조회 또는 생성
      const jobPk = `TASTING#${tastingId}`;
      const jobSk = 'JOB';

      const getResponse = await dynamoDb.send(
        new GetItemCommand({
          TableName: tableName,
          Key: marshall({ pk: jobPk, sk: jobSk }),
        }),
      );

      let jobRecord = getResponse.Item ? unmarshall(getResponse.Item) : null;

      if (jobRecord && jobRecord.status && ['analyzing', 'completed', 'failed'].includes(jobRecord.status)) {
        console.log(`Job already in progress or completed for tasting ${tastingId}, skipping.`);
        continue;
      }

      // 신규 Job 생성
      if (!jobRecord) {
        jobRecord = buildNewJobRecord(tastingId);

        await dynamoDb.send(
          new PutItemCommand({
            TableName: tableName,
            Item: marshall(jobRecord),
          }),
        );

        console.log(`Created new Job record for tasting ${tastingId}`);
      }

      // Job 상태 업데이트 (queued → transcribing)
      await dynamoDb.send(
        new UpdateItemCommand({
          TableName: tableName,
          Key: marshall({ pk: jobPk, sk: jobSk }),
          UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: marshall({
            ':status': 'transcribing',
            ':updatedAt': new Date().toISOString(),
          }),
        }),
      );

      console.log(`Job status updated to 'transcribing' for tasting ${tastingId}`);

      /*
       * AgentCore Runtime 호출 (세션 A: 전사 시작 → 음향 특징 추출).
       *
       * 예전에는 이 자리에 호출 대신 로그만 남기는 자리표시자가 있었다. job 레코드만 만들고
       * 분석을 시작하지 않아 상태가 `queued`·`transcribing` 에서 영구히 멈췄다.
       *
       * 세션 ID 는 앱(`lib/agent/client.ts`)과 **같은 규칙**으로 만들어야 세션 A/B 가
       * 같은 세션을 공유한다.
       */
      const agentRuntimeArn = process.env.WAGANDA_AGENT_RUNTIME_ARN;
      if (!agentRuntimeArn) {
        throw new Error('설정 누락: WAGANDA_AGENT_RUNTIME_ARN 이 필요합니다.');
      }

      const payload = {
        task: 'analyze_upload' as const,
        tastingId,
        recordingId,
        audioKey: objectKey,
      };

      const invokeResponse = await agentCore.send(
        new InvokeAgentRuntimeCommand({
          agentRuntimeArn,
          runtimeSessionId: sessionId,
          payload: new TextEncoder().encode(JSON.stringify(payload)),
          contentType: 'application/json',
          accept: 'application/json',
        }),
      );

      const responseBody = invokeResponse.response
        ? await readAgentResponse(invokeResponse.response)
        : '';
      console.log(
        `AgentCore invoked: sessionId=${sessionId} response=${responseBody.slice(0, 300)}`,
      );

    } catch (error) {
      console.error('Error processing SQS record:', error);
      throw error; // Lambda 재시도 유도
    }
  }

  console.log('trigger-upload Lambda completed');
}
