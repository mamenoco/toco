#!/usr/bin/env node
// 台本（scripts/*.json）から、YouTubeショート用の縦動画を作る
//
//   node make.js scripts/cold-signs.json
//   node make.js scripts/cold-signs.json --motion=still   うさぎを動かさない
//
// できた動画は out/<台本名>.mp4 に保存されます。音は入れていません。
// BGMは、YouTubeアプリでアップロードするときに「サウンドを追加」で付けます。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const W = 1080, H = 1920, FPS = 30;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const STAMPS = path.join(__dirname, '../toco-app/stamps/1788485404090');
const RABBIT_W = 440; // 画面に置くうさぎの幅
const RABBIT_Y = 1130; // うさぎの上端

const HOP = 40; // 跳ねる高さ（px）
const MOTION = (process.argv.find((a) => a.startsWith('--motion=')) || '--motion=hop').split('=')[1];
const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) {
  console.error('台本を指定してください。例: node make.js scripts/cold-signs.json');
  process.exit(1);
}
const script = JSON.parse(fs.readFileSync(file, 'utf8'));
const name = path.basename(file, '.json');
const work = path.join(__dirname, 'out', name);
fs.mkdirSync(work, { recursive: true });

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
const MARK = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦'];

function html(s) {
  const top = {
    hook: `<div class="pill">${esc(s.label || script.title)}</div>`,
    point: `<div class="num">${MARK[s.num]}</div>`,
    tip: `<div class="pill">${esc(s.label)}</div>`,
    care: `<div class="pill care">気をつけたいこと</div>`,
    end: '',
  }[s.type];
  return `<!doctype html><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: ${W}px; height: ${H}px; overflow: hidden;
    font-family: "Hiragino Maru Gothic ProN", "Hiragino Sans", sans-serif;
    background: #fdf3ef; color: #5a4038; position: relative; }
  .frame { position: absolute; inset: 48px; border-radius: 56px; background: #fffaf7;
    border: 6px solid #f3d5cc; }
  .site { position: absolute; top: 110px; width: 100%; text-align: center;
    font-size: 40px; letter-spacing: .12em; color: #c98b7d; }
  .main { position: absolute; top: 200px; left: 90px; right: 90px; height: 900px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; gap: 48px; }
  .pill { background: #f2b8a8; color: #fff; font-size: 44px; padding: 18px 44px; border-radius: 999px; }
  .pill.care { background: #9fb8a0; }
  .num { font-size: 150px; color: #e8907c; line-height: 1; }
  .text { font-size: ${s.type === 'care' ? 64 : 92}px; font-weight: bold; line-height: 1.45; }
  .text mark { background: linear-gradient(transparent 60%, #f9d3c8 60%); color: inherit; }
  .sub { font-size: 46px; line-height: 1.6; color: #8a6c62; background: #fdeee9;
    padding: 28px 44px; border-radius: 28px; }
  .ground { position: absolute; left: 0; right: 0; top: ${RABBIT_Y + 560}px; height: 8px; }
  </style>
  <div class="frame"></div>
  <div class="site">tocoとくらし</div>
  <div class="main">
    ${top}
    <div class="text">${esc(s.text)}</div>
    ${s.sub ? `<div class="sub">${esc(s.sub)}</div>` : ''}
  </div>`;
}

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });

const clips = script.slides.map((s, i) => {
  const n = String(i + 1).padStart(2, '0');
  const htmlPath = path.join(work, `${n}.html`);
  const png = path.join(work, `${n}.png`);
  const clip = path.join(work, `${n}.mp4`);
  fs.writeFileSync(htmlPath, html(s));
  run(CHROME, ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${W},${H}`, `--screenshot=${png}`, 'file://' + htmlPath]);

  // うさぎはコマ送りのスタンプから1コマだけ取り出し、1枚の絵として重ねる
  const rabbit = path.join(work, `rabbit-${s.rabbit || '01'}.png`);
  if (!fs.existsSync(rabbit)) {
    run('ffmpeg', ['-y', '-i', path.join(STAMPS, `${s.rabbit || '01'}.png`), '-frames:v', '1',
      '-vf', `scale=${RABBIT_W}:-1:flags=lanczos`, rabbit]);
  }
  // hop: 出てきたときに一度だけ小さく跳ねて、あとは止まる／still: 動かさない
  const y = MOTION === 'hop'
    ? `${RABBIT_Y}-if(between(t\\,0.2\\,0.6)\\,${HOP}*sin(PI*(t-0.2)/0.4)\\,0)`
    : String(RABBIT_Y);
  const fade = 0.3;
  run('ffmpeg', ['-y', '-loop', '1', '-t', String(s.sec), '-i', png,
    '-loop', '1', '-t', String(s.sec), '-i', rabbit,
    '-filter_complex',
    `[0:v][1:v]overlay=x=(W-w)/2:y='${y}':eval=frame:shortest=1,fps=${FPS},format=yuv420p,` +
    `fade=t=in:st=0:d=${fade}:color=0xfdf3ef[v]`,
    '-map', '[v]', '-t', String(s.sec), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', clip]);
  console.log(`${n} ${s.text.replace(/\n/g, '')}`);
  return clip;
});

const list = path.join(work, 'list.txt');
fs.writeFileSync(list, clips.map((c) => `file '${c}'`).join('\n'));
const out = path.join(__dirname, 'out', `${name}${MOTION === 'hop' ? '' : '-' + MOTION}.mp4`);
run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
const total = script.slides.reduce((a, s) => a + s.sec, 0);
console.log(`\nできました: ${out}（${total}秒）`);
