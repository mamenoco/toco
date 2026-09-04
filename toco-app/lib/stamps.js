// 動く LINE スタンプを作る
//
// 流れ
//   1. 8体のイラストを並べたシート画像（背景は緑一色）を fal で動画にする   … lib/fal.js
//   2. その動画を格子（例: 横4×縦2）で切り分け、1コマずつ画像に取り出す      … ffmpeg
//   3. 緑を透過にし、最後のコマを先頭に回してから APNG にまとめる            … ffmpeg
//   4. 一覧から選んだスタンプを LINE Creators Market 申請用の zip にする     … zip
//
// LINE のアニメーションスタンプの規格（2024年時点）
//   画像: APNG / 最大 幅320×高さ270 px / 幅・高さは偶数 / 5〜20コマ
//   再生: ループ回数1〜4回、ループ込みの再生時間が 1・2・3・4 秒のいずれか
//   容量: 1ファイル 300KB 以下
//   同梱: main.png（APNG・240×240）、tab.png（静止PNG・96×74）、01.png〜（8・16・24個）

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const STAMP_DIR = path.join(__dirname, '..', 'stamps');
const ZIP_DIR = path.join(STAMP_DIR, 'zips');
const MAX_W = 320, MAX_H = 270, MAX_BYTES = 300 * 1024;

function ff(args) {
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames:format=duration',
    '-of', 'json', file]).toString();
  const j = JSON.parse(out);
  const s = j.streams[0] || {};
  return {
    width: s.width, height: s.height,
    frames: Number(s.nb_read_frames) || 0,
    duration: Number(j.format && j.format.duration) || 0,
  };
}

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `toco-${tag}-`));
}

// 透過（クロマキー）のフィルタ文字列
function keyFilter(o) {
  if (!o.keyColor) return '';
  const color = String(o.keyColor).replace('#', '0x');
  const sim = Number(o.similarity) || 0.25;
  const blend = Number(o.blend) || 0.05;
  return `chromakey=${color}:${sim}:${blend},despill=type=green,`;
}

