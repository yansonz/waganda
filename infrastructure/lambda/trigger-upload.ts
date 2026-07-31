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

const dynamoDb = new DynamoDBClient({});

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
  
  if (sessionId.length < 33) {
    throw new Error(`Session ID must be at least 33 characters. Generated: ${sessionId.length} chars`);
  }
  
  return sessionId;
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
        jobRecord = {
          pk: jobPk,
          sk: jobSk,
          tastingId,
          status: 'queued',
          completedSteps: [],
          attempts: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

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

      // AgentCore Runtime 호출 (세션 A)
      // 주의: 실제 구현에서는 BedrockAgentRuntime 클라이언트 필요
      // - InvokeAgentRuntime 호출
      // - sessionId: ${sessionId}
      // - agentAliasId: <에이전트 ID>
      // - actionGroupsState: 활성
      // - inputText: "start_transcription" (시작 명령)

      console.log(`Would invoke AgentCore Runtime with sessionId: ${sessionId}`);
      // const bedrockClient = new BedrockAgentRuntimeClient({});
      // const response = await bedrockClient.send(
      //   new InvokeAgentCommand({
      //     agentId: process.env.AGENT_ID!,
      //     agentAliasId: process.env.AGENT_ALIAS_ID!,
      //     sessionId,
      //     inputText: 'start_transcription',
      //   }),
      // );

    } catch (error) {
      console.error('Error processing SQS record:', error);
      throw error; // Lambda 재시도 유도
    }
  }

  console.log('trigger-upload Lambda completed');
}
