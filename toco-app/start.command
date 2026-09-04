#!/bin/bash
cd "$(dirname "$0")"
export PATH="$HOME/.nvm/versions/node/v22.16.0/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
# 日本語がUTF-8で扱われるようにします。ここが空だと記事が文字化けします。
if [ -z "$LANG" ]; then export LANG=ja_JP.UTF-8; fi
export LC_ALL="$LANG"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりませんでした。"
  echo "ターミナルで 'node -v' が動くか確認してください。"
  read -n 1 -s
  exit 1
fi
node server.js
