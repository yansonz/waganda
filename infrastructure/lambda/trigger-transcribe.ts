/**
 * trigger-transcribe Lambda
 * 
 * EventBridge 이벤트 (Transcribe Job State Change)를 소비하고 
 * 동일 세션 ID로 AgentCore Runtime 호출 (세션 B)
 * - EventBridge 이벤트 파싱 (status = COMPLETED/FAILED)
 * - Job 상태 업데이트
 * - InvokeAgentRuntime 호출 (세션 A와 동일 sessionId)
 */

import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoDb = new DynamoDBClient({});

interface EventBridgeEvent {
  detail: {
    TranscriptionJobStatus: string;
    TranscriptionJobName: string;
  };
}

// 트랜스크립션 작업명에서 tastingId 추출
function extractTastingIdFromJobName(jobName: string): string | null {
  // 작업명 형식: waganda-tasting-<tastingId>-<recordingId> (결정론적)
  const match = jobName.match(/waganda-tasting-([^-]+)-/);
  return match ? match[1] : null;
}

// 세션 ID 생성 (trigger-upload와 동일)
function generateSessionId(tastingId: string, env: string): string {
  const sessionId = `waganda-tasting-${tastingId}-${env}`;
  
  if (sessionId.length < 33) {
    throw new Error(`Session ID must be at least 33 characters. Generated: ${sessionId.length} chars`);
  }
  
  return sessionId;
}

export async function handler(event: EventBridgeEvent) {
  console.log('trigger-transcribe Lambda invoked', JSON.stringify(event, null, 2));

  const tableName = process.env.TABLE_NAME!;
  const environment = process.env.ENVIRONMENT!;

  try {
    const { TranscriptionJobStatus, TranscriptionJobName } = event.detail;

    // 지원하는 상태만 처리
    if (!['COMPLETED', 'FAILED'].includes(TranscriptionJobStatus)) {
      console.log(`Ignoring Transcription Job status: ${TranscriptionJobStatus}`);
      return;
    }

    // 작업명에서 tastingId 추출
    const tastingId = extractTastingIdFromJobName(TranscriptionJobName);
    if (!tastingId) {
      console.warn(`Could not extract tastingId from job name: ${TranscriptionJobName}`);
      return;
    }

    const sessionId = generateSessionId(tastingId, environment);

    // Job 레코드 조회
    const jobPk = `TASTING#${tastingId}`;
    const jobSk = 'JOB';

    const getResponse = await dynamoDb.send(
      new GetItemCommand({
        TableName: tableName,
        Key: marshall({ pk: jobPk, sk: jobSk }),
      }),
    );

    const jobRecord = getResponse.Item ? unmarshall(getResponse.Item) : null;

    if (!jobRecord) {
      console.warn(`Job record not found for tasting ${tastingId}`);
      return;
    }

    // 상태 업데이트
    let newStatus = 'analyzing';
    if (TranscriptionJobStatus === 'FAILED') {
      newStatus = 'failed';
    }

    await dynamoDb.send(
      new UpdateItemCommand({
        TableName: tableName,
        Key: marshall({ pk: jobPk, sk: jobSk }),
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, #attempts = #attempts + :inc',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#attempts': 'attempts',
        },
        ExpressionAttributeValues: marshall({
          ':status': newStatus,
          ':updatedAt': new Date().toISOString(),
          ':inc': 1,
        }),
      }),
    );

    console.log(`Job status updated to '${newStatus}' for tasting ${tastingId}`);

    // Transcribe 완료/실패에 따라 처리
    if (TranscriptionJobStatus === 'COMPLETED') {
      // AgentCore Runtime 호출 (세션 B)
      // 세션 A와 동일 sessionId로 호출 → S3SessionManager에서 상태 복원
      console.log(`Would invoke AgentCore Runtime (session B) with sessionId: ${sessionId}`);
      // const bedrockClient = new BedrockAgentRuntimeClient({});
      // const response = await bedrockClient.send(
      //   new InvokeAgentCommand({
      //     agentId: process.env.AGENT_ID!,
      //     agentAliasId: process.env.AGENT_ALIAS_ID!,
      //     sessionId, // 세션 A와 동일
      //     inputText: 'map_speakers_and_analyze',
      //   }),
      // );
    } else {
      console.error(`Transcription job failed for tasting ${tastingId}`);
    }

  } catch (error) {
    console.error('Error processing EventBridge event:', error);
    throw error; // 에러 처리
  }

  console.log('trigger-transcribe Lambda completed');
}
