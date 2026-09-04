#!/usr/bin/env node
// ターミナルから fal.ai で動画を作る
//
//   node fal-video.js "草原を走る白いうさぎ、朝の光"
//   node fal-video.js --model fal-ai/kling-video/v2.1/standard/image-to-video --image ./usagi.jpg "ゆっくり振り向く"
//   node fal-video.js --list          使えるモデルの一覧
//
// 鍵は data/secrets.json の falKey、なければ環境変数 FAL_KEY を使います。
// できた動画は videos/ に保存されます。

const path = require('path');
const fal = require('./lib/fal.js');
const DB = require('./lib/db.js');

const args = process.argv.slice(2);
const opt = { model: null, image: null, input: {}, prompt: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--list') {
    fal.PRESETS.forEach((p) => console.log(`${p.id}\n    ${p.label}`));
    process.exit(0);
  } else if (a === '--model' || a === '-m') opt.model = args[++i];
  else if (a === '--image' || a === '-i') opt.image = args[++i];
  else if (a === '--set') { // --set duration=10  のように入力を追加
    const [k, v] = String(args[++i]).split('=');
    opt.input[k] = /^(true|false)$/.test(v) ? v === 'true' : v;
  } else if (a === '--help' || a === '-h') {
    console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(0);
  } else opt.prompt.push(a);
}

const prompt = opt.prompt.join(' ').trim();
if (!prompt) {
  console.error('プロンプト（動画の説明）を書いてください。例: node fal-video.js "草原を走る白いうさぎ"');
  process.exit(1);
}

const key = DB.loadSecrets().falKey || process.env.FAL_KEY;
if (!key) {
  console.error('fal.ai の鍵がありません。アプリの設定画面で入れるか、FAL_KEY=... を付けて実行してください。');
  process.exit(1);
}

const model = opt.model || (opt.image ? fal.PRESETS.find((p) => p.kind === 'image').id : fal.PRESETS[0].id);
const preset = fal.PRESETS.find((p) => p.id === model);
const input = Object.assign({}, preset ? preset.input : {}, { prompt }, opt.input);
if (opt.image) {
  input.image_url = /^https?:\/\//.test(opt.image) ? opt.image : fal.imageToDataUri(path.resolve(opt.image));
}

console.log(`モデル: ${model}`);
console.log(`入力  : ${JSON.stringify(Object.assign({}, input, input.image_url && !/^https?:/.test(input.image_url) ? { image_url: '(画像ファイル)' } : {}))}`);

let last = '';
fal.generate(key, {
  model, input,
  onProgress: (job) => {
    const line = job.status === 'queued' ? `待機中${job.queuePosition != null ? `（前に ${job.queuePosition} 件）` : ''}`
      : job.status === 'running' ? `生成中… ${job.logs.slice(-1)[0] || ''}`
      : job.status === 'downloading' ? 'ダウンロード中…'
      : job.status;
    if (line !== last) { console.log(line); last = line; }
  },
}).then((job) => {
  console.log(`できました: ${job.file}（${Math.round(job.bytes / 1024)} KB）`);
}).catch((e) => {
  console.error('失敗: ' + e.message);
  process.exit(1);
});
