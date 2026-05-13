#!/bin/bash
# [fe-rail] lint-fix.sh — PostToolUse:Edit|Write|MultiEdit
# ESLint --fix 후 Prettier --write 자동 적용. 차단 없음(exit 0).

# 파일 경로 추출
FILE_PATH="${TOOL_INPUT_FILE_PATH}"
if [ -z "$FILE_PATH" ] && [ -n "$TOOL_INPUT" ]; then
  FILE_PATH=$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
              | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

[ -z "$FILE_PATH" ] && exit 0
[ ! -f "$FILE_PATH" ] && exit 0

# 확장자 화이트리스트
case "$FILE_PATH" in
  *.js|*.ts|*.jsx|*.tsx|*.mjs|*.cjs|*.vue|*.css|*.scss|*.json) ;;
  *) exit 0 ;;
esac

# 프로젝트 루트 탐색
PROJECT_ROOT=$(git -C "$(dirname "$FILE_PATH")" rev-parse --show-toplevel 2>/dev/null || pwd)

# ── ESLint ──────────────────────────────────────────────────────────────────
ESLINT_BIN=""
if [ -x "$PROJECT_ROOT/node_modules/.bin/eslint" ]; then
  ESLINT_BIN="$PROJECT_ROOT/node_modules/.bin/eslint"
elif command -v npx >/dev/null 2>&1; then
  # config 파일이 하나라도 있으면 npx 사용
  for cfg in .eslintrc.js .eslintrc.json .eslintrc.cjs .eslintrc.yml .eslintrc.yaml \
             eslint.config.js eslint.config.mjs eslint.config.ts; do
    if [ -f "$PROJECT_ROOT/$cfg" ]; then
      ESLINT_BIN="npx eslint"
      break
    fi
  done
fi

if [ -n "$ESLINT_BIN" ]; then
  $ESLINT_BIN --fix --quiet "$FILE_PATH" 2>/dev/null
  REMAINING=$($ESLINT_BIN --quiet "$FILE_PATH" 2>&1)
  if [ -n "$REMAINING" ]; then
    echo "[fe-rail][eslint] $REMAINING" | head -10 >&2
  fi
fi

# ── Prettier ────────────────────────────────────────────────────────────────
PRETTIER_BIN=""
if [ -x "$PROJECT_ROOT/node_modules/.bin/prettier" ]; then
  PRETTIER_BIN="$PROJECT_ROOT/node_modules/.bin/prettier"
elif command -v npx >/dev/null 2>&1; then
  for cfg in .prettierrc .prettierrc.js .prettierrc.json .prettierrc.yml \
             prettier.config.js prettier.config.cjs; do
    if [ -f "$PROJECT_ROOT/$cfg" ]; then
      PRETTIER_BIN="npx prettier"
      break
    fi
  done
fi

if [ -n "$PRETTIER_BIN" ]; then
  $PRETTIER_BIN --write --log-level=silent "$FILE_PATH" 2>/dev/null
fi

exit 0
