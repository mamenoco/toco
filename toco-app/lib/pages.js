// 固定ページ（pages/*.md）の読み書き
//
// 記事（articles/*.md）と違って、ページは一覧やカテゴリに出ません。
// 「はじめての方へ」のように、書いたあとも記事リンクを足していく場所です。
// フロントマターの読み書きは記事と同じものを使い回します。

const fs = require('fs');
const path = require('path');
const articles = require('./articles.js');

const DIR = path.join(__dirname, '..', '..', 'pages');

// 消されると困るページ。URLの変更と削除をさせません。
const PROTECTED = ['contact', 'privacy'];

function filePath(slug) { return path.join(DIR, `${slug}.md`); }

function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => {
      const slug = f.replace(/\.md$/, '');
      const p = read(slug);
      return {
        slug,
        title: p.meta.title || slug,
        description: p.meta.description || '',
        chars: p.body.length,
        // 本文に置いてある記事リンクの数（どれだけ記事へ送れているか）
        links: (p.body.match(/\{\{link:/g) || []).length,
        protectedPage: PROTECTED.includes(slug),
        updated: fs.statSync(filePath(slug)).mtime.toISOString().slice(0, 10),
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function read(slug) {
  const f = filePath(slug);
  if (!fs.existsSync(f)) return null;
  const { meta, body } = articles.parse(fs.readFileSync(f, 'utf8'));
  return { slug, meta, body };
}

function save(slug, meta, body) {
  if (!articles.isValidSlug(slug)) {
    throw new Error('URLは英小文字・数字・ハイフンで入力してください');
  }
  fs.mkdirSync(DIR, { recursive: true });
  const cur = read(slug);
  const next = Object.assign({}, cur ? cur.meta : {}, meta, { slug });
  if (!next.title) next.title = slug;
  if (!next.date) next.date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(filePath(slug), articles.stringify(next, body));
  return read(slug);
}

module.exports = { DIR, PROTECTED, list, read, save, filePath };
