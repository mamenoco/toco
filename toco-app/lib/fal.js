// fal.ai（https://fal.ai/）で動画を生成する
//
// fal の「キュー API」を使います。流れは 3 ステップです。
//   1. POST https://queue.fal.run/<モデルID>          … 依頼を出す（request_id が返る）
//   2. GET  <status_url>                              … できあがるまで数秒おきに様子を見る
//   3. GET  <response_url>                            … 結果（動画のURL）を受け取る
// 受け取った動画は toco-app/videos/ にダウンロードして保存します。
// 鍵は設定画面の「fal.ai」に入れたものを使います（data/secrets.json に保存）。

const fs = require('fs');
const path = require('path');

const QUEUE = 'https://queue.fal.run';
const OUT_DIR = path.join(__dirname, '..', 'videos');

// 画面のプルダウンに出すモデル。id は fal のモデルID、input はそのモデルの既定の入力です。
// モデルの追加・廃止は fal 側で起きるので、合わなくなったら https://fal.ai/models で確認して直してください。
const PRESETS = [
  // MiniMax H3 Max Turbo（fal 版の高速モデル）。duration は秒の整数、resolution は 480P / 768P。
  { id: 'minimax/h3-max-turbo/text-to-video', label: 'MiniMax H3 Max Turbo（文章→動画）', kind: 'text',
    input: { duration: 5, resolution: '768P', aspect_ratio: '16:9', prompt_expansion_mode: 'balanced' } },
  { id: 'minimax/h3-max-turbo/image-to-video', label: 'MiniMax H3 Max Turbo（画像→動画）', kind: 'image',
    input: { duration: 5, resolution: '768P', prompt_expansion_mode: 'balanced' } },
  { id: 'fal-ai/veo3/fast', label: 'Veo 3 Fast（文章→動画・音声つき）', kind: 'text',
    input: { aspect_ratio: '16:9', duration: '8s', generate_audio: true } },
  { id: 'fal-ai/minimax/hailuo-02/standard/text-to-video', label: 'Hailuo 02（文章→動画）', kind: 'text',
    input: { duration: '6' } },
  { id: 'fal-ai/wan/v2.2-a14b/text-to-video', label: 'Wan 2.2（文章→動画・安め）', kind: 'text',
    input: {} },
  { id: 'fal-ai/kling-video/v2.1/standard/image-to-video', label: 'Kling 2.1 Standard（画像→動画）', kind: 'image',
    input: { duration: '5' } },
  { id: 'fal-ai/minimax/hailuo-02/standard/image-to-video', label: 'Hailuo 02（画像→動画）', kind: 'image',
    input: { duration: '6' } },
  { id: 'fal-ai/veo3/fast/image-to-video', label: 'Veo 3 Fast（画像→動画・音声つき）', kind: 'image',
    input: { duration: '8s', generate_audio: true } },
];

// 進行中・終わった依頼。サーバーを止めると消えますが、動画とメモは videos/ に残ります。
const JOBS = {};

