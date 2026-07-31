/**
 * 웹 스택 (WagandaWebStack)
 *
 * - Next.js Lambda (DockerImageFunction, ARM64) + Function URL
 * - CloudFront 배포 — 기본 동작은 **Lambda Function URL 오리진**(OAC 서명)
 * - 정적 자산 S3 + OAC, 미디어 S3 + OAC
 * - 경로별 캐시 정책 분리 (`/_next/static/*`, `/media/*`, 공개 페이지, `/api/*`·`/record`)
 * - Route53 A/AAAA 별칭 (호스팅 존 ID 가 컨텍스트로 주어질 때만)
 *
 * ## 순환 의존을 피하는 방식
 * DataStack 의 construct 객체를 직접 참조하지 않고 `resourceNames()` 규약에 따른
 * **이름 기반 임포트**(`fromBucketName`, `fromRepositoryName`)를 쓴다.
 * 미디어 버킷은 다른 스택 소유이므로 이 스택에서 정책을 변경할 수 없다 —
 * CloudFront 읽기 허용 정책은 DataStack 안에서 계정 범위 조건(`AWS:SourceAccount`)으로
 * 부여한다. 그래야 배포 ARN 을 크로스 스택으로 넘기지 않아 순환이 생기지 않는다.
 *
 * ## 인증서
 * CloudFront 는 us-east-1 인증서만 받는다. 이 스택은 배포 리전에 있으므로
 * `certificateArn` 컨텍스트로 us-east-1 인증서 ARN 을 주입받는다.
 * 주어지지 않으면 사용자 지정 도메인 없이(CloudFront 기본 도메인) 합성한다 —
 * 계정·인증서 없이도 `cdk synth` 가 성공해야 하기 때문이다.
 *
 * ## 정적 자산 업로드
 * `BucketDeployment` 는 synth 시 자산 번들링을 유발하므로 쓰지 않는다.
 * 배포 파이프라인(.github/workflows/deploy.yml)이 `aws s3 sync` 로 올리는 것을 전제한다.
 */
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfront_origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53_targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { EnvironmentConfig, resourceNames } from './env';

export interface WebStackProps extends StackProps {
  envConfig: EnvironmentConfig;
  /** 호스팅 존 ID (컨텍스트 주입, 없으면 DNS 레코드를 만들지 않는다) */
  hostedZoneId?: string;
  /** us-east-1 ACM 인증서 ARN (컨텍스트 주입, 없으면 기본 도메인만 사용) */
  certificateArn?: string;
  /**
   * CloudFront 배포 ID (컨텍스트 주입).
   *
   * 이 스택이 만드는 배포의 ID 를 그대로 Lambda 환경변수에 넣으면
   * `Function → Distribution → FunctionUrl → Function` 으로 CloudFormation 순환이 생긴다.
   * 그래서 1차 배포로 배포 ID 를 확정한 뒤, 2차 배포에서 리터럴로 주입한다.
   * 없으면 캐시 무효화는 no-op 이다(`lib/cache/invalidate.ts`).
   */
  cloudFrontDistributionId?: string;
  /** AgentCore Runtime ARN (PipelineStack 배포 후 컨텍스트로 주입) */
  agentRuntimeArn?: string;
  /**
   * Bedrock 애플리케이션 추론 프로파일 ARN (DataStack 배포 후 컨텍스트로 주입).
   * ARN 에 임의 ID 가 붙어 예측할 수 없으므로 이름 기반 참조가 불가능하다.
   */
  bedrockModelProfileArn?: string;
}

export class WagandaWebStack extends Stack {
  public readonly cloudFrontDistribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const {
      envConfig,
      hostedZoneId,
      certificateArn,
      cloudFrontDistributionId,
      agentRuntimeArn,
      bedrockModelProfileArn,
    } = props;
    const names = resourceNames(envConfig);