// 1コマの動画から、1つのスタンプ（APNG）を作る
// cell: { x, y, w, h }  時間: start〜end 秒  frames: コマ数  total: ループ込み秒  loops: ループ回数
function cutOne(video, cell, o, outFile) {
  const seg = o.end - o.start;

  const work = tmpDir('stamp');
  try {
    // 切り出し → 透過 → 縮小。縮小率 scale は容量オーバー時に下げて作り直す
    const make = (scale, frames) => {
      const w = Math.floor(MAX_W * scale), h = Math.floor(MAX_H * scale);
      const fps = frames / seg;            // 区間から frames 枚を等間隔に拾う
      const vf = `crop=${cell.w}:${cell.h}:${cell.x}:${cell.y},fps=${fps},${keyFilter(o)}`
        + `scale=w='min(iw,${w})':h='min(ih,${h})':force_original_aspect_ratio=decrease:force_divisible_by=2,format=rgba`;
      for (const f of fs.readdirSync(work)) fs.unlinkSync(path.join(work, f));
      ff(['-ss', String(o.start), '-t', String(seg + 0.05), '-i', video, '-vf', vf,
        '-frames:v', String(frames), path.join(work, 'f%03d.png')]);
      const got = fs.readdirSync(work).filter((f) => /^f\d+\.png$/.test(f)).sort();
      if (got.length < 5) throw new Error(`コマが ${got.length} 枚しか取れませんでした（区間が短すぎます）`);
      // 最後のコマを先頭に回す（止まったときに決めポーズで止まるように）
      const order = [got[got.length - 1], ...got.slice(0, -1)];
      order.forEach((f, i) => fs.copyFileSync(path.join(work, f), path.join(work, `o${String(i).padStart(3, '0')}.png`)));
      const rate = got.length / (o.total / o.loops);   // 1ループの秒数で割る
      ff(['-framerate', rate.toFixed(4), '-i', path.join(work, 'o%03d.png'),
        '-plays', String(o.loops), '-f', 'apng', '-pred', 'mixed', outFile]);
      return { frames: got.length, bytes: fs.statSync(outFile).size };
    };
    let scale = Math.min(1, Number(o.scale) || 1);
    let frames = o.frames;
    let r = make(scale, frames);
    // 300KB を超えたら、まず少し小さく（3回）、それでもだめならコマ数を減らす（最低5コマ）
    let shrink = 0;
    while (r.bytes > MAX_BYTES) {
      if (shrink < 3) { scale *= 0.85; shrink++; }
      else if (frames - 3 >= 5) { frames -= 3; }
      else break;
      r = make(scale, frames);
    }
    const p = probe(outFile);
    return { frames: r.frames, bytes: r.bytes, width: p.width, height: p.height,
      scale: Number(scale.toFixed(3)), over: r.bytes > MAX_BYTES };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// 動画1本 → スタンプ8個（cols×rows 個）
function cut(videoFile, opts) {
  const info = probe(videoFile);
  const cols = Number(opts.cols) || 4, rows = Number(opts.rows) || 2;
  const total = Number(opts.total) || 3;       // ループ込み秒（1〜4）
  const loops = Number(opts.loops) || 2;       // ループ回数（1〜4）
  const frames = Number(opts.frames) || 15;    // コマ数（5〜20）
  if (![1, 2, 3, 4].includes(total)) throw new Error('再生時間は 1・2・3・4 秒のいずれかです');
  if (loops < 1 || loops > 4) throw new Error('ループ回数は 1〜4 です');
  if (frames < 5 || frames > 20) throw new Error('コマ数は 5〜20 です');
  const start = Math.max(0, Number(opts.start) || 0);
  const end = Math.min(info.duration - 0.05, Number(opts.end) || info.duration);
  if (end - start < 0.3) throw new Error('切り出す区間が短すぎます');

  const setId = String(Date.now());
  const dir = path.join(STAMP_DIR, setId);
  fs.mkdirSync(dir, { recursive: true });
  const cw = Math.floor(info.width / cols), ch = Math.floor(info.height / rows);
  const o = Object.assign({}, opts, { start, end, total, loops, frames });
  const stamps = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = r * cols + c + 1;
      const file = path.join(dir, `${String(n).padStart(2, '0')}.png`);
      const res = cutOne(videoFile, { x: c * cw, y: r * ch, w: cw, h: ch }, o, file);
      stamps.push(Object.assign({ n, file: path.basename(file) }, res));
    }
  }
  const meta = {
    id: setId, video: path.basename(videoFile), createdAt: new Date().toISOString(),
    cols, rows, total, loops, frames, start: Number(start.toFixed(2)), end: Number(end.toFixed(2)),
    keyColor: opts.keyColor || '', stamps,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

function list() {
  if (!fs.existsSync(STAMP_DIR)) return [];
  return fs.readdirSync(STAMP_DIR)
    .filter((d) => /^\d+$/.test(d) && fs.existsSync(path.join(STAMP_DIR, d, 'meta.json')))
    .map((d) => JSON.parse(fs.readFileSync(path.join(STAMP_DIR, d, 'meta.json'), 'utf8')))
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}

function removeSet(id) {
  if (!/^\d+$/.test(String(id))) return false;
  const dir = path.join(STAMP_DIR, id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

function listZips() {
  if (!fs.existsSync(ZIP_DIR)) return [];
  return fs.readdirSync(ZIP_DIR).filter((f) => f.endsWith('.zip'))
    .map((f) => ({ file: f, bytes: fs.statSync(path.join(ZIP_DIR, f)).size, mtime: fs.statSync(path.join(ZIP_DIR, f)).mtime.toISOString() }))
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
}

// 選んだスタンプを申請用 zip にする
// picks: [{ setId, n }, ...]  順番どおりに 01.png, 02.png … になります
function makeZip(picks, name) {
  if (!picks.length) throw new Error('スタンプを選んでください');
  const safe = String(name || 'stamps').replace(/[^\w\-ぁ-んァ-ン一-龠ー]/g, '_').slice(0, 40) || 'stamps';
  const work = tmpDir('zip');
  try {
    picks.forEach((p, i) => {
      const src = path.join(STAMP_DIR, String(p.setId), `${String(p.n).padStart(2, '0')}.png`);
      if (!fs.existsSync(src)) throw new Error(`スタンプが見つかりません: ${p.setId}/${p.n}`);
      fs.copyFileSync(src, path.join(work, `${String(i + 1).padStart(2, '0')}.png`));
    });
    const first = path.join(work, '01.png');
    // main.png: 最初のスタンプを 240×240 に収めた APNG
    let mainSize = 240;
    for (let i = 0; i < 4; i++) {
      ff(['-f', 'apng', '-i', first, '-vf', `scale=${mainSize}:${mainSize}:force_original_aspect_ratio=decrease:force_divisible_by=2,format=rgba`,
        '-plays', String(readPlays(first)), '-f', 'apng', '-pred', 'mixed', path.join(work, 'main.png')]);
      if (fs.statSync(path.join(work, 'main.png')).size <= MAX_BYTES) break;
      mainSize = Math.floor(mainSize * 0.8 / 2) * 2;
    }
    // tab.png: 最初のコマを 96×74 に収めた静止画
    ff(['-f', 'apng', '-i', first, '-vf', 'scale=96:74:force_original_aspect_ratio=decrease:force_divisible_by=2,format=rgba',
      '-frames:v', '1', path.join(work, 'tab.png')]);
    fs.mkdirSync(ZIP_DIR, { recursive: true });
    const zipName = `${safe}_${new Date().toISOString().slice(0, 10)}_${picks.length}.zip`;
    const zipFile = path.join(ZIP_DIR, zipName);
    if (fs.existsSync(zipFile)) fs.unlinkSync(zipFile);
    execFileSync('zip', ['-j', '-q', zipFile, ...fs.readdirSync(work).map((f) => path.join(work, f))]);
    return { file: zipName, bytes: fs.statSync(zipFile).size, count: picks.length };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// APNG のループ回数を読む（acTL チャンクの num_plays）。読めなければ 1
function readPlays(file) {
  try {
    const buf = fs.readFileSync(file);
    const i = buf.indexOf('acTL');
    if (i > 0) return buf.readUInt32BE(i + 8) || 1;
  } catch (e) {}
  return 1;
}

module.exports = { STAMP_DIR, ZIP_DIR, MAX_BYTES, cut, list, removeSet, makeZip, listZips, probe };
