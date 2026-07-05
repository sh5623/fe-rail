#!/usr/bin/env bash
# [fe-rail] setup-notifier.sh — notify.sh 활성화 도우미
# 실행: bash hooks/scripts/setup-notifier.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(dirname "$SCRIPT_DIR")"
NOTIFY_SH="$HOOKS_DIR/notify.sh"

# 대상 프로젝트: 이 스크립트가 어디에 설치돼 있든(마켓플레이스 설치 시 플러그인 자신의
# 경로가 됨) 상관없이, 사용자가 지금 실행한 "자신의 프로젝트"에 설정해야 한다.
# → HOOKS_DIR 기준이 아니라 현재 작업 디렉토리(git 루트) 기준으로 잡는다.
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SETTINGS_FILE="$PROJECT_ROOT/.claude/settings.local.json"

echo "[fe-rail] notify.sh 활성화를 시작합니다..."

# 1. terminal-notifier 설치 확인
if ! command -v terminal-notifier >/dev/null 2>&1 && [ ! -x "/opt/homebrew/bin/terminal-notifier" ]; then
  if command -v brew >/dev/null 2>&1; then
    echo "[fe-rail] terminal-notifier 설치 중..."
    brew install terminal-notifier
  else
    echo "[fe-rail] Homebrew가 없습니다. https://brew.sh 에서 먼저 설치하세요."
    exit 1
  fi
fi

# 2. notify.sh 실행 권한 부여
chmod +x "$NOTIFY_SH"
echo "[fe-rail] hooks/notify.sh 실행 권한 설정 완료"

# 3. .claude/settings.local.json 처리
# command 는 notify.sh 의 실제 물리 경로(절대경로)를 박아 넣는다 — 훅 실행 시점의 CWD 는
# 소비자 프로젝트 루트이지 이 스크립트/notify.sh 가 설치된 플러그인 경로가 아니므로,
# "./hooks/notify.sh" 같은 상대경로는 대부분 존재하지 않는 파일을 가리켜 조용히 실패한다.
mkdir -p "$PROJECT_ROOT/.claude"

if [ ! -f "$SETTINGS_FILE" ]; then
  # 신규 생성
  cat > "$SETTINGS_FILE" << EOF
{
  "hooks": {
    "Notification": [
      {
        "hooks": [
          { "type": "command", "command": "\"$NOTIFY_SH\"", "timeout": 5 }
        ]
      }
    ]
  }
}
EOF
  echo "[fe-rail] .claude/settings.local.json 생성 완료"
elif grep -q '"Notification"' "$SETTINGS_FILE"; then
  echo "[fe-rail] Notification 훅이 이미 등록되어 있습니다. 건너뜁니다."
else
  echo "[fe-rail] .claude/settings.local.json 에 Notification 훅을 수동으로 추가해주세요:"
  echo ""
  echo '  "Notification": ['
  echo '    {'
  echo '      "hooks": ['
  echo "        { \"type\": \"command\", \"command\": \"\\\"$NOTIFY_SH\\\"\", \"timeout\": 5 }"
  echo '      ]'
  echo '    }'
  echo '  ]'
fi

echo ""
echo "[fe-rail] 완료. 설정 반영을 위해 Claude Code를 재시작하세요."
