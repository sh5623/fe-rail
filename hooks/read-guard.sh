#!/bin/bash
# [fe-rail] read-guard.sh — PreToolUse:Read
# 민감한 파일 읽기 시도를 감지합니다.
# Write로 못 만들어도 Read로 내용을 읽어 유출될 수 있어 경고로 처리합니다.
# 정책: 경고(stderr) + exit 0 — 차단하지 않고 사용자에게 인지시킵니다.

# 파일 경로 추출: TOOL_INPUT_FILE_PATH 우선, fallback으로 TOOL_INPUT JSON 파싱
FILE_PATH="${TOOL_INPUT_FILE_PATH}"
if [ -z "$FILE_PATH" ] && [ -n "$TOOL_INPUT" ]; then
  FILE_PATH=$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
              | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

[ -z "$FILE_PATH" ] && exit 0

BASENAME=$(basename "$FILE_PATH")

case "$BASENAME" in
  # .env 계열 (example 제외)
  .env|.env.local|.env.production|.env.staging|.env.development|.env.test|.env.*.local)
    echo "[fe-rail] ⚠️  WARNING [read-guard]: 민감한 환경변수 파일 읽기 감지 → $FILE_PATH" >&2
    echo "[fe-rail]   이 파일의 내용이 응답에 노출되지 않도록 주의하세요." >&2
    ;;
  # 인증서·키 파일
  *.pem|*.key|*.p12|*.pfx|*.crt|*.cer)
    echo "[fe-rail] ⚠️  WARNING [read-guard]: 인증서/키 파일 읽기 감지 → $FILE_PATH" >&2
    echo "[fe-rail]   민감한 키 내용이 노출될 수 있습니다." >&2
    ;;
  # 자격증명 파일
  credentials.json|secrets.json|*secret*|*credential*)
    echo "[fe-rail] ⚠️  WARNING [read-guard]: 자격증명 파일 읽기 감지 → $FILE_PATH" >&2
    echo "[fe-rail]   민감한 정보가 응답에 포함되지 않도록 주의하세요." >&2
    ;;
esac

exit 0
