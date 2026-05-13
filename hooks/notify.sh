#!/bin/bash
# [fe-rail] notify.sh — Notification (옵션)
# macOS terminal-notifier 배너 알림. setup-notifier.sh 로 활성화.

TITLE="fe-rail"
MESSAGE="${CLAUDE_NOTIFICATION_TITLE:-확인이 필요합니다}"

NOTIFIER=$(command -v terminal-notifier 2>/dev/null || echo "/opt/homebrew/bin/terminal-notifier")

if [ -x "$NOTIFIER" ]; then
  "$NOTIFIER" -title "$TITLE" -message "$MESSAGE" -sound Glass
fi

# 터미널 벨 fallback
echo -e "\a"

exit 0
