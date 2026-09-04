// fal.ai で画像を作る（アイキャッチ用）
//
// 動画の lib/fal.js と同じ仕組み（キューに投げて、できるまで待つ）ですが、
// 出来上がりが画像なので別ファイルにしています。APIキーは同じものを使います。
//
//   1. POST https://queue.fal.run/<モデルID>   … 依頼を出す
//   2. GET  status_url                          … できたか確認する
//   3. GET  response_url                        … 画像のURLを受け取る

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const QUEUE = 'https://queue.fal.run';

// モデルは fal 側で入れ替わります。合わなくなったら https://fal.ai/models で確認してください。
// 商品画像を参照して作るときのモデル。
// 参照した商品の形をそのまま残したまま、周りの場面だけを作り替えてくれます。
// 1枚あたりの費用は文章だけの生成より高めです（数十倍）。
const REFERENCE_MODEL = 'fal-ai/flux-pro/kontext';

const MODELS = [
  { id: 'fal-ai/flux/schnell', label: 'FLUX schnell（速い・安い）',
    note: '10秒ほど。下書きや量産に向いています' },
  { id: 'fal-ai/flux/dev', label: 'FLUX dev（きれい）',
    note: '30秒ほど。仕上がり重視のとき' },
  { id: 'fal-ai/recraft-v3', label: 'Recraft V3（イラスト向き）',
    note: '水彩やフラットなイラストが得意' },
];

// サイトの世界観に合わせる指定。設定画面から変えられます。
const DEFAULT_STYLE = 'soft watercolor illustration, warm cream and dusty pink palette, '
  + 'delicate botanical accents, gentle natural light, calm and clean composition, '
  + 'no text, no letters, no watermark';

// 動物を出さないための指定。
// 画像生成AIは「〜を描かない」という指示をあまり守れないので、
// 「静物」「物だけ」という肯定形で寄せるほうが効きます。それでも確実ではありません。
const NO_ANIMALS = 'still life of objects only, empty scene without any animals or people';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function headers(key, json) {
  const h = { Authorization: `Key ${key}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function readJson(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch (e) { return { _raw: t }; }
}

function findImageUrl(out) {
  if (!out || typeof out !== 'object') return null;
  if (Array.isArray(out.images) && out.images[0] && out.images[0].url) return out.images[0].url;
  if (out.image && out.image.url) return out.image.url;
  if (typeof out.image_url === 'string') return out.image_url;
  for (const v of Object.values(out)) {
    const found = findImageUrl(v);
    if (found) return found;
  }
  return null;
}

// 依頼を出してから画像を受け取るまで
async function generate(key, opts) {
  const o = opts || {};
  if (!key) throw new Error('fal.ai のAPIキーが設定されていません。設定画面で登録してください。');
  const model = o.model || MODELS[0].id;
  const subject = String(o.prompt || '').trim();
  if (!subject) throw new Error('どんな絵にするかを書いてください');

  const style = String(o.style || DEFAULT_STYLE).trim();
  const parts = [subject, o.noAnimals === false ? '' : NO_ANIMALS, style].filter(Boolean);
  const prompt = parts.join('. ');

  // 商品画像を渡されたら、その形を保ったまま場面を作り替えるモデルに切り替えます
  const useRef = !!o.referenceDataUri;
  const model2 = useRef ? REFERENCE_MODEL : model;

  // 1200×630 に近い比率で作り、あとで正確に切り抜きます
  const input = useRef
    ? { prompt, image_url: o.referenceDataUri, aspect_ratio: '16:9' }
    : { prompt, image_size: { width: 1216, height: 640 }, num_images: 1, enable_safety_checker: true };

  const sub = await fetch(`${QUEUE}/${model2}`, {
    method: 'POST', headers: headers(key, true), body: JSON.stringify(input),
  });
  const subJson = await readJson(sub);
  if (!sub.ok) {
    throw new Error(explain(sub.status, subJson));
  }

  const statusUrl = subJson.status_url;
  const responseUrl = subJson.response_url;
  if (!statusUrl) throw new Error('fal.ai からの応答を読み取れませんでした');

  // できるまで待つ（上限5分）
  const deadline = Date.now() + 5 * 60 * 1000;
  let wait = 2000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('5分たっても画像ができませんでした');
    await sleep(wait);
    wait = Math.min(5000, wait + 1000);
    const st = await fetch(statusUrl, { headers: headers(key) });
    const stJson = await readJson(st);
    if (stJson.status === 'COMPLETED') break;
    if (stJson.status === 'FAILED' || st.status >= 400) {
      throw new Error(explain(st.status, stJson));
    }
  }

  const res = await fetch(responseUrl, { headers: headers(key) });
  const out = await readJson(res);
  const url = findImageUrl(out);
  if (!url) throw new Error('画像のURLが見つかりませんでした');

  const img = await fetch(url);
  if (!img.ok) throw new Error(`画像のダウンロードに失敗しました（${img.status}）`);
  return { buffer: Buffer.from(await img.arrayBuffer()), prompt, model: model2, usedReference: useRef };
}

// エラーを、何をすればいいか分かる日本語にする
function explain(code, json) {
  const msg = (json && (json.detail || json.message || json.error)) || '';
  const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
  if (code === 401 || code === 403) {
    return 'fal.ai の認証に失敗しました。設定画面のAPIキーを確認してください。';
  }
  if (code === 402) return 'fal.ai の残高が不足しています。';
  if (code === 404) return `モデルが見つかりませんでした（${text}）。fal.ai 側で入れ替わった可能性があります。`;
  if (/safety|nsfw/i.test(text)) return '内容が安全フィルタに引っかかりました。書き方を変えてお試しください。';
  return `fal.ai でエラーが出ました（${code}）：${text.slice(0, 200)}`;
}

// 1200×630 に切り抜いて保存する
function saveAs(buffer, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  try {
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85',
      '-z', '630', '1200', file], { stdio: 'ignore' });
  } catch (e) { /* sips が無い環境ではそのまま使う */ }
  return fs.statSync(file).size;
}

// ローカルの画像を fal に渡せる形にする
function toDataUri(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext];
  if (!mime) throw new Error('参照できるのは png / jpg / webp です');
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

module.exports = {
  MODELS, DEFAULT_STYLE, NO_ANIMALS, REFERENCE_MODEL,
  generate, saveAs, findImageUrl, toDataUri,
};
