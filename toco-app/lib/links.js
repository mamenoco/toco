// 記事内リンクの管理
//
// まだ書いていない記事に触れるとき、本文には {{link:スラッグ|表示する文字}} と書いておきます。
//
//   すのこの上に敷く{{link:cage-mat|マット}}が必要になることもあります。
//
// その記事がまだ無いあいだは、読者にはただの文字として見えます。
// 記事を書いて公開すると、ビルドのときに自動でリンクに変わります。
// 「あとでリンクを張る」を覚えておく必要がなくなります。

const articles = require('./articles.js');
const fs = require('fs');
const path = require('path');

const PAGES = path.join(__dirname, '..', '..', 'pages');
const TOKEN = /\{\{link:([^}|]+)(?:\|([^}]*))?\}\}/g;

function sources() {
  const list = articles.list().map((a) => ({
    kind: 'article', slug: a.slug, title: a.title,
    body: (articles.read(a.slug) || {}).body || '',
  }));
  if (fs.existsSync(PAGES)) {
    fs.readdirSync(PAGES).filter((f) => f.endsWith('.md')).forEach((f) => {
      const slug = f.replace(/\.md$/, '');
      const { meta, body } = articles.parse(fs.readFileSync(path.join(PAGES, f), 'utf8'));
      list.push({ kind: 'page', slug, title: meta.title || slug, body });
    });
  }
  return list;
}

// 記事とページを全部読んで、リンク待ちを集めます。
function scan() {
  // 記事だけでなく、固定ページもリンク先になります
  const existing = {};
  articles.list().forEach((a) => { existing[a.slug] = a; });
  sources().filter((x) => x.kind === 'page').forEach((p) => {
    if (!existing[p.slug]) existing[p.slug] = { slug: p.slug, title: p.title, status: 'publish' };
  });

  const found = {};
  sources().forEach((src) => {
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(src.body))) {
      const slug = m[1].trim();
      const label = (m[2] || slug).trim();
      if (!found[slug]) found[slug] = { slug, labels: [], usedIn: [], count: 0 };
      found[slug].count++;
      if (!found[slug].labels.includes(label)) found[slug].labels.push(label);
      if (!found[slug].usedIn.some((u) => u.slug === src.slug)) {
        found[slug].usedIn.push({ slug: src.slug, title: src.title, kind: src.kind });
      }
    }
  });

  return Object.values(found).map((x) => {
    const a = existing[x.slug];
    return Object.assign(x, {
      status: !a ? 'missing' : (a.status === 'publish' ? 'published' : 'draft'),
      title: a ? a.title : '',
    });
  }).sort((a, b) => {
    const order = { missing: 0, draft: 1, published: 2 };
    return (order[a.status] - order[b.status]) || (b.count - a.count);
  });
}

module.exports = { scan, TOKEN };
