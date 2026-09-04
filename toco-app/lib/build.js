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
const affiliate = require('./affiliate.js');
const products = require('./products.js');
const DB = require('./db.js');

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

// 商品カードを組み立てる。
// リンクは もしもアフィリエイト のクリックURLにします（§3-3）。
// rel="nofollow sponsored" は広告リンクである印。付け忘れるとスパム判定の対象になります。
function productCard(id, ctx) {
  const p = ctx.products[id];
  if (!p) return '<!-- 商品が見つかりません: ' + esc(id) + ' -->';

  const t = affiliate.targets(p);
  const button = (mall, label) => {
    const href = affiliate.link(mall, t[mall], ctx.moshimo);
    if (!href) return '';
    return '<a class="pd-btn pd-' + mall + '" href="' + esc(href) + '"'
      + ' target="_blank" rel="nofollow sponsored noopener" data-mall="' + mall + '">'
      + esc(label) + '</a>';
  };

  const malls = [['amazon', 'Amazon'], ['rakuten', '楽天市場']];
  if (config.showYahoo) malls.push(['yahoo', 'Yahoo!']);
  const buttons = malls.map(([m, l]) => button(m, l)).filter(Boolean).join('');
  if (!buttons) return '<!-- リンクを作れませんでした: ' + esc(id) + ' -->';

  const img = p.image
    ? '<div class="pd-img"><img src="' + esc(p.image) + '" alt="" loading="lazy"></div>' : '';

  return '<div class="pd-box" data-product="' + esc(id) + '">'
    + img
    + '<div class="pd-body">'
    + (p.brand ? '<p class="pd-brand">' + esc(p.brand) + '</p>' : '')
    + '<p class="pd-name">' + esc(p.name) + '</p>'
    + '<div class="pd-btns">' + buttons + '</div>'
    + '<p class="pd-note">価格は変動します。最新の価格は各ストアでご確認ください。</p>'
    + '</div></div>';
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
      '.contact-form{margin:24px 0}.contact-form iframe{width:100%;border:0;border-radius:12px;background:#fff}',
      // 記事末の「ほかの商品も見る」欄
      '.mall-links{margin:26px 0;padding:18px 20px;border:1px solid var(--line);border-radius:14px;background:#fffdfa}',
      // まだ書いていない記事へのリンク（読者には普通の文字として見えます）
      '.link-todo{color:inherit}',
      // 下書きプレビューの帯
      '.draft-note{max-width:900px;margin:0 auto 14px;padding:11px 20px;border-radius:10px;'
      + 'background:#fbf1e1;color:#8a6d3b;font-size:12px;line-height:1.7}',
      // 本文中のマーカー（==テキスト== で囲んだところ）
      [
        '.entry-content mark.hl{',
        'background:linear-gradient(transparent 56%, rgba(239,174,179,.5) 56%);',
        'color:inherit;font-weight:700;padding:0 1px}',
      ].join(''),
      // 本文中の画像
      [
        '.entry-content figure.ph{margin:26px 0}',
        '.entry-content figure.ph img{display:block;width:100%;height:auto;border-radius:12px}',
        '.entry-content figure.ph figcaption{margin-top:8px;color:#a3968f;font-size:11px;',
        'line-height:1.7;text-align:center}',
      ].join(''),
      // 段落の下に出す記事カード
      [
        '.rel-cards{display:grid;gap:10px;margin:0 0 1.8em}',
        '@media(min-width:700px){.rel-cards:has(> :nth-child(2)){grid-template-columns:1fr 1fr}}',
        '.entry-content .related-link.has-img{display:flex;gap:14px;align-items:center;margin:0;padding:12px 14px}',
        '.entry-content .related-link.has-img img{width:88px;height:60px;flex:0 0 auto;',
        'object-fit:cover;border-radius:8px;background:var(--beige)}',
        '.entry-content .related-link .rel-text{min-width:0;display:block}',
        '.entry-content .related-link .rel-text strong{display:block;color:var(--ink);',
        'font-size:13px;font-weight:600;line-height:1.55}',
        '.entry-content .related-link .rel-text em{display:block;margin-top:3px;color:#a3968f;',
        'font-size:11px;font-style:normal;line-height:1.6}',
      ].join(''),
      // よくある質問の見出し
      '.entry-content h3.faq-q::before{content:"Q. ";color:var(--pink-dark);font-weight:700}',
      // 商品カード
      [
        '.pd-box{display:flex;gap:18px;margin:26px 0;padding:20px;border:1px solid var(--line);',
        'border-radius:14px;background:#fff;box-shadow:0 4px 16px rgba(90,68,59,.05)}',
        '.pd-img{flex:0 0 132px}',
        '.pd-img img{width:132px;height:132px;object-fit:contain;border-radius:8px;background:#fdfaf7}',
        '.pd-body{min-width:0;flex:1;display:flex;flex-direction:column;justify-content:center}',
        '.pd-brand{margin:0 0 2px;color:#a3968f;font-size:11px;letter-spacing:.04em}',
        '.pd-name{margin:0 0 14px;font-family:"Zen Maru Gothic",sans-serif;font-size:15px;',
        'font-weight:700;line-height:1.6}',
        '.pd-btns{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}',
        '.pd-btn{display:grid;place-items:center;height:42px;border-radius:999px;color:#fff!important;',
        'font-size:13px;font-weight:700;text-decoration:none!important;letter-spacing:.02em;',
        'box-shadow:0 4px 10px rgba(120,90,70,.13);transition:transform .15s ease,filter .15s ease}',
        '.pd-btn:hover{transform:translateY(-1px);filter:brightness(1.05)}',
        '.pd-amazon{background:#f79256}',
        '.pd-rakuten{background:#f76956}',
        '.pd-yahoo{background:#7b9fd4}',
        '.pd-note{margin:11px 0 0;color:#a3968f;font-size:10px;line-height:1.6}',
        '@media(max-width:600px){',
        '.pd-box{flex-direction:column;gap:14px;padding:16px;align-items:center;text-align:center}',
        '.pd-img{flex:none}.pd-body{width:100%}.pd-name{font-size:14px}',
        '.pd-btns{grid-template-columns:1fr 1fr}}',
      ].join(''),
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

  // 商品画像（楽天APIから取得したもの）
  const prodSrc = path.join(APP, 'site/assets/products');
  if (fs.existsSync(prodSrc)) {
    const prodOut = path.join(DIST, 'assets/products');
    mkdir(prodOut);
    fs.readdirSync(prodSrc).filter((f) => /\.(png|jpg)$/i.test(f)).forEach((f) => {
      fs.copyFileSync(path.join(prodSrc, f), path.join(prodOut, f));
      after += fs.statSync(path.join(prodOut, f)).size;
    });
  }

  // 記事本文の画像（アプリからアップロードしたもの）
  const imgSrc = path.join(APP, 'site/assets/img');
  if (fs.existsSync(imgSrc)) {
    const copyDir = (from, to) => {
      mkdir(to);
      fs.readdirSync(from, { withFileTypes: true }).forEach((e) => {
        const f = path.join(from, e.name);
        const t = path.join(to, e.name);
        if (e.isDirectory()) return copyDir(f, t);
        if (!/\.(png|jpg|jpeg|webp)$/i.test(e.name)) return;
        fs.copyFileSync(f, t);
        after += fs.statSync(t).size;
      });
    };
    copyDir(imgSrc, path.join(DIST, 'assets/img'));
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

// 記事末の「ほかの商品も見る」欄。
// 商品ページ以外へのリンクでも、そこから購入されれば紹介料の対象になります。
function rankingLinks(keyword, ctx) {
  const malls = [
    ['amazon', 'Amazonで探す', 'https://www.amazon.co.jp/s?k=' + encodeURIComponent(keyword)],
    ['rakuten', '楽天市場で探す', 'https://search.rakuten.co.jp/search/mall/' + encodeURIComponent(keyword) + '/'],
  ];
  if (config.showYahoo) {
    malls.push(['yahoo', 'Yahoo!ショッピングで探す',
      'https://shopping.yahoo.co.jp/search?p=' + encodeURIComponent(keyword)]);
  }
  const buttons = malls.map(([mall, label, url]) => {
    const href = affiliate.link(mall, url, ctx.moshimo);
    if (!href) return '';
    return '<a class="pd-btn pd-' + mall + '" href="' + esc(href) + '"'
      + ' target="_blank" rel="nofollow sponsored noopener" data-mall="' + mall + '">'
      + esc(label) + '</a>';
  }).filter(Boolean).join('');
  if (!buttons) return '';
  return '<div class="mall-links"><div class="pd-btns">' + buttons + '</div>'
    + '<p class="pd-note">「' + esc(keyword) + '」の検索結果が開きます。'
    + '掲載していない商品も探せます。</p></div>';
}

// ---- まだ書いていない記事へのリンク ----
// 記事ができていればリンクになり、無ければ文字のまま出ます。
// カードに出す短い説明。文の途中でぶつ切りにならないよう、句点で切ります。
function shortDesc(text) {
  const t = String(text).trim();
  if (t.length <= 56) return t;
  const cut = t.slice(0, 56);
  const at = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('、'));
  return at >= 24 ? cut.slice(0, at + 1) : cut.slice(0, 46) + '…';
}

function makeLinkResolver(ctx) {
  // 同じ記事のカードが何枚も出ないよう、1記事につき1回だけにします
  const carded = new Set();
  return (slug, label) => {
    const a = ctx.bySlug[slug];
    if (!a || a.status !== 'publish') {
      return { html: '<span class="link-todo" title="記事ができたらリンクになります">' + esc(label) + '</span>' };
    }
    const html = '<a href="/' + esc(slug) + '/">' + esc(label) + '</a>';
    if (carded.has(slug)) return { html };
    carded.add(slug);
    return {
      html,
      card: '<a class="related-link has-img" href="/' + esc(slug) + '/">'
        + '<img src="' + esc(cardImage(a)) + '" alt="" loading="lazy">'
        + '<span class="rel-text"><small>関連記事</small>'
        + '<strong>' + esc(a.title) + '</strong>'
        + (a.description ? '<em>' + esc(shortDesc(a.description)) + '</em>' : '')
        + '</span></a>',
    };
  };
}

function buildSingle(a, prev, next, ctx) {
  const cat = categoryOf(a.category);
  const md = replaceLegacyProductLines(a.body);
  const r = markdown.render(md, {
    product: (id) => productCard(id, ctx),
    ranking: (kw) => rankingLinks(kw, ctx),
    link: makeLinkResolver(ctx),
  });

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

  const banner = ctx.draft
    ? '<div class="draft-note">この記事は<b>下書き</b>です。手元の確認用に書き出したもので、'
      + 'サイトには公開されていません。</div>' : '';

  write(`${a.slug}/index.html`, layout({
    path: `/${a.slug}/`, title: a.title, description: a.description,
    image: a.eyecatch, type: 'article', bodyClass: 'single',
    noindex: !!ctx.draft,
    content: banner + content, ...ctx,
  }));
}

// お問い合わせフォームの埋め込み。
// 静的サイトではPHPが動かないため、Googleフォームをiframeで読み込みます。
function contactForm() {
  if (!config.contactFormUrl) {
    return '<p class="lead">お問い合わせフォームは準備中です。'
      + 'しばらくお待ちください。</p>';
  }
  return '<div class="contact-form"><iframe src="' + esc(config.contactFormUrl) + '"'
    + ' width="100%" height="900" frameborder="0" marginheight="0" marginwidth="0"'
    + ' loading="lazy" title="お問い合わせフォーム">読み込んでいます…</iframe></div>';
}

function buildPage(p, ctx) {
  const r = markdown.render(p.body, {
    product: (id) => productCard(id, ctx),
    ranking: (kw) => rankingLinks(kw, ctx),
    link: makeLinkResolver(ctx),
  });
  let body = r.html.replace(/\{\{contact-form\}\}/g, () => contactForm());
  // 目次は記事と同じく、最初の見出しの直前に置きます
  if (r.toc) {
    const at = body.indexOf('<h2');
    body = at === -1 ? r.toc + '\n' + body : body.slice(0, at) + r.toc + '\n' + body.slice(at);
  }
  const content = fill(readTpl('page.html'), { TITLE: esc(p.title), TOC: '', BODY: body });
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

function buildExtras(published, ctx, extra) {
  // 404
  const notFound = `<main class="archive-main page-width">
  <header class="archive-header"><h1>ページが見つかりませんでした</h1></header>
  <p>お探しのページは移動または削除された可能性があります。</p>
  <p><a class="pink-button" href="/">トップページへ戻る</a></p>
</main>`;
  write('404.html', layout({ path: '/404.html', title: 'ページが見つかりませんでした', noindex: true, content: notFound, ...ctx }));

  // sitemap.xml
  const urls = ['/'].concat(published.map((a) => `/${a.slug}/`))
    .concat((extra && extra.pages || []).map((p) => `/${p.slug}/`))
    .concat(config.categories.map((c) => `/category/${c.slug}/`));
  write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((u) => `  <url><loc>${config.url}${u}</loc></url>`).join('\n')
    + '\n</urlset>\n');

  // robots.txt
  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${config.url}/sitemap.xml\n`);

  // Cloudflare Pages が配る *.pages.dev のURLを検索結果に出さない。
  // 本番（toco-to.com）と中身が同じなので、両方が拾われると重複扱いになるため。
  // ホスト名にワイルドカードは使えないため、実際のホスト名で指定します。
  // 2行目はプレビュー用のデプロイ（<ハッシュ>.<プロジェクト>.pages.dev）向け。
  if (config.pagesDevHost) {
    write('_headers', [
      `https://${config.pagesDevHost}/*`,
      '  X-Robots-Tag: noindex',
      '',
      `https://:preview.${config.pagesDevHost}/*`,
      '  X-Robots-Tag: noindex',
      '',
    ].join('\n'));
  }

  // 検索用のインデックス
  write('search-index.json', JSON.stringify(published.map((a) => ({
    t: a.title, u: `/${a.slug}/`, c: a.category, d: a.description,
  }))));
}

