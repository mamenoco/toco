// Markdown → 記事HTML
//
// server.js の mdToHtml を静的サイト用に移したものです。
// 変更点は3つ。
//   1. WordPress のブロックコメント（<!-- wp:paragraph --> など）を出さない
//   2. h2 / h3 に必ず id を振り、目次を組み立てられるようにした
//   3. {{product:xxx}} を商品カードに置き換えられるようにした
//
// CSS は theme-original/wp-custom-css.css をそのまま使うため、
// 付けるクラス名（lead / brand / catch / affiliate-note / point-links /
// related-link / jump-link / table-scroll）は変更していません。

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// {{link:スラッグ|表示する文字}} を解決する関数。render() のあいだだけ差し込みます。
// 解決先が公開済みの記事なら、文中をリンクにしたうえで、
// その段落の下に記事カード（アイキャッチ＋タイトル）を出します。
let LINK_RESOLVER = null;
let LINK_CARDS = [];

function inline(t) {
  return t
    // まだ書いていない記事へのリンク。記事ができたら自動でリンクに変わります。
    .replace(/\{\{link:([^}|]+)(?:\|([^}]*))?\}\}/g, (m, slug, label) => {
      const s = slug.trim();
      const l = (label || slug).trim();
      if (!LINK_RESOLVER) return l;
      const r = LINK_RESOLVER(s, l);
      if (typeof r === 'string') return r;
      if (r && r.card) LINK_CARDS.push(r.card);
      return (r && r.html) || l;
    })
    // ==テキスト== でマーカー。リンク記法をまたぐこともあるので、いちばん先に処理します。
    // 後回しにすると、置き換えたHTMLの中の = と衝突して効かなくなります。
    .replace(/==([^\n]+?)==/g, '<mark class="hl">$1</mark>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

// 見出しの id。
// 日本語をそのまま id にすると URL が #%E3%81%86... と長くなるため、
// 記事側で <a id="..."></a> を書いていない見出しは短い連番にします。
function autoHeadingId(seq) {
  return "toc-" + seq;
}

const BOLD_ONLY = /^\*\*(.+)\*\*$/;

// render(md, opts) → { html, toc, headings }
//   opts.product(id) … {{product:xxx}} を置き換えるHTMLを返す関数
// 出力したHTMLの最初のタグに data-ln="開始行,終了行" を足します。
// 画面のプレビューから「本文のどこを直せばよいか」を引けるようにするためです。
function withLine(html, from, to) {
  return String(html).replace(/^(\s*<[a-zA-Z][a-zA-Z0-9]*)/, `$1 data-ln="${from},${to}"`);
}

function render(md, opts) {
  const options = opts || {};
  const trackSource = !!options.trackSource;
  const product = options.product || ((id) => `<!-- product not found: ${esc(id)} -->`);
  const ranking = options.ranking || (() => '');
  const card = options.card || (() => '');
  LINK_RESOLVER = options.link || null;
  LINK_CARDS = [];
  const pendingLinks = [];
  if (!options.link) {
    // 解決先が渡されていないときは、リンク待ちとして記録だけしておきます
    LINK_RESOLVER = (slug, label) => { pendingLinks.push({ slug, label }); return esc(label); };
  }

  const src = String(md || '')
    .replace(/<!--[\s\S]*?-->/g, '')      // 公開前チェックなどのコメントは落とす
    .replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const out = [];
  const headings = [];        // 目次の材料 { level, text, id }
  let i = 0;
  let boldSinceHeading = 0;   // 見出しからあとに出てきた太字だけの行の数
  let inProductSection = false;
  let inFaq = false;
  let pendingAnchor = null;
  let idSeq = 0;
  const usedIds = new Set();

  // 「選び方」の箇条書きを各見出しへのリンクにするための下準備
  const headingText = new Set();
  lines.forEach((l) => {
    const m = l.trim().match(/^###\s+(.+)$/);
    if (m) headingText.add(m[1].trim());
  });
  const autoId = {};
  let autoSeq = 0;

  // 直前の行に記事カードが溜まっていれば、その行のすぐ下に出します。
  let blockStart = 0;
  const push = (html) => {
    out.push(trackSource ? withLine(html, blockStart, Math.max(blockStart, i - 1)) : html);
    if (LINK_CARDS.length) {
      out.push('<div class="rel-cards">' + LINK_CARDS.join('') + '</div>');
      LINK_CARDS = [];
    }
  };
  const para = (html, cls) => push(`<p${cls ? ` class="${cls}"` : ''}>${html}</p>`);

  const uniqueId = (base) => {
    let id = base;
    let n = 2;
    while (usedIds.has(id)) id = base + '-' + (n++);
    usedIds.add(id);
    return id;
  };

  const flushPara = (buf) => {
    if (!buf.length) return;
    para(inline(buf.join('')));
    buf.length = 0;
  };

  while (i < lines.length) {
    blockStart = i;
    const raw = lines[i];
    const line = raw.trim();

    if (!line) { i++; continue; }

    // 単体のアンカーは覚えておき、次の見出しの id にする
    const am = line.match(/^<a id="([^"]+)"><\/a>$/);
    if (am) { pendingAnchor = am[1]; i++; continue; }

    // 画像。単独の行に ![キャプション](パス) と書きます。
    // キャプションは figcaption と alt の両方に使います。
    const im = line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+(\d+)x(\d+))?\)$/);
    if (im) {
      const cap = im[1].trim();
      const size = im[3] ? ` width="${im[3]}" height="${im[4]}"` : '';
      push('<figure class="ph"><img src="' + esc(im[2]) + '" alt="' + esc(cap) + '"'
        + size + ' loading="lazy" decoding="async">'
        + (cap ? '<figcaption>' + esc(cap) + '</figcaption>' : '') + '</figure>');
      i++; continue;
    }

    // 商品カード
    const pm = line.match(/^\{\{product:([A-Za-z0-9_-]+)\}\}$/);
    if (pm) { push(product(pm[1])); i++; continue; }

    // 各モールの検索結果へのリンク（記事末の「ほかの商品も見る」欄）
    const rm = line.match(/^\{\{ranking:(.+)\}\}$/);
    if (rm) { push(ranking(rm[1].trim())); i++; continue; }

    // 記事カード。好きな場所に置けます。
    // {{link:…}} が文中のリンク＋カードなのに対し、こちらはカードだけです。
    const cm = line.match(/^\{\{card:([a-z0-9-]+)\}\}$/);
    if (cm) { push(card(cm[1])); i++; continue; }

    // 見出し
    let m = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) {
      const lv = m[1].length;
      if (lv === 1) { pendingAnchor = null; i++; continue; }  // h1 は記事タイトルを使う
      if (lv === 2) {
        inProductSection = /おすすめ.*選/.test(m[2]);
        inFaq = /よくある質問|Q&A|FAQ/i.test(m[2]);
      }
      if (lv >= 3) boldSinceHeading = 0;
      const text = m[2].trim();
      const auto = lv === 3 ? autoId[text] : null;
      // h2 / h3 は目次に載せるので必ず id を持たせる
      const anchor = pendingAnchor || auto
        || (lv <= 3 ? uniqueId(autoHeadingId(++idSeq)) : null);
      if (anchor) usedIds.add(anchor);
      const idAttr = anchor ? ` id="${anchor}"` : '';
      const cls = (lv === 3 && inFaq) ? ' class="faq-q"' : '';
      push(`<h${lv}${idAttr}${cls}>${inline(text)}</h${lv}>`);
      if (lv <= 3 && anchor) headings.push({ level: lv, text: text.replace(/\*\*/g, ''), id: anchor });
      pendingAnchor = null;
      i++; continue;
    }
    pendingAnchor = null;

    // 区切り線
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      push('<hr class="wp-block-separator has-alpha-channel-opacity"/>');
      i++; continue;
    }

    // すでにHTMLの行はそのまま
    if (/^<[a-zA-Z!/]/.test(line)) { push(line); i++; continue; }

    // アフィリエイト表記
    if (/^※.*アフィリエイト広告が含まれ/.test(line)) {
      para(inline(line), 'affiliate-note');
      i++; continue;
    }

    // 「〜を今すぐ見る」のリンクはボタンにする
    if (/今すぐ見る/.test(line)) {
      const lm = line.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) { para(`<a class="jump-link" href="${lm[2]}">${lm[1]} ›</a>`); i++; continue; }
    }

    // 引用
    if (/^>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      const paras = buf.join('\n').split(/\n\s*\n/)
        .map((x) => `<p>${inline(x.replace(/\n/g, '<br>'))}</p>`).join('');
      push(`<blockquote class="wp-block-quote">${paras}</blockquote>`);
      continue;
    }

    // 表
    if (/^\|/.test(line)) {
      const rows = [];
      let hasSeparator = false;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) hasSeparator = true;
        else rows.push(cells);
        i++;
      }
      const cols = rows.length ? Math.max(...rows.map((r) => r.length)) : 0;
      let head = '';
      let bodyRows = rows;
      if (hasSeparator && cols >= 3 && rows.length > 1) {
        head = '<thead><tr>' + rows[0].map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead>';
        bodyRows = rows.slice(1);
      }
      const body = bodyRows.map((r) =>
        '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('');
      const wide = cols >= 3;   // 3列以上は横スクロールできるようにする
      push(`<figure class="wp-block-table${wide ? ' table-scroll' : ''}">`
        + `<table>${head}<tbody>${body}</tbody></table></figure>`);
      continue;
    }

    // 箇条書き
    if (/^([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].trim().replace(/^([-*]|\d+\.)\s+/, ''));
        i++;
      }

      // 項目がすべて後ろの h3 と一致するなら、その見出しへのリンクにする
      if (!ordered && items.length >= 2 && items.every((t) => headingText.has(t))) {
        const li = items.map((t) => {
          if (!autoId[t]) { autoId[t] = 'point-' + (++autoSeq); usedIds.add(autoId[t]); }
          return `<li><a href="#${autoId[t]}">${inline(t)}</a></li>`;
        }).join('\n');
        push(`<ul class="wp-block-list point-links">\n${li}\n</ul>`);
        continue;
      }

      // 「関連記事：[タイトル](URL)」だけの並びはカードにする
      const rels = items.map((t) => t.match(/^関連記事[：:]\s*\[([^\]]+)\]\(([^)]+)\)$/));
      if (rels.every(Boolean)) {
        rels.forEach((r) => push(
          `<a class="related-link" href="${r[2]}"><small>関連記事</small><span>${r[1]}</span></a>`));
        continue;
      }

      const li = items.map((t) => `<li>${inline(t)}</li>`).join('\n');
      const tag = ordered ? 'ol' : 'ul';
      push(`<${tag} class="wp-block-list">\n${li}\n</${tag}>`);
      continue;
    }

    // 太字だけの行
    //   「おすすめ○選」の中：商品の一文キャッチ
    //   それ以外（選び方など）：そのセクションの結論をあらわす1文
    // ※ メーカー名は商品カードに出るので、本文には書きません。
    const bm = line.match(BOLD_ONLY);
    if (bm) {
      boldSinceHeading++;
      para(inline(bm[1]), inProductSection ? 'catch' : 'lead');
      i++; continue;
    }

    // 通常の段落
    const start = i;
    const buf = [];
    while (i < lines.length && lines[i].trim()
      && !/^([#>|]|[-*]\s|\d+\.\s|<[a-zA-Z!/]|\{\{|!\[)/.test(lines[i].trim())
      && !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())) {
      buf.push(lines[i].trim());
      i++;
    }
    flushPara(buf);

    // どの分岐にも当てはまらず、行が1つも進まなかった場合の保険。
    // ここを抜かすと無限ループになります（{{product:…}} 以外の {{…}} など）。
    if (i === start) { push(inline(line)); i++; }
  }

  LINK_RESOLVER = null;
  return { html: out.join('\n'), headings, toc: buildToc(headings), pendingLinks };
}

// 目次を組み立てる。
// Table of Contents Plus と同じHTML構造にしてあるので、
// 追加CSS（#toc_container / ul.toc_list / .toc_number …）がそのまま効きます。
function buildToc(headings) {
  // 目次に出すのは h2 だけ。h3まで出すと項目が多すぎて、目次として機能しなくなります。
  const items = headings.filter((h) => h.level === 2);
  if (items.length < 2) return '';

  const html = items.map((h, i) =>
    `<li><a href="#${h.id}"><span class="toc_number toc_depth_1">${i + 1}</span> ${esc(h.text)}</a></li>`
  ).join('');

  return '<div id="toc_container">'
    + '<p class="toc_title">目次 <span class="toc_toggle">[<a href="#" role="button">非表示</a>]</span></p>'
    + `<ul class="toc_list">${html}</ul>`
    + '</div>';
}

module.exports = { render, esc, inline };
