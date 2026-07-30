# 음향 특징 추출 Lambda 컨테이너 이미지 (linux/arm64)
#
# 멀티스테이지 빌드로 최종 이미지 크기를 최소화한다:
#   - builder 스테이지: pip 빌드 캐시·wheel 컴파일 산출물을 여기서만 생성
#   - 최종 스테이지: 컴파일된 패키지와 ffmpeg 정적 바이너리만 복사, 빌드 도구 미포함
#
# 반드시 --platform linux/arm64 로 빌드한다 (design.md: AgentCore/Lambda 컨테이너는
# arm64 필수, Apple Silicon 로컬 환경과 아키텍처 일치).

FROM public.ecr.aws/lambda/python:3.12-arm64 AS builder

# 컴파일에 필요한 도구만 builder 스테이지에 설치 (최종 이미지에는 남지 않음)
RUN dnf install -y gcc gcc-c++ make && dnf clean all

COPY requirements.txt .
# --no-cache-dir 로 pip 캐시가 레이어에 남지 않게 하고,
# 컴파일된 패키지를 별도 prefix에 모아 최종 스테이지로만 복사한다.
RUN pip install --no-cache-dir --prefix=/opt/python-deps -r requirements.txt

# ffmpeg 정적 바이너리 다운로드 (arm64용, 컴파일 불필요 — 이미지 크기·빌드 시간 절감)
ARG FFMPEG_RELEASE_URL=https://www.johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz
RUN dnf install -y tar xz && dnf clean all \
    && curl -L -o /tmp/ffmpeg.tar.xz "${FFMPEG_RELEASE_URL}" \
    && mkdir -p /tmp/ffmpeg-extract \
    && tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-extract --strip-components=1 \
    && mkdir -p /opt/ffmpeg-bin \
    && cp /tmp/ffmpeg-extract/ffmpeg /opt/ffmpeg-bin/ffmpeg \
    && rm -rf /tmp/ffmpeg.tar.xz /tmp/ffmpeg-extract

# ---------------------------------------------------------------------------
FROM public.ecr.aws/lambda/python:3.12-arm64

# 컴파일된 파이썬 의존성만 복사 (gcc 등 빌드 도구는 포함되지 않음)
COPY --from=builder /opt/python-deps/lib/python3.12/site-packages ${LAMBDA_TASK_ROOT}
# ffmpeg 정적 바이너리 복사
COPY --from=builder /opt/ffmpeg-bin/ffmpeg /opt/ffmpeg/ffmpeg
ENV FFMPEG_BIN=/opt/ffmpeg/ffmpeg

COPY handler.py features.py ${LAMBDA_TASK_ROOT}/

CMD ["handler.lambda_handler"]
