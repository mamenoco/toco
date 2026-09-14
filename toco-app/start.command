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

# 前回のアプリが黒い画面から切り離されたまま残っていると、
# 同じ場所（4567番）が使えず、新しく起動できません。
# このフォルダのアプリが残っている場合だけ、先に止めてから起動します。
# ほかのアプリがたまたま同じ番号を使っていても、そちらは止めません。
APP_DIR="$(pwd -P)"
# 1つのアプリが4567番と4569番の両方を使うので、重複をまとめてから見ます
for pid in $(lsof -t -nP -iTCP:4567 -iTCP:4569 -sTCP:LISTEN 2>/dev/null | sort -u); do
  cmd=$(ps -o command= -p "${pid}" 2>/dev/null)
  cwd=$(lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  if [[ "${cmd}" == *"server.js"* && "${cwd}" == "${APP_DIR}" ]]; then
    # 全角のかっこの直前は ${pid} と書くこと。$pid だと、かっこまで変数名として読まれて消えます
    echo "前回のアプリが残っていたので止めます（PID ${pid}）"
    kill "${pid}" 2>/dev/null
  fi
done

# 止まりきるまで少し待ちます
for i in 1 2 3 4 5; do
  lsof -nP -iTCP:4567 -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 1
done
if lsof -nP -iTCP:4567 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "4567番を別のアプリが使っているため、起動できません。"
  echo "心当たりのないアプリを終了してから、もう一度ダブルクリックしてください。"
  read -n 1 -s
  exit 1
fi

node server.js