    // ── Next.js Lambda (컨테이너, ARM64) ──────────────────────────────
    // 이미지는 CI 가 ECR 에 푸시한다. 이름 기반 임포트로 크로스 스택 참조를 만들지 않는다.
    const webRepo = ecr.Repository.fromRepositoryName(this, 'WebRepoRef', names.ecr.web);

    // CI 는 커밋 SHA 를 태그로 넘긴다. 로컬 배포는 `latest` 로 떨어진다.
    const imageTag = process.env.WAGANDA_IMAGE_TAG || 'latest';

    // NextJS Lambda IAM Role — 최소 권한 (lib/config.ts, lib/db/**, lib/upload/** 기반)
    // 권한: DynamoDB 읽기/쓰기, S3 미디어 읽기/쓰기, SSM 파라미터 읽기, KMS 복호화,
    //      CloudFront 무효화, AgentCore 호출
    const nextjsLambdaRole = new iam.Role(this, 'NextjsLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // DynamoDB 테이블 + GSI1 읽기/쓰기
    // (lib/db/repository.ts에서 Query, UpdateItem, PutItem 사용)
    nextjsLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'DynamoDBAccess',
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:Query',
          'dynamodb:Scan',
        ],
        resources: [
          `arn:aws:dynamodb:${envConfig.region}:${this.account}:table/${names.table}`,
          `arn:aws:dynamodb:${envConfig.region}:${this.account}:table/${names.table}/index/*`,
        ],
      }),
    );

    // S3 미디어 버킷 읽기/쓰기
    // (lib/upload/presign.ts에서 GetObject, PutObject 사용)
    nextjsLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'S3MediaBucketAccess',
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: [`arn:aws:s3:::${names.mediaBucket}/*`],
      }),
    );

    // SSM Parameter Store 읽기 (lib/config.ts에서 GetParameters 사용)
    // 경로: /waganda/<env>/google/*, /waganda/<env>/auth/*
    nextjsLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SSMParameterRead',
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${envConfig.region}:${this.account}:parameter/waganda/${envConfig.env}/*`,
        ],
      }),
    );

    // KMS 복호화 (SSM SecureString 파라미터 복호화)
    nextjsLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'KMSDecrypt',
        actions: ['kms:Decrypt'],
        resources: [`arn:aws:kms:${envConfig.region}:${this.account}:alias/aws/ssm`],
      }),
    );

    // CloudFront CreateInvalidation (lib/cache/invalidate.ts에서 사용)
    // 자신의 배포 ARN 범위로만 제한
    nextjsLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'CloudFrontInvalidate',
        actions: ['cloudfront:CreateInvalidation'],
        resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
      }),
    );

    // Bedrock 모델 호출 — 웹 라우트가 직접 부르는 경로가 있다
    // (`lib/agent/labelDirect.ts`·`labelEnrich.ts`·`sommelierDirect.ts`).
    // 온디맨드 모델 ID 는 거부되므로 추론 프로파일로 호출하며, 프로파일과
    // 프로파일이 라우팅하는 파운데이션 모델 양쪽에 권한이 필요하다.
    // `global.*` 프로파일은 리전 경계를 넘어 라우팅하므로 모델 ARN 의 리전을 제한하지 않는다.
    nextjsLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockInference',
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:Converse',
          'bedrock:ConverseStream',
        ],
        resources: [
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:${envConfig.region}:${this.account}:inference-profile/*`,
          `arn:aws:bedrock:${envConfig.region}:${this.account}:application-inference-profile/*`,
        ],
      }),
    );

    // AgentCore InvokeAgentRuntime (lib/agent/client.ts에서 사용)
    // 실제 Runtime ARN 은 `arn:aws:bedrock-agentcore:<region>:<account>:runtime/<name>-<id>` 형태다
    // (`arn:aws:bedrock:...:agent-runtime/*` 가 아니다 — 서비스 네임스페이스가 다르다).
    // 호출은 런타임 자체와 그 엔드포인트 모두를 대상으로 하므로 둘 다 허용한다.
    nextjsLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockAgentCoreInvoke',
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [
          `arn:aws:bedrock-agentcore:${envConfig.region}:${this.account}:runtime/*`,
          `arn:aws:bedrock-agentcore:${envConfig.region}:${this.account}:runtime/*/runtime-endpoint/*`,
        ],
      }),
    );

    const nextjsLambda = new lambda.DockerImageFunction(this, 'NextjsLambda', {
      functionName: `waganda-web-${envConfig.resourceSuffix}`,
      // 이미지 태그를 고정 `latest` 로 두면 새 이미지를 푸시해도 CloudFormation 이 변경을
      // 감지하지 못해 Lambda 가 예전 이미지를 계속 쓴다. CI 는 커밋 SHA 를 태그로 넘긴다.
      code: lambda.DockerImageCode.fromEcr(webRepo, { tagOrDigest: imageTag }),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(30),
      role: nextjsLambdaRole,
      environment: {
        WAGANDA_ENV: envConfig.env,
        WAGANDA_TABLE_NAME: names.table,
        WAGANDA_MEDIA_BUCKET: names.mediaBucket,
        APP_BASE_URL: `https://${envConfig.domain}`,
        // 아래 둘은 다른 리소스의 물리 ID 라 순환을 피하려고 컨텍스트로 주입한다.
        // 주어지지 않으면 키 자체를 넣지 않는다(앱은 미설정을 허용한다).
        ...(cloudFrontDistributionId
          ? { WAGANDA_CF_DISTRIBUTION_ID: cloudFrontDistributionId }
          : {}),
        ...(agentRuntimeArn ? { WAGANDA_AGENT_RUNTIME_ARN: agentRuntimeArn } : {}),
        // Bedrock 직접 호출에 쓸 모델 — 추론 프로파일 ARN 을 넣는다.
        // 없으면 코드 기본값(`global.*` 시스템 프로파일)으로 호출되어 태그 귀속이 안 된다.
        ...(bedrockModelProfileArn ? { WAGANDA_BEDROCK_MODEL_ID: bedrockModelProfileArn } : {}),
      },
    });

    // Function URL — 공개하지 않고 CloudFront(OAC)만 서명 호출할 수 있게 AWS_IAM 을 쓴다.
    const functionUrl = nextjsLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    // ── S3 버킷 ───────────────────────────────────────────────────────
    const staticBucket = new s3.Bucket(this, 'StaticAssetsBucket', {
      bucketName: names.staticBucket,
      removalPolicy: envConfig.removalPolicy,
      autoDeleteObjects: envConfig.removalPolicy === RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
    });

    // 미디어 버킷은 DataStack 소유 — 이름으로만 임포트한다(정책은 DataStack 에서 부여).
    const mediaBucket = s3.Bucket.fromBucketName(this, 'MediaBucketRef', names.mediaBucket);

    // ── OAC ──────────────────────────────────────────────────────────
    const s3Oac = new cloudfront.S3OriginAccessControl(this, 'S3Oac', {
      originAccessControlName: `waganda-s3-oac-${envConfig.resourceSuffix}`,
    });
    const lambdaOac = new cloudfront.FunctionUrlOriginAccessControl(this, 'LambdaOac', {
      originAccessControlName: `waganda-lambda-oac-${envConfig.resourceSuffix}`,
    });

    // ── 캐시 정책 ─────────────────────────────────────────────────────
    const cacheNextStatic = new cloudfront.CachePolicy(this, 'CacheNextStatic', {
      cachePolicyName: `waganda-next-static-${envConfig.resourceSuffix}`,
      comment: '/_next/static/* — 1년 immutable',
      defaultTtl: Duration.days(365),
      maxTtl: Duration.days(365),
      minTtl: Duration.days(365),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const cacheMedia = new cloudfront.CachePolicy(this, 'CacheMedia', {
      cachePolicyName: `waganda-media-${envConfig.resourceSuffix}`,
      comment: '/media/* — 장기 캐시',
      defaultTtl: Duration.days(30),
      maxTtl: Duration.days(365),
      minTtl: Duration.days(1),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const cachePublicPages = new cloudfront.CachePolicy(this, 'CachePublicPages', {
      cachePolicyName: `waganda-public-${envConfig.resourceSuffix}`,
      comment: '공개 페이지 — 장기 캐시, 쓰기 시 무효화',
      defaultTtl: Duration.days(7),
      maxTtl: Duration.days(30),
      minTtl: Duration.minutes(1),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
      // App Router 의 클라이언트 라우팅(soft navigation)은 같은 경로에 `RSC: 1` 헤더와
      // `?_rsc=` 쿼리를 붙여 **RSC payload**(`text/x-component`)를 요청한다.
      // 이 둘을 캐시 키에 넣지 않으면 캐시된 HTML 이 RSC 요청에 반환되어
      // 클라이언트가 응답을 해석하지 못하고 **빈 화면**이 된다. 캐시가 살아있는 동안
      // 뒤로가기도 같은 잘못된 응답을 받고, 새로고침(hard navigation)만 정상 동작한다.
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('RSC', 'Next-Router-Prefetch'),
    });

    // 동적 경로(API·기록 화면)는 쿠키·헤더·쿼리를 그대로 오리진에 전달해야 한다.
    //
    // 관리형 `ALL_VIEWER_EXCEPT_HOST_HEADER` 는 host 만 제외하므로 **Authorization 을 전달한다.**
    // Function URL 오리진은 OAC 가 SigV4 서명을 Authorization 헤더에 넣기 때문에
    // 뷰어 Authorization 이 전달 대상에 포함되면 서명이 깨져 403 Forbidden 이 된다(실제로 겪었다).
    // 그래서 host·authorization 두 개만 제외하는 정책을 직접 만든다.
    // 세션은 쿠키 기반이므로 Authorization 을 오리진에 넘길 필요가 없다.
    const originRequestDynamic = new cloudfront.OriginRequestPolicy(this, 'OriginRequestDynamic', {
      originRequestPolicyName: `waganda-dynamic-${envConfig.resourceSuffix}`,
      comment: 'host·authorization 제외 전체 전달 (Function URL OAC 서명 보호)',
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.denyList('host', 'authorization'),
    });

    // ── 오리진 ────────────────────────────────────────────────────────
    const lambdaOrigin = cloudfront_origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl, {
      originAccessControl: lambdaOac,
    });
    const staticOrigin = cloudfront_origins.S3BucketOrigin.withOriginAccessControl(staticBucket, {
      originAccessControl: s3Oac,
    });
    // 미디어 키 프리픽스는 lib/upload/presign.ts 의 규약(labels/·recordings/)을 따른다.
    //
    // CloudFront 는 요청 경로를 **그대로** S3 키로 쓴다. 그래서 `/media/labels/x.jpg` 는
    // `media/labels/x.jpg` 를 찾고, 실제 키는 `labels/x.jpg` 라 빗나간다.
    // (객체가 없을 때 s3:ListBucket 권한이 없으면 S3 는 404 가 아니라 **403 AccessDenied**
    //  를 반환해 권한 문제로 오해하기 쉽다 — 실제로 라벨 사진이 깨져 보였다.)
    //
    // 그래서 오리진 요청 직전에 `/media` 접두어를 벗긴다. CloudFront Function 은
    // 호출당 과금이고 무료 티어가 커서 상시 비용이 없다.
    const stripMediaPrefix = new cloudfront.Function(this, 'StripMediaPrefix', {
      functionName: `waganda-strip-media-prefix-${envConfig.resourceSuffix}`,
      comment: '/media/<key> → <key> (S3 키 규약과 일치시킨다)',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  if (request.uri.indexOf('/media/') === 0) {
    request.uri = request.uri.substring('/media'.length);
  }
  return request;
}
      `),
    });

    const mediaOrigin = cloudfront_origins.S3BucketOrigin.withOriginAccessControl(mediaBucket, {
      originAccessControl: s3Oac,
    });

    const dynamicBehavior: cloudfront.BehaviorOptions = {
      origin: lambdaOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: originRequestDynamic,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      compress: true,
    };

    // ── 배포 ─────────────────────────────────────────────────────────
    this.cloudFrontDistribution = new cloudfront.Distribution(this, 'CloudFrontDist', {
      comment: `Waganda ${envConfig.env}`,
      defaultBehavior: {
        origin: lambdaOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cachePublicPages,
        originRequestPolicy: originRequestDynamic,
        compress: true,
      },
      additionalBehaviors: {
        '/_next/static/*': {
          origin: staticOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cacheNextStatic,
          compress: true,
        },
        '/media/*': {
          origin: mediaOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cacheMedia,
          compress: true,
          // 오리진에 보내기 전에 `/media` 접두어를 벗긴다(위 stripMediaPrefix 주석 참조).
          functionAssociations: [
            {
              function: stripMediaPrefix,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
        '/api/*': dynamicBehavior,
        '/record': dynamicBehavior,
      },
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      enableIpv6: true,
      ...(certificateArn
        ? {
            domainNames: [envConfig.domain],
            certificate: acm.Certificate.fromCertificateArn(this, 'Certificate', certificateArn),
          }
        : {}),
    });

    // CloudFront(OAC)가 Function URL 을 호출할 수 있게 권한을 보강한다.
    //
    // 2025-10 이후 만들어진 Function URL 은 `lambda:InvokeFunctionUrl` **과**
    // `lambda:InvokeFunction` 을 모두 요구한다. CDK 의 `withOriginAccessControl` 은
    // 앞쪽만 부여하므로, 이것만으로는 CloudFront 경유 요청이 전부
    // 403 `AccessDeniedException` 이 된다(실제로 겪었다. 직접 SigV4 호출은 200 이었다).
    // Permission 은 Function 을 참조하고 Function 은 Permission 을 참조하지 않으므로
    // 배포 ARN 을 sourceArn 으로 넘겨도 순환 의존은 생기지 않는다.
    nextjsLambda.addPermission('AllowCloudFrontInvokeFunction', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: this.cloudFrontDistribution.distributionArn,
    });

    // ── DNS ──────────────────────────────────────────────────────────
    // 위임된 자식 존(`waganda.yanbert.com`)이 준비된 뒤에만 레코드를 만든다.
    if (hostedZoneId) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId,
        zoneName: envConfig.domain,
      });
      const target = route53.RecordTarget.fromAlias(
        new route53_targets.CloudFrontTarget(this.cloudFrontDistribution),
      );
      new route53.ARecord(this, 'ARecord', { zone, target });
      new route53.AaaaRecord(this, 'AaaaRecord', { zone, target });
    }

    // ── 출력 ─────────────────────────────────────────────────────────
    // 배포 ID 는 2차 배포에서 `-c cloudFrontDistributionId=...` 로 되돌려 주입한다.
    new CfnOutput(this, 'CloudFrontDistributionIdOutput', {
      value: this.cloudFrontDistribution.distributionId,
      description: 'CloudFront distribution id (재배포 시 컨텍스트로 주입)',
    });
    new CfnOutput(this, 'CloudFrontDomainNameOutput', {
      value: this.cloudFrontDistribution.distributionDomainName,
      description: 'CloudFront default domain name',
    });
    new CfnOutput(this, 'StaticAssetsBucketOutput', {
      value: staticBucket.bucketName,
      description: '정적 자산 버킷 (aws s3 sync 대상)',
    });
  }
}
