# ファビコン

`theme-original/assets/images/rabbit-botanical.png`（サイトのメインイラスト）の
顔だけを切り出して作成。背景は白・枠なし。

## ファイル

| ファイル | 用途 | 元 |
|---|---|---|
| `favicon.ico` | 旧ブラウザ・クローラ向け（16/32/48を内包） | 小サイズ版 |
| `icon-16.png` `icon-32.png` `icon-48.png` | ブラウザのタブ | **小サイズ版**（顔を大きめに切る） |
| `icon-180.png` | iOSのホーム画面（apple-touch-icon） | 大サイズ版 |
| `icon-192.png` `icon-512.png` | Androidのホーム画面・PWA | 大サイズ版 |

小サイズだけ切り抜きを変えているのは、16pxでは余白があると耳がつぶれて
うさぎに見えなくなるためです。

## 作り直しかた

```bash
cd toco-app/site/assets/favicon
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cp ../../../../theme-original/assets/images/rabbit-botanical.png rabbit.png
"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --screenshot=large.png --window-size=512,512 "file://$PWD/_source-large.html"
"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --screenshot=small.png --window-size=512,512 "file://$PWD/_source-small.html"
for s in 16 32 48;  do cp small.png icon-$s.png; sips -z $s $s icon-$s.png; done
for s in 180 192;   do cp large.png icon-$s.png; sips -z $s $s icon-$s.png; done
cp large.png icon-512.png
rm rabbit.png large.png small.png
```

`favicon.ico` の組み立ては `lib/build.js` 側で行う（16/32/48のPNGをICOコンテナに入れるだけ）。

## HTMLに入れるタグ

```html
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/assets/favicon/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/assets/favicon/icon-180.png">
```
