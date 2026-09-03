// 静的サイトの書き出し
//
// articles/*.md  ＋  site/templates/*.html  ＋  theme-original/ の資産
//   → toco-app/dist/  に完成したサイトを出す
//
// 追加パッケージは使いません。画像の縮小は macOS 標準の sips を呼びます。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const markdown = require('./markdown.js');
const config = require('./site-config.js');

const APP = path.join(__dirname, '..');
const ROOT = path.join(APP, '..');
const DIST = path.join(APP, 'dist');
const TPL = path.join(APP, 'site', 'templates');
const THEME = path.join(ROOT, 'theme-original');
const ARTICLES = path.join(ROOT, 'articles');
const PAGES = path.join(ROOT, 'pages');

// ---------- 小道具 ----------

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }

function write(rel, html) {
  const full = path.join(DIST, rel);
  mkdir(path.dirname(full));
  fs.writeFileSync(full, html);
}

function readTpl(name) {
  return fs.readFileSync(path.join(TPL, name), 'utf8');
}

// {{KEY}} を差し替える。値が undefined のときは空にする。
function fill(tpl, vars) {
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (vars[k] == null ? '' : String(vars[k])));
}

function formatDate(iso) {
  const d = String(iso || '').slice(0, 10).split('-');
  return d.length === 3 ? `${d[0]}.${d[1]}.${d[2]}` : '';
}

// ---------- 記事の読み込み ----------

// --- で囲んだ先頭部分をメタ情報として読みます。
function parseFrontMatter(text) {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!src.startsWith('---\n')) return { meta: {}, body: src };
  const end = src.indexOf('\n---', 4);
  if (end === -1) return { meta: {}, body: src };
  const head = src.slice(4, end);
  const body = src.slice(end + 4).replace(/^\n+/, '');
  const meta = {};
  head.split('\n').forEach((line) => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!m) return;
    let v = m[2].trim().replace(/^["']|["']$/g, '');
    if (/^\[.*\]$/.test(v)) {
      v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (v.includes(',') && (m[1] === 'tags')) {
      v = v.split(',').map((x) => x.trim()).filter(Boolean);
    }
    meta[m[1]] = v;
  });
  return { meta, body };
}

function loadMarkdownDir(dir, kind) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => {
      const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(dir, f), 'utf8'));
      const h1 = body.match(/^#\s+(.+)$/m);
      return {
        kind,
        file: f,
        slug: meta.slug || f.replace(/\.md$/, ''),
        title: meta.title || (h1 ? h1[1].trim() : f.replace(/\.md$/, '')),
        category: meta.category || '',
        tags: Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []),
        date: meta.date || '',
        updated: meta.updated || '',
        description: meta.description || '',
        eyecatch: meta.eyecatch || '',
        status: meta.status || 'draft',
        body,
      };
    });
}

// ---------- 商品カード（フェーズ2で本実装） ----------

function productPlaceholder(id) {
  return '<div class="pd-box pd-placeholder" data-product="' + esc(id) + '">'
    + '<p>商品カード（' + esc(id) + '）</p></div>';
}

// 旧記事に残っている「Amazonで詳細を見る｜楽天市場で…」の行を目印として拾う
function replaceLegacyProductLines(md) {
  let n = 0;
  return md.replace(/^.*で詳細を見る.*$/gm, (line) => {
    if (!/Amazon|楽天/.test(line)) return line;
    n += 1;
    return `{{product:slot-${n}}}`;
  });
}

// ---------- 部品のHTML ----------

function menuHtml() {
  return '<ul class="menu">'
    + config.menu.map(([label, href]) => `<li><a href="${esc(href)}">${esc(label)}</a></li>`).join('')
    + '</ul>';
}

function categoryOf(slug) {
  return config.categories.find((c) => c.slug === slug) || { slug: '', name: 'うさぎの暮らし' };
}

function cardImage(article) {
  return article.eyecatch || '/assets/images/card-default.jpg';
}

function pickupCard(a) {
  const cat = categoryOf(a.category);
  return `<article class="pickup-card">
  <a class="pickup-image" href="/${esc(a.slug)}/"><img src="${esc(cardImage(a))}" alt="" loading="lazy"><span>${esc(cat.name)}</span></a>
  <h3><a href="/${esc(a.slug)}/">${esc(a.title)}</a></h3>
  <time datetime="${esc(a.date)}">${formatDate(a.date)}</time>
</article>`;
}

function columnRow(a) {
  return `<a class="column-row" href="/${esc(a.slug)}/">
  <img src="${esc(cardImage(a))}" alt="" loading="lazy">
  <span><strong>${esc(a.title)}</strong><p>${esc(a.description)}</p><time datetime="${esc(a.date)}">${formatDate(a.date)}</time></span><i>›</i>
</a>`;
}

