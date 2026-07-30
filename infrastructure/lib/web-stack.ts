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
import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfront_origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ecr from 'aws-cdk-lib/aws-ecr';
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
}

export class WagandaWebStack extends Stack {
  public readonly cloudFrontDistribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const { envConfig, hostedZoneId, certificateArn } = props;
    const names = resourceNames(envConfig);

    // ── Next.js Lambda (컨테이너, ARM64) ──────────────────────────────
    // 이미지는 CI 가 ECR 에 푸시한다. 이름 기반 임포트로 크로스 스택 참조를 만들지 않는다.
    const webRepo = ecr.Repository.fromRepositoryName(this, 'WebRepoRef', names.ecr.web);

    const nextjsLambda = new lambda.DockerImageFunction(this, 'NextjsLambda', {
      functionName: `waganda-web-${envConfig.resourceSuffix}`,
      code: lambda.DockerImageCode.fromEcr(webRepo, { tagOrDigest: 'latest' }),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(30),
      environment: {
        WAGANDA_ENV: envConfig.env,
        WAGANDA_TABLE_NAME: names.table,
        WAGANDA_MEDIA_BUCKET: names.mediaBucket,
        APP_BASE_URL: `https://${envConfig.domain}`,
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
    });

    // 동적 경로(API·기록 화면)는 쿠키·헤더·쿼리를 그대로 오리진에 전달해야 한다.
    // Host 헤더는 Function URL 서명과 충돌하므로 제외되는 관리형 정책을 쓴다.
    const originRequestDynamic = cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER;

    // ── 오리진 ────────────────────────────────────────────────────────
    const lambdaOrigin = cloudfront_origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl, {
      originAccessControl: lambdaOac,
    });
    const staticOrigin = cloudfront_origins.S3BucketOrigin.withOriginAccessControl(staticBucket, {
      originAccessControl: s3Oac,
    });
    // 미디어 키 프리픽스는 lib/upload/presign.ts 의 규약(recordings/ 등)을 따른다.
    // `/media/*` 요청은 CloudFront 함수 없이 그대로 버킷 루트에 매핑한다.
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
  }
}