function headers(key, json) {
  const h = { Authorization: 'Key ' + key };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function readJson(res) {
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  if (!res.ok) {
    const msg = json.detail
      ? (Array.isArray(json.detail) ? json.detail.map((d) => d.msg || JSON.stringify(d)).join(' / ') : JSON.stringify(json.detail))
      : (json.message || text.slice(0, 300));
    const err = new Error(`fal ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// 1. 依頼を出す
async function submit(key, model, input) {
  const res = await fetch(`${QUEUE}/${model}`, {
    method: 'POST', headers: headers(key, true), body: JSON.stringify(input),
  });
  return readJson(res); // { request_id, status_url, response_url, ... }
}

// 2. 様子を見る
async function status(key, statusUrl) {
  const res = await fetch(statusUrl + (statusUrl.includes('?') ? '&' : '?') + 'logs=1', { headers: headers(key) });
  return readJson(res); // { status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED', queue_position, logs }
}

// 3. 結果を受け取る
async function result(key, responseUrl) {
  const res = await fetch(responseUrl, { headers: headers(key) });
  return readJson(res);
}

// 結果の中から動画のURLを探す。モデルによって video / videos[0] / output など置き場所が違います。
function findVideoUrl(out) {
  if (!out || typeof out !== 'object') return null;
  if (out.video && out.video.url) return out.video.url;
  if (Array.isArray(out.videos) && out.videos[0] && out.videos[0].url) return out.videos[0].url;
  if (out.output && out.output.url) return out.output.url;
  if (typeof out.video_url === 'string') return out.video_url;
  for (const v of Object.values(out)) {
    const found = findVideoUrl(v);
    if (found) return found;
  }
  return null;
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`動画のダウンロードに失敗しました（${res.status}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf.length;
}

// ローカルの画像ファイルを fal に渡せる data URI にする（画像→動画で使う）
function imageToDataUri(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[ext];
  if (!mime) throw new Error('画像は png / jpg / webp / gif を指定してください');
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 依頼から保存までをまとめて行う（CLI・サーバー共通）
// onProgress(job) は状態が変わるたびに呼ばれます。
async function generate(key, { model, input, jobId, onProgress }) {
  if (!key) throw new Error('fal.ai の API キーが設定されていません');
  if (!model) throw new Error('モデルを選んでください');
  const id = jobId || String(Date.now());
  const job = JOBS[id] || (JOBS[id] = {});
  Object.assign(job, {
    id, model, input, status: 'queued', startedAt: Date.now(), queuePosition: null,
    logs: [], file: null, url: null, error: null, requestId: null,
  });
  const tick = () => { if (onProgress) onProgress(job); };

  try {
    const sub = await submit(key, model, input);
    job.requestId = sub.request_id;
    tick();

    // できあがるまで待つ。最初は 3 秒、途中から 5 秒おき。上限 30 分。
    const deadline = Date.now() + 30 * 60 * 1000;
    let wait = 3000;
    while (true) {
      if (Date.now() > deadline) throw new Error('30分たっても終わらなかったので打ち切りました');
      const st = await status(key, sub.status_url);
      if (st.status === 'IN_QUEUE') { job.status = 'queued'; job.queuePosition = st.queue_position ?? null; }
      else if (st.status === 'IN_PROGRESS') { job.status = 'running'; job.queuePosition = null; }
      if (Array.isArray(st.logs) && st.logs.length) {
        job.logs = st.logs.map((l) => (typeof l === 'string' ? l : l.message)).filter(Boolean).slice(-20);
      }
      tick();
      if (st.status === 'COMPLETED') break;
      await sleep(wait);
      wait = 5000;
    }

    const out = await result(key, sub.response_url);
    const url = findVideoUrl(out);
    if (!url) throw new Error('結果に動画が見つかりませんでした: ' + JSON.stringify(out).slice(0, 300));
    job.url = url;
    job.status = 'downloading';
    tick();

    const file = path.join(OUT_DIR, `${id}.mp4`);
    const bytes = await download(url, file);
    job.file = file;
    job.bytes = bytes;
    job.status = 'done';
    job.finishedAt = Date.now();

    // 動画のとなりにメモを残す（あとで一覧に出すため）
    const meta = {
      id, model, prompt: input.prompt || '', input: stripImage(input), url, bytes,
      createdAt: new Date(job.startedAt).toISOString(),
      seconds: Math.round((job.finishedAt - job.startedAt) / 1000),
    };
    fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(meta, null, 2));
    tick();
    return job;
  } catch (e) {
    job.status = 'error';
    job.error = String(e.message || e);
    job.finishedAt = Date.now();
    tick();
    throw e;
  }
}

// メモには data URI の画像（とても長い）を残さない
function stripImage(input) {
  const copy = Object.assign({}, input);
  for (const k of Object.keys(copy)) {
    if (typeof copy[k] === 'string' && copy[k].startsWith('data:')) copy[k] = '(画像ファイル)';
  }
  return copy;
}

// サーバー用：待たずに jobId を返し、裏で進める
function start(key, opts) {
  const jobId = String(Date.now());
  JOBS[jobId] = { id: jobId, status: 'queued', startedAt: Date.now() };
  generate(key, Object.assign({}, opts, { jobId })).catch(() => {});
  return jobId;
}

// 保存ずみの動画の一覧（新しい順）
function list() {
  if (!fs.existsSync(OUT_DIR)) return [];
  return fs.readdirSync(OUT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8')); } catch (e) { return null; }
    })
    .filter((m) => m && fs.existsSync(path.join(OUT_DIR, `${m.id}.mp4`)))
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}

function remove(id) {
  if (!/^\d+$/.test(String(id))) return false;
  let ok = false;
  for (const ext of ['.mp4', '.json']) {
    const f = path.join(OUT_DIR, id + ext);
    if (fs.existsSync(f)) { fs.unlinkSync(f); ok = true; }
  }
  return ok;
}

module.exports = { PRESETS, JOBS, OUT_DIR, generate, start, list, remove, imageToDataUri, findVideoUrl };
