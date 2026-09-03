#!/bin/bash
cd "$(dirname "$0")"
export PATH="$HOME/.nvm/versions/node/v22.16.0/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりませんでした。"
  echo "ターミナルで 'node -v' が動くか確認してください。"
  read -n 1 -s
  exit 1
fi
node server.js