function archiveCard(a) {
  return `<article class="archive-card"><a href="/${esc(a.slug)}/">
  <img src="${esc(cardImage(a))}" alt="" loading="lazy">
  <div><time>${formatDate(a.date)}</time><h2>${esc(a.title)}</h2><p>${esc(a.description)}</p></div>
</a></article>`;
}

function headTags(o) {
  const canonical = config.url + o.path;
  const title = o.title ? `${o.title}｜${config.name}` : `${config.name} - ${config.tagline}`;
  const desc = o.description || config.description;
  const img = o.image ? (config.url + o.image) : (config.url + '/assets/images/card-default.jpg');
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    o.noindex ? '<meta name="robots" content="noindex, nofollow">'
              : '<meta name="robots" content="index, follow, max-image-preview:large">',
    `<meta property="og:locale" content="ja_JP">`,
    `<meta property="og:type" content="${o.type || 'website'}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:site_name" content="${esc(config.name)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].filter(Boolean).join('\n');
}

function layout(o) {
  return fill(readTpl('base.html'), {
    HEAD: headTags(o),
    BODYCLASS: o.bodyClass || '',
    CONTENT: o.content,
    MENU: menuHtml(),
    FOOTERMENU: menuHtml(),
    SITENAME: esc(config.name),
    TAGLINE: esc(config.tagline),
    YEAR: o.year,
    ASSETVER: o.assetVer,
  });
}

// ---------- 資産（CSS・JS・画像・ファビコン） ----------

function buildAssets() {
  const css = [
    fs.readFileSync(path.join(THEME, 'assets/css/theme.css'), 'utf8'),
    fs.readFileSync(path.join(THEME, 'vendor/toc-plus.css'), 'utf8'),
    fs.readFileSync(path.join(THEME, 'vendor/pochipp.css'), 'utf8'),
    // 追加CSS はローカルの整理版を使う（本番と内容は同一・コメントのみ差分）
    fs.readFileSync(path.join(ROOT, 'theme-fix', '追加CSS.css'), 'utf8')
      // WordPress の絶対URLを、新サイトの相対パスに直す
      .replace(/https:\/\/toco-to\.com\/wp-content\/themes\/toco-kurashi\/assets\/images\//g, '../images/'),
    // 静的サイト側で足す分
    [
      // 追従ヘッダーの下に見出しが隠れないようにする（比較表からのジャンプ用）
      '.entry-content h2[id],.entry-content h3[id]{scroll-margin-top:140px}',
      '@media(max-width:900px){.entry-content h2[id],.entry-content h3[id]{scroll-margin-top:80px}}',
      // 商品カードの仮スタイル（フェーズ2で置き換え）
      '.pd-placeholder{margin:24px 0;padding:22px;border:1px dashed #e0c9c4;border-radius:14px;'
      + 'background:#fffaf6;color:#b09a94;font-size:12px;text-align:center}.pd-placeholder p{margin:0}',
    ].join('\n'),
  ].join('\n\n');
  write('assets/css/site.css', css);

  write('assets/js/theme.js',
    fs.readFileSync(path.join(THEME, 'assets/js/theme.js'), 'utf8') + '\n'
    + fs.readFileSync(path.join(APP, 'site/assets/js/site.js'), 'utf8'));

  // 画像は表示サイズに合わせて縮小する
  const srcImg = path.join(THEME, 'assets/images');
  const outImg = path.join(DIST, 'assets/images');
  mkdir(outImg);
  let before = 0, after = 0;
  fs.readdirSync(srcImg).filter((f) => /\.png$/i.test(f)).forEach((f) => {
    const src = path.join(srcImg, f);
    const jpeg = config.imageToJpeg[f];
    const out = path.join(outImg, jpeg || f);
    before += fs.statSync(src).size;
    fs.copyFileSync(src, out);
    const max = config.imageMaxSide[f];
    const args = [];
    if (jpeg) args.push('-s', 'format', 'jpeg', '-s', 'formatOptions', '82');
    if (max) args.push('-Z', String(max));
    if (args.length) {
      try { execFileSync('sips', args.concat([out]), { stdio: 'ignore' }); }
      catch (e) { /* sips が無い環境ではそのまま使う */ }
    }
    after += fs.statSync(out).size;
  });

  // 記事一覧に出すアイキャッチの代替（720×460）
  const def = path.join(outImg, 'card-default.jpg');
  try {
    fs.copyFileSync(path.join(srcImg, 'hero-rabbit-photo.png'), def);
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80',
      '-z', '460', '720', def], { stdio: 'ignore' });
    after += fs.statSync(def).size;
  } catch (e) { /* 失敗しても致命的ではない */ }

  // アイキャッチ（アプリで作った画像）
  const eyeSrc = path.join(APP, 'site/assets/eyecatch');
  if (fs.existsSync(eyeSrc)) {
    const eyeOut = path.join(DIST, 'assets/eyecatch');
    mkdir(eyeOut);
    fs.readdirSync(eyeSrc).filter((f) => /\.(png|jpg)$/i.test(f)).forEach((f) => {
      fs.copyFileSync(path.join(eyeSrc, f), path.join(eyeOut, f));
      after += fs.statSync(path.join(eyeOut, f)).size;
    });
  }

  // ファビコン
  const favSrc = path.join(APP, 'site/assets/favicon');
  const favOut = path.join(DIST, 'assets/favicon');
  mkdir(favOut);
  fs.readdirSync(favSrc).filter((f) => /\.(png|ico)$/.test(f)).forEach((f) => {
    fs.copyFileSync(path.join(favSrc, f), path.join(favOut, f));
  });
  fs.copyFileSync(path.join(favSrc, 'favicon.ico'), path.join(DIST, 'favicon.ico'));

  return { imagesBefore: before, imagesAfter: after };
}

// ---------- 各ページ ----------

function buildSingle(a, prev, next, ctx) {
  const cat = categoryOf(a.category);
  const md = replaceLegacyProductLines(a.body);
  const r = markdown.render(md, { product: productPlaceholder });

  const hero = a.eyecatch
    ? `<figure class="single-hero"><img src="${esc(a.eyecatch)}" alt=""></figure>` : '';
  const link = (x, cls, arrow) => (x
    ? `<div class="nav-${cls}"><a href="/${esc(x.slug)}/">${arrow === 'prev' ? '‹ ' : ''}${esc(x.title)}${arrow === 'next' ? ' ›' : ''}</a></div>`
    : '');

  // 目次は本文の先頭ではなく、最初の見出しの直前に入れる（旧サイトと同じ位置）
  let body = r.html;
  if (r.toc) {
    const at = body.indexOf('<h2');
    body = at === -1 ? r.toc + '\n' + body : body.slice(0, at) + r.toc + '\n' + body.slice(at);
  }

  const content = fill(readTpl('single.html'), {
    CATSLUG: esc(cat.slug), CATNAME: esc(cat.name),
    TITLE: esc(a.title),
    DATE: formatDate(a.date), DATEISO: esc(a.date),
    HERO: hero, TOC: '', BODY: body,
    PREV: link(prev, 'previous', 'prev'), NEXT: link(next, 'next', 'next'),
  });

  write(`${a.slug}/index.html`, layout({
    path: `/${a.slug}/`, title: a.title, description: a.description,
    image: a.eyecatch, type: 'article', bodyClass: 'single', content, ...ctx,
  }));
}

function buildPage(p, ctx) {
  const r = markdown.render(p.body, { product: productPlaceholder });
  const content = fill(readTpl('page.html'), { TITLE: esc(p.title), TOC: r.toc, BODY: r.html });
  write(`${p.slug}/index.html`, layout({
    path: `/${p.slug}/`, title: p.title, description: p.description,
    bodyClass: 'page', content, ...ctx,
  }));
}

function buildArchive(slugPath, heading, list, ctx) {
  const per = config.archivePerPage;
  const pages = Math.max(1, Math.ceil(list.length / per));
  for (let i = 0; i < pages; i++) {
    const items = list.slice(i * per, (i + 1) * per);
    const cards = items.length ? items.map(archiveCard).join('\n')
      : '<p>記事が見つかりませんでした。</p>';
    let pagination = '';
    if (pages > 1) {
      const links = [];
      for (let n = 1; n <= pages; n++) {
        const href = n === 1 ? slugPath : `${slugPath}page/${n}/`;
        links.push(n === i + 1
          ? `<span class="page-numbers current">${n}</span>`
          : `<a class="page-numbers" href="${href}">${n}</a>`);
      }
      pagination = `<nav class="navigation pagination"><div class="nav-links">${links.join('')}</div></nav>`;
    }
    const content = fill(readTpl('archive.html'), { HEADING: esc(heading), CARDS: cards, PAGINATION: pagination });
    const out = i === 0 ? `${slugPath}index.html` : `${slugPath}page/${i + 1}/index.html`;
    write(out.replace(/^\//, ''), layout({
      path: i === 0 ? slugPath : `${slugPath}page/${i + 1}/`,
      title: heading, bodyClass: 'archive', content, ...ctx,
    }));
  }
}

function buildFrontPage(published, ctx) {
  const cards = config.categories.filter((c) => c.slug !== 'column').map((c, i) =>
    `<a class="category-card card-${i + 1}" href="/category/${c.slug}/">
  <span class="category-art category-art-${i + 1}" aria-hidden="true"></span>
  <strong>${esc(c.name)}</strong>
  <small>${c.lead}</small>
</a>`).join('\n');

  const pickup = published.slice(0, 5);
  let columns = published.filter((a) => a.category === 'column').slice(0, 3);
  if (!columns.length) columns = pickup.slice(0, 3);

  const counts = {};
  published.forEach((a) => a.tags.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 8);
  const tags = top.length
    ? top.map((t) => `<a href="/tag/${encodeURIComponent(t)}/">#${esc(t)}</a>`).join('')
    : config.fallbackTags.map((t) => `<span>#${esc(t)}</span>`).join('');

  const newsletter = config.showNewsletter
    ? `<section class="newsletter"><div><h2>メルマガ登録</h2><p>新着記事やおすすめ情報をお届けします。</p></div></section>` : '';

  const content = fill(readTpl('front-page.html'), {
    CATEGORYCARDS: cards,
    PICKUP: pickup.length ? pickup.map(pickupCard).join('\n') : '<p class="empty-message">記事を準備しています。</p>',
    COLUMNS: columns.map(columnRow).join('\n'),
    TAGS: tags,
    NEWSLETTER: newsletter,
  });

  write('index.html', layout({ path: '/', bodyClass: 'home', content, ...ctx }));
}