// ---------- 実行 ----------

function build(opts) {
  const options = opts || {};
  const started = Date.now();
  const settings = DB.loadSettings();
  const list = products.load();
  const byId = {};
  list.forEach((p) => { byId[p.id] = p; });
  const ctx = {
    year: options.year || 2026,
    assetVer: options.assetVer || '1',
    products: byId,
    moshimo: settings.moshimo || {},
  };

  fs.rmSync(DIST, { recursive: true, force: true });
  mkdir(DIST);

  const assets = buildAssets();

  const all = loadMarkdownDir(ARTICLES, 'article');
  const published = all.filter((a) => a.status === 'publish')
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // 下書きは通常のビルドには含めません（公開されてしまうため）。
  // options.includeDrafts のときだけ、手元のプレビュー用に書き出します。
  // 一覧・サイトマップ・検索には入れず、noindex を付けます。
  const drafts = options.includeDrafts
    ? all.filter((a) => a.status !== 'publish') : [];

  // {{link:…}} の解決先。記事だけでなく固定ページにもリンクできるようにします。
  ctx.bySlug = {};
  all.forEach((a) => { ctx.bySlug[a.slug] = a; });
  loadMarkdownDir(PAGES, 'page').forEach((p) => {
    ctx.bySlug[p.slug] = Object.assign({}, p, { status: 'publish' });
  });

  published.forEach((a, i) => buildSingle(a, published[i + 1], published[i - 1], ctx));
  drafts.forEach((a) => buildSingle(a, null, null, Object.assign({}, ctx, { draft: true })));

  config.categories.forEach((c) => {
    buildArchive(`/category/${c.slug}/`, c.name, published.filter((a) => a.category === c.slug), ctx);
  });

  const pages = loadMarkdownDir(PAGES, 'page');
  pages.forEach((p) => buildPage(p, ctx));

  buildFrontPage(published, ctx);
  buildExtras(published, ctx, { pages });

  return {
    ms: Date.now() - started,
    articles: published.length,
    drafts: drafts.length,
    pages: pages.length,
    imagesBefore: assets.imagesBefore,
    imagesAfter: assets.imagesAfter,
  };
}

