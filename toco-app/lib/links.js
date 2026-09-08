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

// URLを単語に分けます。「rabbit」はどの記事にも付くので、比べるときは外します。
function slugWords(slug) {
  return String(slug || '').split('-').filter((w) => w && w !== 'rabbit');
}

// 「まだ記事がない」とされたリンクについて、実は書いてある記事を探します。
//
// リンクを書いた時点では記事がなく、あとから別の名前で書いたときに食い違います。
// 例：本文は {{link:hay-feeder|牧草入れ}} だが、記事は rabbit-hayrack-hay で公開ずみ。
// このままだと読者にはただの文字として見えるので、候補を出して気づけるようにします。
function findSimilar(slug, labels, existing) {
  // 表示している文字（「牧草入れ」→ hayrack）がいちばん確かな手がかりです。
  // URLの語も見ると、cage-mat（マット）がケージの記事を拾うような取り違えが起きます。
  // 「cage」はマット記事の主題ではなく、置き場所を表しているだけだからです。
  const fromLabel = [];
  labels.forEach((l) => {
    const w = articles.slugFromJapanese(l);
    if (w) slugWords(w).forEach((x) => { if (!fromLabel.includes(x)) fromLabel.push(x); });
  });
  const want = fromLabel.length ? fromLabel : slugWords(slug);
  if (!want.length) return [];

  return Object.values(existing)
    .filter((a) => a.slug !== slug && a.status === 'publish')
    .map((a) => {
      const has = slugWords(a.slug);
      // 単語がまるごと一致したものだけを候補にします。
      // 一部が似ているだけで拾うと、関係のない記事まで並んでしまいます。
      const hit = want.filter((w) => has.includes(w));
      return hit.length ? { slug: a.slug, title: a.title, matched: hit } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.matched.length - a.matched.length)
    .slice(0, 3);
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
    const status = !a ? 'missing' : (a.status === 'publish' ? 'published' : 'draft');
    return Object.assign(x, {
      status,
      title: a ? a.title : '',
      // 名前が違うだけで、実はもう書いてある記事
      similar: status === 'missing' ? findSimilar(x.slug, x.labels, existing) : [],
    });
  }).sort((a, b) => {
    const order = { missing: 0, draft: 1, published: 2 };
    return (order[a.status] - order[b.status]) || (b.count - a.count);
  });
}

module.exports = { scan, TOKEN };