function buildExtras(published, ctx) {
  // 404
  const notFound = `<main class="archive-main page-width">
  <header class="archive-header"><h1>ページが見つかりませんでした</h1></header>
  <p>お探しのページは移動または削除された可能性があります。</p>
  <p><a class="pink-button" href="/">トップページへ戻る</a></p>
</main>`;
  write('404.html', layout({ path: '/404.html', title: 'ページが見つかりませんでした', noindex: true, content: notFound, ...ctx }));

  // sitemap.xml
  const urls = ['/'].concat(published.map((a) => `/${a.slug}/`))
    .concat(config.categories.map((c) => `/category/${c.slug}/`));
  write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((u) => `  <url><loc>${config.url}${u}</loc></url>`).join('\n')
    + '\n</urlset>\n');

  // robots.txt
  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${config.url}/sitemap.xml\n`);

  // Cloudflare Pages が配る *.pages.dev のURLを検索結果に出さない。
  // 本番（toco-to.com）と中身が同じなので、両方が拾われると重複扱いになるため。
  write('_headers', 'https://*.pages.dev/*\n  X-Robots-Tag: noindex\n');

  // 検索用のインデックス
  write('search-index.json', JSON.stringify(published.map((a) => ({
    t: a.title, u: `/${a.slug}/`, c: a.category, d: a.description,
  }))));
}

// ---------- 実行 ----------

function build(opts) {
  const options = opts || {};
  const started = Date.now();
  const ctx = { year: options.year || 2026, assetVer: options.assetVer || '1' };

  fs.rmSync(DIST, { recursive: true, force: true });
  mkdir(DIST);

  const assets = buildAssets();

  const all = loadMarkdownDir(ARTICLES, 'article');
  const published = all.filter((a) => a.status === 'publish')
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  published.forEach((a, i) => buildSingle(a, published[i + 1], published[i - 1], ctx));

  config.categories.forEach((c) => {
    buildArchive(`/category/${c.slug}/`, c.name, published.filter((a) => a.category === c.slug), ctx);
  });

  const pages = loadMarkdownDir(PAGES, 'page');
  pages.forEach((p) => buildPage(p, ctx));

  buildFrontPage(published, ctx);
  buildExtras(published, ctx);

  return {
    ms: Date.now() - started,
    articles: published.length,
    drafts: all.length - published.length,
    pages: pages.length,
    imagesBefore: assets.imagesBefore,
    imagesAfter: assets.imagesAfter,
  };
}

module.exports = { build, parseFrontMatter, loadMarkdownDir };

if (require.main === module) {
  const r = build({ year: new Date(2026, 8, 3).getFullYear() });
  const mb = (n) => (n / 1048576).toFixed(2) + 'MB';
  console.log(`ビルド完了 ${r.ms}ms`);
  console.log(`  記事 ${r.articles}本（下書き ${r.drafts}本）／固定ページ ${r.pages}枚`);
  console.log(`  画像 ${mb(r.imagesBefore)} → ${mb(r.imagesAfter)}`);
}
