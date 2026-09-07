// 記事ファイルの読み書き
//
// 記事の本文は data/db.json ではなく、articles/{スラッグ}.md に置きます。
//   ・120本ぶんの本文をJSONに抱えると読み書きが重くなるため
//   ・1記事1ファイルなら、Gitの差分で「どこを直したか」が読めるため
//
// ファイルの先頭に --- で囲んだ部分（フロントマター）を置き、
// タイトル・カテゴリ・公開状態などをそこに書きます。

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..');
const DIR = path.join(APP, '..', 'articles');

const FIELDS = ['title', 'slug', 'category', 'tags', 'date', 'updated',
  'description', 'eyecatch', 'status'];

function ensureDir() { fs.mkdirSync(DIR, { recursive: true }); }

// スラッグは URL になるので、英小文字・数字・ハイフンだけに限ります。
function isValidSlug(s) {
  return /^[a-z0-9][a-z0-9-]{0,60}$/.test(String(s || ''));
}

function filePath(slug) { return path.join(DIR, `${slug}.md`); }

function parse(text) {
  const src = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!src.startsWith('---\n')) return { meta: {}, body: src };
  const end = src.indexOf('\n---', 4);
  if (end === -1) return { meta: {}, body: src };
  const meta = {};
  src.slice(4, end).split('\n').forEach((line) => {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!m) return;
    let v = m[2].trim().replace(/^["']|["']$/g, '');
    if (/^\[.*\]$/.test(v)) {
      v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    meta[m[1]] = v;
  });
  return { meta, body: src.slice(end + 4).replace(/^\n+/, '') };
}

function stringify(meta, body) {
  const lines = ['---'];
  FIELDS.forEach((k) => {
    const v = meta[k];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return;
    lines.push(`${k}: ${Array.isArray(v) ? '[' + v.join(', ') + ']' : v}`);
  });
  lines.push('---', '');
  return lines.join('\n') + String(body || '').replace(/^\n+/, '');
}

function read(slug) {
  const f = filePath(slug);
  if (!fs.existsSync(f)) return null;
  const { meta, body } = parse(fs.readFileSync(f, 'utf8'));
  return { slug, meta, body };
}

function save(slug, meta, body) {
  if (!isValidSlug(slug)) throw new Error('スラッグは英小文字・数字・ハイフンだけで指定してください');
  ensureDir();
  const next = Object.assign({}, meta, { slug });
  fs.writeFileSync(filePath(slug), stringify(next, body));
  return read(slug);
}

function rename(oldSlug, newSlug) {
  if (oldSlug === newSlug) return;
  if (!isValidSlug(newSlug)) throw new Error('スラッグは英小文字・数字・ハイフンだけで指定してください');
  if (fs.existsSync(filePath(newSlug))) throw new Error(`${newSlug} は既に使われています`);
  const cur = read(oldSlug);
  if (!cur) return;
  save(newSlug, cur.meta, cur.body);
  fs.unlinkSync(filePath(oldSlug));
}

function remove(slug) {
  const f = filePath(slug);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

function list() {
  ensureDir();
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => {
      const slug = f.replace(/\.md$/, '');
      const a = read(slug);
      const h1 = a.body.match(/^#\s+(.+)$/m);
      return {
        slug,
        title: a.meta.title || (h1 ? h1[1].trim() : slug),
        category: a.meta.category || '',
        status: a.meta.status || 'draft',
        date: a.meta.date || '',
        updated: a.meta.updated || '',
        description: a.meta.description || '',
        chars: a.body.length,
        mtime: fs.statSync(filePath(slug)).mtime.toISOString().slice(0, 10),
      };
    })
    .sort((x, y) => String(y.date || y.mtime).localeCompare(String(x.date || x.mtime)));
}

// 日本語のキーワードから、意味の分かるURLを作るための対応表。
// 「うさぎ トイレ」→ rabbit-toilet のように組み立てます。
// ここに無い語は落とすので、うまく作れないときは呼び出し側で気づけるよう '' を返します。
const SLUG_WORDS = [
  ['うさぎ', 'rabbit'], ['ウサギ', 'rabbit'], ['ラビット', 'rabbit'],
  ['チモシー', 'timothy'], ['アルファルファ', 'alfalfa'], ['牧草入れ', 'hayrack'], ['牧草', 'hay'],
  ['ペレット', 'pellet'], ['おやつ', 'treat'], ['サプリ', 'supplement'],
  ['ケージ', 'cage'], ['サークル', 'pen'], ['すのこ', 'floor'], ['ロフト', 'loft'],
  ['トイレ砂', 'litter'], ['トイレシーツ', 'sheet'], ['トイレ', 'toilet'],
  ['シーツ', 'sheet'], ['マット', 'mat'], ['消臭', 'deodorant'],
  ['キャリー', 'carry'], ['ハーネス', 'harness'],
  ['給水', 'bottle'], ['水入れ', 'bottle'], ['食器', 'bowl'], ['えさ入れ', 'bowl'],
  ['おもちゃ', 'toy'], ['かじり木', 'chewtoy'], ['トンネル', 'tunnel'],
  ['ブラシ', 'brush'], ['爪切り', 'nailclipper'], ['換毛', 'molting'], ['グルーミング', 'grooming'],
  ['ヒーター', 'heater'], ['寒さ', 'cold'], ['暑さ', 'heat'], ['冷感', 'cooling'], ['温度', 'temperature'],
  ['ベッド', 'bed'], ['ハウス', 'house'], ['ステップ', 'step'],
  ['しつけ', 'training'], ['多頭', 'multi'], ['お迎え', 'welcome'], ['初心者', 'beginner'],
  ['健康', 'health'], ['病気', 'illness'], ['うっ滞', 'stasis'], ['体重', 'weight'],
  ['掃除', 'cleaning'], ['ニオイ', 'odor'], ['におい', 'odor'], ['臭い', 'odor'],
];

// 「うさぎ トイレのおすすめ」のような日本語から、英字のURLを組み立てます。
// 作れなかったときは '' を返します（呼び出し側で確認を促すため）。
function slugFromJapanese(text) {
  const src = String(text || '');
  const parts = [];
  SLUG_WORDS.forEach(([ja, en]) => {
    if (src.includes(ja) && !parts.includes(en)) parts.push(en);
  });
  if (!parts.length) return '';
  // rabbit は必ず先頭に置いて、それ以外は2語までにします
  const rest = parts.filter((x) => x !== 'rabbit').slice(0, 2);
  const head = parts.includes('rabbit') ? ['rabbit'] : [];
  return head.concat(rest).join('-');
}

// 自動で付いただけのURL（article / article-2）かどうか。
// 画面で「決め直してください」と伝えるために使います。
function isPlaceholderSlug(slug) {
  return /^article(-\d+)?$/.test(String(slug || ''));
}

// 使えるスラッグの候補を出す（重複を避けて連番を付ける）
function suggestSlug(base) {
  // 日本語が混じっていたら、まず対応表で英字に置き換えます
  const raw = String(base || '');
  const ascii = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const clean = ascii || slugFromJapanese(raw) || 'article';
  if (!fs.existsSync(filePath(clean))) return clean;
  for (let i = 2; i < 100; i++) {
    if (!fs.existsSync(filePath(`${clean}-${i}`))) return `${clean}-${i}`;
  }
  return `${clean}-${Date.now()}`;
}

module.exports = {
  DIR, read, save, rename, remove, list, parse, stringify,
  isValidSlug, suggestSlug, filePath, slugFromJapanese, isPlaceholderSlug,
};
