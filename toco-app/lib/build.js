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

// いま見ているページのメニュー項目に印を付けます。
// リンク先が完全に一致したものだけを「現在地」とみなすので、
// トップの中の位置を指す `/#categories` のような項目は光りません。
function menuHtml(currentPath) {
  return '<ul class="menu">'
    + config.menu.map(([label, href]) => {
      // ページ送り（/category/column/page/2/）も同じ項目の現在地として扱います
      const here = !!currentPath && (href === currentPath
        || (href !== '/' && href.endsWith('/') && currentPath.startsWith(href)));
      return `<li${here ? ' class="current-menu-item"' : ''}>`
        + `<a href="${esc(href)}"${here ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`;
    }).join('')
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
  <a class="pickup-image" href="/${esc(a.slug)}/"><img src="${esc(cardImage(a))}" alt="" loading="lazy"><span class="cat-tag cat-${esc(cat.slug || 'other')}">${esc(cat.name)}</span></a>
  <h3><a href="/${esc(a.slug)}/">${esc(a.title)}</a></h3>
  <time datetime="${esc(a.date)}">${formatDate(a.date)}</time>
</article>`;
}

function columnRow(a) {
  return `<a class="column-row" href="/${esc(a.slug)}/">
  <img src="${esc(cardImage(a))}" alt="" loading="lazy">
  <span><strong>${esc(a.title)}</strong><time datetime="${esc(a.date)}">${formatDate(a.date)}</time></span><i aria-hidden="true"></i>
</a>`;
}

function archiveCard(a, withTags) {
  // タグはカード全体のリンクの外に置きます。
  // リンクの中にリンクを入れることはできないためです。
  const tags = withTags !== false && (a.tags || []).length
    ? `\n  <div class="archive-tags">`
      + a.tags.map((t) => `<a href="/tag/${encodeURIComponent(t)}/">#${esc(t)}</a>`).join('')
      + `</div>` : '';
  return `<article class="archive-card"><a href="/${esc(a.slug)}/">
  <img src="${esc(cardImage(a))}" alt="" loading="lazy">
  <div><time>${formatDate(a.date)}</time><h2>${esc(a.title)}</h2></div>
</a>${tags}</article>`;
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
    o.robots ? `<meta name="robots" content="${esc(o.robots)}">`
      : (o.noindex ? '<meta name="robots" content="noindex, nofollow">'
                   : '<meta name="robots" content="index, follow, max-image-preview:large">'),
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
    MENU: menuHtml(o.path),
    FOOTERMENU: menuHtml(o.path),
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
      // まだ公開していない記事のカード（プレビューでだけ見えます）
      '.link-todo-card{margin:0 0 1.8em;padding:12px 16px;border:1px dashed #e0c9c4;'
      + 'border-radius:10px;background:#fffaf6;color:#a3968f;font-size:12px}',
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
      // メインビジュアルはスライダーではないので丸印を外した。その高さぶんの余白を足す
      [
        '.category-section{padding-top:52px}',
        '@media(max-width:600px){.category-section{padding-top:46px}}',
      ].join(''),
      // ピックアップ記事の横スライド。
      // 旧テーマは5件を並べるだけの格子でしたが、15件を左右に送れる形にしました。
      // 格子の指定と噛み合わないので、display を flex に変えて上書きしています。
      [
        '.pickup-viewport{position:relative}',
        '.pickup-grid{display:flex;gap:24px;overflow-x:auto;overscroll-behavior-x:contain;',
        'scroll-snap-type:x mandatory;scroll-behavior:smooth;scrollbar-width:none;',
        '-ms-overflow-style:none;padding-bottom:2px}',
        '.pickup-grid::-webkit-scrollbar{width:0;height:0}',
        '.pickup-grid:focus-visible{outline:2px solid var(--pink);outline-offset:4px;border-radius:10px}',
        '.pickup-card{flex:0 0 calc((100% - 96px)/5);scroll-snap-align:start}',
        // 左右のボタン。JSが必要なときだけ出します（押せない側は消えます）
        '.pickup-nav{position:absolute;top:32%;z-index:3;width:40px;height:40px;',
        'display:grid;place-items:center;padding:0;border:1px solid var(--line);border-radius:50%;',
        'background:rgba(255,255,255,.94);color:var(--pink-dark);cursor:pointer;',
        'transform:translateY(-50%);box-shadow:0 4px 14px rgba(90,68,59,.14);',
        'transition:box-shadow .2s ease,opacity .2s ease}',
        '.pickup-nav:hover{box-shadow:0 6px 18px rgba(90,68,59,.22)}',
        '.pickup-nav[disabled]{opacity:0;pointer-events:none}',
        '.pickup-nav.prev{left:-8px}',
        '.pickup-nav.next{right:-8px}',
        '.pickup-nav svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;',
        'stroke-linecap:round;stroke-linejoin:round}',
        '@media(max-width:900px){.pickup-grid{gap:20px}',
        '.pickup-card{flex-basis:calc((100% - 40px)/3)}}',
        // スマホは指で送るのでボタンは出さず、次のカードが少し見える幅にします
        '@media(max-width:600px){.pickup-nav{display:none}',
        '.pickup-grid{gap:14px}',
        '.pickup-card{flex-basis:76%;display:block}',
        '.pickup-image{aspect-ratio:1.55}',
        '.pickup-card h3{margin:13px 0 6px}}',
      ].join(''),
      // メニューの現在地。
      // 旧テーマは「1つめの項目（ホーム）を常に光らせる」作りだったので、
      // どのページでもホームに線が付いたままでした。現在地の項目だけに付け直します。
      [
        '.nav-inner li:first-child>a{color:inherit}',
        '.nav-inner li:first-child>a::after{content:none}',
        '.nav-inner li.current-menu-item>a{color:var(--pink-dark)}',
        '.nav-inner li.current-menu-item>a::after{content:"";position:absolute;',
        'right:0;bottom:0;left:0;height:3px;border-radius:3px 3px 0 0;background:var(--pink)}',
        // スマホのメニュー（ハンバーガーを押して出てくる方）も同じ作りだったので直します
        '.mobile-nav-sheet li:first-child a{color:inherit}',
        '.mobile-nav-sheet li.current-menu-item a{color:var(--pink-dark)}',
      ].join(''),
      // ヘッダーの検索窓。
      // 旧テーマではボタンを押すと別の入力欄（検索ドロワー）が開く作りでしたが、
      // 入力欄が2つ見えて分かりにくいので、この窓に直接入力する形にしました。
      [
        '.search-pill{cursor:auto}',
        '.search-pill input{flex:1;min-width:0;height:100%;padding:0;border:0;outline:0;',
        'background:transparent;color:var(--ink);font-family:inherit;font-size:12px;cursor:text}',
        '.search-pill input::placeholder{color:#a1948f;opacity:1}',
        '.search-pill input::-webkit-search-cancel-button{cursor:pointer}',
        '.search-pill button{width:38px;height:38px;flex:0 0 auto;display:grid;place-items:center;',
        'padding:0;border:0;border-radius:50%;color:#fff;background:var(--pink);cursor:pointer;',
        'transition:filter .15s ease}',
        '.search-pill button:hover{filter:brightness(1.05)}',
        '.search-pill:focus-within{border-color:var(--pink)}',
        // 900px以下では窓が丸ボタンだけに縮むので、押したら検索ページへ送ります
        '@media(max-width:900px){.search-pill input{display:none}}',
        '@media(max-width:600px){.search-pill button{width:36px;height:36px}}',
      ].join(''),
      // 検索結果ページ
      [
        '.archive-header .search-page-form{display:flex;max-width:520px;height:44px;margin:18px 0 0}',
        '.search-page-form input{flex:1;min-width:0;padding:0 18px;border:1px solid var(--line);',
        'border-right:0;border-radius:999px 0 0 999px;outline:0;background:#fff;font-size:14px}',
        '.search-page-form input:focus{border-color:var(--pink)}',
        '.search-page-form button{width:96px;border:0;border-radius:0 999px 999px 0;color:#fff;',
        'background:var(--pink);font-size:13px;font-weight:600;cursor:pointer}',
        '.search-summary{margin:16px 0 24px;color:var(--text);font-size:13px}',
        '.search-note{margin-top:8px;padding:22px 24px;border:1px solid var(--line);',
        'border-radius:16px;background:#fffdfa}',
        '.search-note p{margin:0 0 14px;font-size:13px}',
        '.search-cats{display:flex;flex-wrap:wrap;gap:9px}',
        '.search-cats a{padding:8px 15px;border:1px solid #eadfd9;border-radius:999px;',
        'background:#fff;font-size:12px;text-decoration:none;transition:box-shadow .2s ease}',
        '.search-cats a:hover{box-shadow:var(--shadow)}',
        '@media(max-width:600px){.archive-header .search-page-form{height:42px}',
        '.search-page-form button{width:76px}.search-note{padding:18px 16px}}',
      ].join(''),
      // 一覧のカード。スマホでは2枚ずつ横に並べます
      [
        '@media(max-width:600px){',
        '.archive-grid{grid-template-columns:1fr 1fr;gap:12px}',
        '.archive-card div{padding:12px}',
        '.archive-card h2{font-size:13px;line-height:1.55}',
        '.archive-card time{font-size:9px}',
        '.archive-tags{margin-top:-4px;padding:0 12px 12px;gap:5px}',
        '.archive-tags a{padding:3px 8px;font-size:9px}}',
      ].join(''),
      // 一覧ページの見出しの下に出すキーワード
      [
        '.archive-keywords{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:14px 0 0}',
        '.archive-keywords>span{color:#a3968f;font-size:11px;letter-spacing:.06em}',
        '.archive-keywords a{padding:6px 13px;border:1px solid #eadfd9;border-radius:999px;',
        'background:#fff;color:var(--text);font-size:12px;text-decoration:none;',
        'transition:color .15s ease,box-shadow .2s ease}',
        '.archive-keywords a:hover{color:var(--pink-dark);box-shadow:var(--shadow)}',
        '.archive-header{margin-bottom:26px}',
        '@media(max-width:600px){.archive-keywords{gap:6px;margin-top:12px}',
        '.archive-keywords a{padding:5px 11px;font-size:11px}}',
      ].join(''),
      // 一覧カードのタグ（カテゴリ一覧・タグ一覧）
      [
        '.archive-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:-6px;padding:0 18px 16px}',
        '.archive-tags a{padding:4px 10px;border:1px solid #eadfd9;border-radius:999px;',
        'background:#fffdfa;color:#a3968f;font-size:10px;text-decoration:none;',
        'transition:color .15s ease,border-color .15s ease}',
        '.archive-tags a:hover{color:var(--pink-dark);border-color:#eec9cd}',
        '@media(max-width:600px){.archive-tags{padding:0 14px 14px}}',
      ].join(''),
      // 記事に付いているタグ
      [
        '.entry-tags{display:flex;flex-wrap:wrap;gap:9px;margin:34px 0 0}',
        '.entry-tags a{padding:7px 14px;border:1px solid #eadfd9;border-radius:999px;',
        'background:#fff;color:var(--text);font-size:12px;text-decoration:none;',
        'transition:box-shadow .2s ease,color .15s ease}',
        '.entry-tags a:hover{color:var(--pink-dark);box-shadow:var(--shadow)}',
        '@media(max-width:600px){.entry-tags{gap:7px;margin-top:26px}',
        '.entry-tags a{padding:6px 12px;font-size:11px}}',
      ].join(''),
      // 記事末の「同じカテゴリの記事」
      [
        '.related-posts{margin-top:52px;padding-top:34px;border-top:1px solid var(--line)}',
        '.related-posts h2{margin:0 0 22px;padding:0;border:0;background:none;',
        'font-family:"Zen Maru Gothic",sans-serif;font-size:20px;letter-spacing:.04em;text-align:center}',
        '.related-posts h2::before{content:"";display:inline-block;width:26px;height:26px;',
        'margin-right:9px;vertical-align:-6px;',
        "background:url('../images/flower-sprig.png') center/contain no-repeat}",
        '.related-grid{display:grid;grid-template-columns:1fr;gap:18px}',
        '.related-posts .archive-card h3{margin:5px 0 0;font-size:14px;line-height:1.6}',
        '.related-posts .archive-card div{padding:14px}',
        // ボタンの文言はカテゴリ名ぶん長くなるので、幅を中身に合わせる
        '.related-posts .wide-pink-button{width:auto;max-width:100%;height:auto;min-height:42px;',
        'padding:11px 26px;margin-top:26px;justify-self:center;line-height:1.6;text-align:center}',
        '@media(min-width:601px){',
        '.related-grid{grid-template-columns:repeat(3,minmax(0,1fr))}',
        // 2件・1件のときに余白が右に寄らないよう、列数を合わせる
        '.related-grid:not(:has(> :nth-child(3))){grid-template-columns:repeat(2,minmax(0,1fr))}',
        '.related-grid:not(:has(> :nth-child(2))){grid-template-columns:minmax(0,340px);',
        'justify-content:center}}',
        '@media(max-width:600px){.related-posts{margin-top:38px;padding-top:26px}',
        '.related-posts h2{font-size:17px}',
        '.related-grid{gap:14px}}',
      ].join(''),
      // ピックアップのカテゴリ札。掲載順ではなくカテゴリごとに色を決める
      [
        '.pickup-card .pickup-image span{color:#fff;background:rgba(232,138,155,.92)}',
        '.pickup-card .pickup-image span.cat-food{color:#fff;background:rgba(232,138,155,.92)}',
        '.pickup-card .pickup-image span.cat-house{color:#8a6835;background:rgba(246,219,158,.95)}',
        '.pickup-card .pickup-image span.cat-toy{color:#fff;background:rgba(166,201,121,.94)}',
        '.pickup-card .pickup-image span.cat-care{color:#fff;background:rgba(190,152,211,.93)}',
        '.pickup-card .pickup-image span.cat-life{color:#8a5a42;background:rgba(251,199,175,.96)}',
        '.pickup-card .pickup-image span.cat-column{color:#fff;background:rgba(136,196,196,.94)}',
      ].join(''),
      // コラム一覧の矢印。文字の「›」は円の中で右下にずれるので、線で描き直す
      [
        '.column-row i{font-size:0;line-height:0}',
        '.column-row i::before{content:"";width:6px;height:6px;',
        'border-top:1.5px solid currentColor;border-right:1.5px solid currentColor;',
        'transform:translateX(-2px) rotate(45deg)}',
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

// 単独の記事カード（{{card:スラッグ}}）
function articleCard(slug, ctx) {
  const a = ctx.bySlug[slug];
  if (!a) return '<!-- 記事が見つかりません: ' + esc(slug) + ' -->';
  if (a.status !== 'publish') {
    return '<div class="link-todo-card">' + esc(a.title)
      + '（下書きのため、公開されるとカードが出ます）</div>';
  }
  return '<div class="rel-cards"><a class="related-link has-img" href="/' + esc(slug) + '/">'
    + '<img src="' + esc(cardImage(a)) + '" alt="" loading="lazy">'
    + '<span class="rel-text"><small>あわせて読みたい</small>'
    + '<strong>' + esc(a.title) + '</strong>'
    + (a.description ? '<em>' + esc(shortDesc(a.description)) + '</em>' : '')
    + '</span></a></div>';
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

// 記事に付いているタグ。押すとそのタグの一覧ページへ行きます
function tagList(a) {
  const tags = a.tags || [];
  if (!tags.length) return '';
  return '        <nav class="entry-tags" aria-label="この記事のタグ">'
    + tags.map((t) => `<a href="/tag/${encodeURIComponent(t)}/">#${esc(t)}</a>`).join('')
    + '</nav>';
}

// 記事の下に出す「同じカテゴリの記事」。新しい順に最大3件、自分自身は除く
function relatedPosts(a, ctx) {
  const list = (ctx.published || [])
    .filter((x) => x.category === a.category && x.slug !== a.slug)
    .slice(0, 3);
  if (!list.length) return '';
  const cat = categoryOf(a.category);
  const cards = list.map((x) => `<article class="archive-card"><a href="/${esc(x.slug)}/">
    <img src="${esc(cardImage(x))}" alt="" loading="lazy">
    <div><time datetime="${esc(x.date)}">${formatDate(x.date)}</time><h3>${esc(x.title)}</h3></div>
  </a></article>`).join('\n');
  return `        <section class="related-posts" aria-labelledby="related-posts-heading">
            <h2 id="related-posts-heading">${esc(cat.name)}の記事</h2>
            <div class="related-grid">
${cards}
            </div>
            <a class="wide-pink-button" href="/category/${esc(cat.slug)}/">${esc(cat.name)}の記事をもっと見る</a>
        </section>
`;
}

function buildSingle(a, prev, next, ctx) {
  const cat = categoryOf(a.category);
  const md = replaceLegacyProductLines(a.body);
  const r = markdown.render(md, {
    // うさぎと暮らして何年か。書き出すたびに計算し直します。
    years: markdown.yearsSince(config.rabbitSince),
    product: (id) => productCard(id, ctx),
    ranking: (kw) => rankingLinks(kw, ctx),
    link: makeLinkResolver(ctx),
    card: (slug) => articleCard(slug, ctx),
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
    TAGLIST: tagList(a),
    RELATED: relatedPosts(a, ctx),
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
    // うさぎと暮らして何年か。書き出すたびに計算し直します。
    years: markdown.yearsSince(config.rabbitSince),
    product: (id) => productCard(id, ctx),
    ranking: (kw) => rankingLinks(kw, ctx),
    link: makeLinkResolver(ctx),
    card: (slug) => articleCard(slug, ctx),
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
    // ページにもアイキャッチを反映します。SNSで共有したときの画像になります。
    image: p.eyecatch,
    bodyClass: 'page', content, ...ctx,
  }));
}

// 一覧ページ（カテゴリ・タグ）を書き出します。
//   dir   … 書き出す場所。タグは日本語のフォルダ名になります
//   url   … ページのURL。日本語は %E3%81… の形に直したものを渡します
//   title … <title> に使う文言（省略時は heading）
function buildArchive(o, ctx) {
  const dir = o.dir;
  const url = o.url || dir;
  const list = o.list || [];
  const per = config.archivePerPage;
  const pages = Math.max(1, Math.ceil(list.length / per));
  for (let i = 0; i < pages; i++) {
    const items = list.slice(i * per, (i + 1) * per);
    const cards = items.length
      ? items.map((x) => archiveCard(x, o.cardTags !== false)).join('\n')
      : '<p>記事が見つかりませんでした。</p>';
    let pagination = '';
    if (pages > 1) {
      const links = [];
      for (let n = 1; n <= pages; n++) {
        const href = n === 1 ? url : `${url}page/${n}/`;
        links.push(n === i + 1
          ? `<span class="page-numbers current">${n}</span>`
          : `<a class="page-numbers" href="${href}">${n}</a>`);
      }
      pagination = `<nav class="navigation pagination"><div class="nav-links">${links.join('')}</div></nav>`;
    }
    const content = fill(readTpl('archive.html'), {
      HEADING: esc(o.heading), KEYWORDS: keywordBar(o.keywords), CARDS: cards, PAGINATION: pagination,
    });
    const out = i === 0 ? `${dir}index.html` : `${dir}page/${i + 1}/index.html`;
    write(out.replace(/^\//, ''), layout({
      path: i === 0 ? url : `${url}page/${i + 1}/`,
      title: o.title || o.heading,
      // 検索結果には出さないが、ここから記事へはたどってほしいので follow のまま
      robots: o.noindex ? 'noindex, follow' : '',
      bodyClass: 'archive', content, ...ctx,
    }));
  }
}

// 一覧ページの見出しの下に出すキーワード。多く使われている順に並べます
function keywordBar(names) {
  if (!names || !names.length) return '';
  return '<div class="archive-keywords"><span>キーワード</span>'
    + names.map((t) => `<a href="/tag/${encodeURIComponent(t)}/">#${esc(t)}</a>`).join('')
    + '</div>';
}

// 記事の集まりから、使われているタグを多い順に取り出します
function keywordsOf(list) {
  const counts = {};
  list.forEach((a) => (a.tags || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  return Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'ja'));
}

// 公開記事に付いているタグを、使われている数の多い順に集めます
function tagIndex(published) {
  const byTag = {};
  published.forEach((a) => (a.tags || []).forEach((t) => {
    if (!byTag[t]) byTag[t] = [];
    byTag[t].push(a);
  }));
  return Object.keys(byTag)
    .sort((a, b) => byTag[b].length - byTag[a].length || a.localeCompare(b, 'ja'))
    .map((name) => ({
      name,
      list: byTag[name],
      dir: `/tag/${name}/`,
      url: `/tag/${encodeURIComponent(name)}/`,
      // 記事が1本しかないタグは中身が薄いので、検索結果には出しません
      indexable: byTag[name].length >= (config.tagIndexMin || 1),
    }));
}

function buildFrontPage(published, ctx) {
  const cards = config.categories.filter((c) => c.slug !== 'column').map((c, i) =>
    `<a class="category-card card-${i + 1}" href="/category/${c.slug}/">
  <span class="category-art category-art-${i + 1}" aria-hidden="true"></span>
  <strong>${esc(c.name)}</strong>
  <small>${c.lead}</small>
</a>`).join('\n');

  const pickup = published.slice(0, 15);
  let columns = published.filter((a) => a.category === 'column').slice(0, 5);
  if (!columns.length) columns = pickup.slice(0, 5);

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
    .concat(config.categories.map((c) => `/category/${c.slug}/`))
    .concat(((extra && extra.tags) || []).filter((t) => t.indexable).map((t) => t.url));
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

  // ワードプレス時代のURLの引き取り先（一覧は site-config.js の redirects）。
  // 上から順に見て、最初に一致した行が使われます。
  const rules = config.redirects || [];
  const width = rules.reduce((w, [from]) => Math.max(w, from.length), 0);
  write('_redirects', rules
    .map(([from, to]) => `${from.padEnd(width + 2)}${to}  301`)
    .concat([''])
    .join('\n'));

  // 検索結果ページ。中身はブラウザ側で search-index.json から組み立てます。
  // 検索結果そのものは検索エンジンに載せない（noindex, follow）のが通例です。
  const catLinks = config.categories
    .map((c) => `<a href="/category/${esc(c.slug)}/">${esc(c.name)}</a>`).join('');
  write('search/index.html', layout({
    path: '/search/', title: '検索結果', noindex: true, bodyClass: 'archive search',
    content: fill(readTpl('search.html'), { CATLINKS: catLinks }), ...ctx,
  }));

  // 検索用のインデックス
  write('search-index.json', JSON.stringify(published.map((a) => ({
    t: a.title, u: `/${a.slug}/`, c: categoryOf(a.category).name, d: a.description,
    g: cardImage(a), dt: formatDate(a.date), iso: a.date, tg: a.tags || [],
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

  ctx.published = published;

  published.forEach((a, i) => buildSingle(a, published[i + 1], published[i - 1], ctx));
  drafts.forEach((a) => buildSingle(a, null, null, Object.assign({}, ctx, { draft: true })));

  config.categories.forEach((c) => {
    const list = published.filter((a) => a.category === c.slug);
    buildArchive({
      dir: `/category/${c.slug}/`,
      heading: c.name,
      list,
      // カードごとには出さず、見出しの下にまとめて出します
      cardTags: false,
      keywords: keywordsOf(list),
    }, ctx);
  });

  // タグごとの一覧。記事に付いているタグをすべて拾います
  const tags = tagIndex(published);
  ctx.tags = tags;
  tags.forEach((t) => {
    buildArchive({
      dir: t.dir, url: t.url,
      heading: `#${t.name}`, title: `${t.name}の記事`,
      list: t.list, noindex: !t.indexable,
    }, ctx);
  });

  const pages = loadMarkdownDir(PAGES, 'page');
  pages.forEach((p) => buildPage(p, ctx));

  buildFrontPage(published, ctx);
  buildExtras(published, ctx, { pages, tags });

  return {
    ms: Date.now() - started,
    articles: published.length,
    drafts: drafts.length,
    pages: pages.length,
    tags: tags.length,
    imagesBefore: assets.imagesBefore,
    imagesAfter: assets.imagesAfter,
  };
}

// 公開前チェックのプレビュー用。
// 本番のビルドと同じ関数を通すので、見た目が食い違いません。
function renderArticle(md, opts) {
  const settings = DB.loadSettings();
  const byId = {};
  products.load().forEach((p) => { byId[p.id] = p; });
  const ctx = { products: byId, moshimo: settings.moshimo || {}, bySlug: {} };
  loadMarkdownDir(ARTICLES, 'article').forEach((a) => { ctx.bySlug[a.slug] = a; });
  loadMarkdownDir(PAGES, 'page').forEach((p) => {
    ctx.bySlug[p.slug] = Object.assign({}, p, { status: 'publish' });
  });
  const r = markdown.render(String(md || ''), {
    // うさぎと暮らして何年か。書き出すたびに計算し直します。
    years: markdown.yearsSince(config.rabbitSince),
    product: (id) => productCard(id, ctx),
    ranking: (kw) => rankingLinks(kw, ctx),
    link: makeLinkResolver(ctx),
    card: (slug) => articleCard(slug, ctx),
    trackSource: !!(opts && opts.trackSource),
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
