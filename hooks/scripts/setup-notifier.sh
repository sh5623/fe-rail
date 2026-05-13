#!/usr/bin/env bash
# [fe-rail] setup-notifier.sh — notify.sh 활성화 도우미
# 실행: bash hooks/scripts/setup-notifier.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$HOOKS_DIR")"
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
chmod +x "$HOOKS_DIR/notify.sh"
echo "[fe-rail] hooks/notify.sh 실행 권한 설정 완료"

# 3. .claude/settings.local.json 처리
mkdir -p "$PROJECT_ROOT/.claude"

NOTIFY_ENTRY='{
      "hooks": {
        "Notification": [
          {
            "hooks": [
              { "type": "command", "command": "bash ./hooks/notify.sh", "timeout": 5 }
            ]
          }
        ]
      }
    }'

if [ ! -f "$SETTINGS_FILE" ]; then
  # 신규 생성
  cat > "$SETTINGS_FILE" << 'EOF'
{
  "hooks": {
    "Notification": [
      {
        "hooks": [
          { "type": "command", "command": "bash ./hooks/notify.sh", "timeout": 5 }
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
  echo '        { "type": "command", "command": "bash ./hooks/notify.sh", "timeout": 5 }'
  echo '      ]'
  echo '    }'
  echo '  ]'
fi

echo ""
echo "[fe-rail] 완료. 설정 반영을 위해 Claude Code를 재시작하세요."
