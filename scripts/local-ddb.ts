/**
 * 로컬 DynamoDB (DynamoDB Local) 기동·정지·시드 헬퍼.
 *
 * `.env.local` 이 `WAGANDA_DDB_ENDPOINT` 를 가리키고 있으면 앱은 이 로컬 DB 로 붙는다.
 * 컨테이너가 없으면 `connect ECONNREFUSED 127.0.0.1:9000` 이 나므로,
 * `npm run dev` 와 E2E 준비 단계가 모두 이 모듈을 거쳐 기동을 보장한다.
 *
 * 사용:
 *   npx tsx scripts/local-ddb.ts up      # 기동 + 테이블 + 시드
 *   npx tsx scripts/local-ddb.ts down    # 정지
 *   npx tsx scripts/local-ddb.ts reset   # 정지 후 재기동 (데이터 초기화)
 */
import { execFileSync } from 'node:child_process';

export const CONTAINER_NAME = 'waganda-local-ddb';
/** 데이터 보존용 named volume — 컨테이너를 지워도 기록이 남는다 */
export const DATA_VOLUME = 'waganda-ddb-data';
export const DDB_PORT = Number(process.env.WAGANDA_DDB_PORT ?? 9000);
export const DDB_ENDPOINT = `http://127.0.0.1:${DDB_PORT}`;
export const TABLE_NAME = process.env.WAGANDA_TABLE_NAME ?? 'waganda-local';

/** E2E 가 쓰던 이전 컨테이너 이름 — 남아 있으면 함께 정리한다 */
const LEGACY_CONTAINER_NAME = 'waganda-e2e-ddb';

function docker(args: string[], quiet = true): string {
  return (
    execFileSync('docker', args, {
      encoding: 'utf8',
      stdio: quiet ? ['ignore', 'pipe', 'ignore'] : 'inherit',
    })?.trim?.() ?? ''
  );
}

function assertDockerAvailable(): void {
  try {
    docker(['version', '--format', '{{.Server.Version}}']);
  } catch {
    throw new Error(
      'Docker 를 사용할 수 없습니다. Docker Desktop 을 실행한 뒤 다시 시도하세요.\n' +
        '로컬 DB 없이 화면만 보려면 `npm run dev:no-db` 를 쓰세요 ' +
        '(데이터 조회 화면은 빈 상태 또는 오류로 표시됩니다).',
    );
  }
}

export function isRunning(name = CONTAINER_NAME): boolean {
  try {
    return docker(['ps', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']) === name;
  } catch {
    return false;
  }
}

/** 이미 다른 프로세스가 포트를 쓰고 있는지 확인 (컨테이너가 아닐 수도 있다) */
async function isPortAnswering(): Promise<boolean> {
  try {
    const res = await fetch(DDB_ENDPOINT);
    return res.status > 0;
  } catch {
    return false;
  }
}

export function startContainer(): void {
  if (isRunning()) {
    console.log(`[local-ddb] 컨테이너(${CONTAINER_NAME}) 재사용`);
    return;
  }
  assertDockerAvailable();

  // 중지 상태로 남은 동명/구명 컨테이너 정리
  for (const name of [CONTAINER_NAME, LEGACY_CONTAINER_NAME]) {
    try {
      docker(['rm', '-f', name]);
    } catch {
      // 없으면 무시
    }
  }

  console.log(`[local-ddb] DynamoDB Local 기동 (포트 ${DDB_PORT})...`);
  /*
   * 데이터를 named volume 에 보관한다.
   * `-inMemory` 로 띄우면 컨테이너를 지울 때 직접 기록한 시음까지 사라진다.
   * 볼륨을 쓰면 `db:down` 후 다시 올려도 기록이 남는다
   * (초기화가 필요하면 `docker volume rm waganda-ddb-data`).
   */
  docker([
    'run',
    '-d',
    '--rm',
    '--name',
    CONTAINER_NAME,
    '-p',
    `${DDB_PORT}:8000`,
    '-v',
    `${DATA_VOLUME}:/data`,
    /*
     * root 로 실행한다 — named volume 은 root 소유로 생성되고,
     * 기본 사용자(dynamodblocal)는 여기에 쓸 수 없어 SQLite 가 DB 파일을 열지 못한다
     * (증상: 포트는 열려 있는데 모든 요청이 무한 대기).
     */
    '-u',
    'root',
    'amazon/dynamodb-local:latest',
    '-jar',
    'DynamoDBLocal.jar',
    '-sharedDb',
    '-dbPath',
    '/data',
  ]);
}

export async function waitForDdb(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // 잘못된 요청에도 HTTP 응답이 오면 준비된 것으로 본다.
    if (await isPortAnswering()) {
      console.log('[local-ddb] 준비 완료');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`[local-ddb] 준비 대기 시간 초과 (${DDB_ENDPOINT})`);
}

export function seed(): void {
  console.log('[local-ddb] 테이블 생성 + 시드 데이터 삽입...');
  execFileSync('npx', ['tsx', 'e2e/fixtures/seed.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WAGANDA_DDB_ENDPOINT: DDB_ENDPOINT,
      WAGANDA_TABLE_NAME: TABLE_NAME,
      // 호출부(E2E 준비 스크립트)가 요청한 초기화 여부를 그대로 전달한다
      ...(process.env.WAGANDA_SEED_RESET ? { WAGANDA_SEED_RESET: process.env.WAGANDA_SEED_RESET } : {}),
      AWS_REGION: process.env.AWS_REGION ?? 'ap-northeast-2',
      AWS_ACCESS_KEY_ID: 'local',
      AWS_SECRET_ACCESS_KEY: 'local',
    },
    stdio: 'inherit',
  });
}

export function stopContainer(): void {
  for (const name of [CONTAINER_NAME, LEGACY_CONTAINER_NAME]) {
    try {
      docker(['rm', '-f', name]);
      console.log(`[local-ddb] 컨테이너(${name}) 정리`);
    } catch {
      // 없으면 무시
    }
  }
}

/** 기동 + 준비 대기 + 시드까지 한 번에 (멱등) */
export async function ensureLocalDdb(): Promise<void> {
  startContainer();
  await waitForDdb();
  seed();
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  switch (command) {
    case 'up':
      await ensureLocalDdb();
      break;
    case 'down':
      stopContainer();
      break;
    case 'reset':
      stopContainer();
      await ensureLocalDdb();
      break;
    default:
      throw new Error(`알 수 없는 명령: ${command} (up | down | reset)`);
  }
}

// 직접 실행된 경우에만 CLI 로 동작한다 (import 시에는 아무것도 하지 않는다)
if (process.argv[1]?.includes('local-ddb')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
