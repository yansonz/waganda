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

interface EventBridgeEvent {
  detail: {
    TranscriptionJobStatus: string;
    TranscriptionJobName: string;
  };
}

/**
 * Transcribe 작업명에서 tastingId 를 뽑는다.
 *
 * 생성 규칙은 `agent/src/graph/nodes/startTranscription.ts` 의 `buildTranscribeJobName` 이다:
 *   waganda-<tastingId>-<recordingId>
 *
 * 예전에는 `tasting-` 접두어가 붙은 다른 형식을 기대해 항상 실패했다. 접두어가 다르고
 * tastingId·recordingId 가 UUID(하이픈 포함)라 `[^-]+` 로는 잡히지도 않는다.
 * 두 UUID 를 각각 매칭해 경계를 명확히 한다.
 */
function parseJobName(jobName: string): { tastingId: string; recordingId: string } | null {
  const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  const match = jobName.match(new RegExp(`^waganda-(${uuid})-(${uuid})$`));
  if (!match) return null;
  return { tastingId: match[1], recordingId: match[2] };
}

// 세션 ID 생성 (trigger-upload와 동일)
function generateSessionId(tastingId: string, env: string): string {
  const sessionId = `waganda-tasting-${tastingId}-${env}`;
  
  // 세션 A(trigger-upload)·앱과 같은 규칙으로 패딩해야 같은 세션을 공유한다.
  return sessionId.length >= 33 ? sessionId : sessionId.padEnd(33, '0');
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
    const parsedName = parseJobName(TranscriptionJobName);
    if (!parsedName) {
      console.warn(`Could not parse job name: ${TranscriptionJobName}`);
      return;
    }
    const { tastingId, recordingId } = parsedName;

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

    /*
     * 세션 B 호출 — 세션 A 와 **같은 sessionId** 로 불러 상태를 이어받는다.
     *
     * 예전에는 호출 대신 로그만 남기는 자리표시자여서 전사가 끝나도 분석이 시작되지 않았다.
     * 전사 실패도 에이전트에 알려야 한다 — 실패를 기록하고 사용자에게 상태를 보여줘야
     * 하기 때문이다(무음·대화 없음도 실패가 아니라 정상 결과로 다룬다).
     */
    const agentRuntimeArn = process.env.WAGANDA_AGENT_RUNTIME_ARN;
    if (!agentRuntimeArn) {
      throw new Error('설정 누락: WAGANDA_AGENT_RUNTIME_ARN 이 필요합니다.');
    }

    const payload = {
      task: 'analyze_transcribed' as const,
      tastingId,
      // 작업명에서 이미 뽑았으므로 함께 넘긴다.
      // 없으면 에이전트가 "recordingId 를 확인할 수 없습니다" 로 실패한다.
      recordingId,
      transcribeJobName: TranscriptionJobName,
      transcribeStatus: TranscriptionJobStatus === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
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
      `AgentCore (session B) invoked: sessionId=${sessionId} status=${TranscriptionJobStatus} ` +
        `response=${responseBody.slice(0, 300)}`,
    );

  } catch (error) {
    console.error('Error processing EventBridge event:', error);
    throw error; // 에러 처리
  }

  console.log('trigger-transcribe Lambda completed');
}