// 公開前チェックのプレビュー用。
// 本番のビルドと同じ関数を通すので、見た目が食い違いません。
function renderArticle(md) {
  const settings = DB.loadSettings();
  const byId = {};
  products.load().forEach((p) => { byId[p.id] = p; });
  const ctx = { products: byId, moshimo: settings.moshimo || {}, bySlug: {} };
  loadMarkdownDir(ARTICLES, 'article').forEach((a) => { ctx.bySlug[a.slug] = a; });
  loadMarkdownDir(PAGES, 'page').forEach((p) => {
    ctx.bySlug[p.slug] = Object.assign({}, p, { status: 'publish' });
  });
  const r = markdown.render(String(md || ''), {
    product: (id) => productCard(id, ctx),
    ranking: (kw) => rankingLinks(kw, ctx),
    link: makeLinkResolver(ctx),
  });
  return { html: r.html, toc: r.toc, headings: r.headings };
}

module.exports = { build, parseFrontMatter, loadMarkdownDir, renderArticle };

if (require.main === module) {
  const r = build({ year: new Date(2026, 8, 3).getFullYear() });
  const mb = (n) => (n / 1048576).toFixed(2) + 'MB';
  console.log(`ビルド完了 ${r.ms}ms`);
  console.log(`  記事 ${r.articles}本（下書き ${r.drafts}本）／固定ページ ${r.pages}枚`);
  console.log(`  画像 ${mb(r.imagesBefore)} → ${mb(r.imagesAfter)}`);
}
