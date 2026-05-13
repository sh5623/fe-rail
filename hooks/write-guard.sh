#!/bin/bash
# [fe-rail] write-guard.sh — PreToolUse:Write
# 민감한 파일 생성을 차단합니다. exit 2 = 도구 실행 차단.
# .env.example 은 허용됩니다.

# 파일 경로 추출: TOOL_INPUT_FILE_PATH 우선, fallback으로 TOOL_INPUT JSON 파싱
FILE_PATH="${TOOL_INPUT_FILE_PATH}"
if [ -z "$FILE_PATH" ] && [ -n "$TOOL_INPUT" ]; then
  FILE_PATH=$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
              | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

[ -z "$FILE_PATH" ] && exit 0

BASENAME=$(basename "$FILE_PATH")

case "$BASENAME" in
  # .env 계열 — .env.example 은 제외되므로 통과
  .env|.env.local|.env.production|.env.staging|.env.development|.env.test|.env.*.local)
    echo "[fe-rail] BLOCKED: .env 파일 직접 생성 금지. .env.example 만 허용됩니다."
    exit 2
    ;;
  # 인증서·키 파일
  *.pem|*.key|*.p12|*.pfx|*.crt|*.cer)
    echo "[fe-rail] BLOCKED: 인증서/키 파일 생성 금지."
    exit 2
    ;;
  # 자격증명 파일
  credentials.json|secrets.json)
    echo "[fe-rail] BLOCKED: 자격증명 파일 생성 금지."
    exit 2
    ;;
  *secret*|*credential*)
    echo "[fe-rail] BLOCKED: 자격증명 파일 생성 금지 (파일명에 secret/credential 포함)."
    exit 2
    ;;
esac

exit 0
