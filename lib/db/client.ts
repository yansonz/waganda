import { DynamoDBClient, type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getRuntimeConfig } from '@/lib/config';

/**
 * DynamoDB Document Client — lazy singleton.
 *
 * - 앱 전역에서 하나의 커넥션 풀을 재사용한다 (Lambda 콜드스타트 최소화).
 * - `marshall` 옵션 `removeUndefinedValues: true` — Zod optional 필드가
 *   `undefined`로 남아 있어도 DynamoDB 로 그대로 보내지 않고 속성 자체를 제거한다.
 * - 테스트에서는 `setDocClient()`로 스텁을 주입하고, `resetDocClient()`로 되돌린다.
 */

let docClient: DynamoDBDocumentClient | undefined;

/** 실제 DynamoDB 호출용 클라이언트를 최초 접근 시점에 생성한다 */
function createDocClient(): DynamoDBDocumentClient {
  const { region } = getRuntimeConfig();
  const clientConfig: DynamoDBClientConfig = { region };

  // E2E 테스트나 로컬 개발용 DynamoDB Local 엔드포인트 오버라이드.
  // WAGANDA_DDB_ENDPOINT 환경변수가 있을 때만 endpoint를 설정하고,
  // 프로덕션 기동에는 영향을 주지 않는다 (환경변수가 없으면 AWS 기본값 사용).
  const ddbEndpoint = process.env.WAGANDA_DDB_ENDPOINT;
  if (ddbEndpoint) {
    clientConfig.endpoint = ddbEndpoint;
    /*
     * 로컬 DynamoDB 는 자격증명을 검사하지 않는다. 더미 값을 **이 클라이언트에만** 준다.
     * 환경변수(AWS_ACCESS_KEY_ID)로 더미 키를 넣으면 같은 프로세스의 다른 AWS 호출
     * (예: Bedrock 라벨 인식)까지 그 키를 쓰게 되어 인증이 깨진다.
     */
    clientConfig.credentials = { accessKeyId: 'local', secretAccessKey: 'local' };
  }

  const baseClient = new DynamoDBClient(clientConfig);

  // 연결 자체가 실패한 경우(주로 로컬에서 DynamoDB Local 이 안 떠 있을 때)
  // 원본 오류(`connect ECONNREFUSED 127.0.0.1:9000`)만으로는 원인을 알기 어렵다.
  // 조치 방법을 포함한 메시지로 감싸 되던진다. 원본은 `cause` 로 보존한다.
  baseClient.middlewareStack.add(
    (next) => async (args) => {
      try {
        return await next(args);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
          const hint = ddbEndpoint
            ? `로컬 DynamoDB(${ddbEndpoint})에 연결할 수 없습니다. \`npm run db:up\` 으로 기동하세요.`
            : 'DynamoDB 에 연결할 수 없습니다. 리전·자격증명·네트워크 설정을 확인하세요.';
          throw new Error(hint, { cause: error });
        }
        throw error;
      }
    },
    { step: 'finalizeRequest', name: 'wagandaConnectionHint' },
  );

  return DynamoDBDocumentClient.from(baseClient, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertClassInstanceToMap: true,
    },
    unmarshallOptions: {
      wrapNumbers: false,
    },
  });
}

/** 싱글턴 Document Client 조회. 없으면 생성한다 */
export function getDocClient(): DynamoDBDocumentClient {
  docClient ??= createDocClient();
  return docClient;
}

/** 테스트 전용 — send()를 스텁으로 교체한 클라이언트를 주입한다 */
export function setDocClient(client: DynamoDBDocumentClient): void {
  docClient = client;
}

/** 테스트 전용 — 주입한 스텁을 해제하고 다음 접근 시 실제 클라이언트를 재생성하게 한다 */
export function resetDocClient(): void {
  docClient = undefined;
}
