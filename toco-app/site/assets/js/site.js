// 静的サイト用の追加スクリプト。
// テーマ本体（theme.js）には手を入れず、WordPressのプラグインが担っていた
// 動きだけをここで補います。
(function () {
  // ---- pages.dev では検索結果に出さない ----
  // 本番（toco-to.com）と中身が同じページが2つのURLで見えると、重複として扱われます。
  // _headers でも指定していますが、確実にするためこちらでも入れています。
  if (/\.pages\.dev$/.test(location.hostname)) {
    var meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
  }

  // ---- 目次の開閉（Table of Contents Plus の代替） ----
  var toc = document.getElementById('toc_container');
  if (toc) {
    var toggle = toc.querySelector('.toc_toggle a');
    var list = toc.querySelector('.toc_list');
    if (toggle && list) {
      toggle.addEventListener('click', function (e) {
        e.preventDefault();
        var hidden = list.hasAttribute('hidden');
        if (hidden) { list.removeAttribute('hidden'); toggle.textContent = '非表示'; }
        else { list.setAttribute('hidden', ''); toggle.textContent = '表示'; }
      });
    }
  }

  // ---- ピックアップ記事の横スライド ----
  // スクロールできる状態のときだけ左右のボタンを出します。
  // JSが動かない環境でも、指やトラックパッドで横に送れます。
  initPickupSlider();

  function initPickupSlider() {
    var track = document.querySelector('.pickup-grid');
    var prev = document.querySelector('.pickup-nav.prev');
    var next = document.querySelector('.pickup-nav.next');
    if (!track || !prev || !next) return;

    // カードの左端が並ぶ位置の一覧。
    // ここを送り先にすると、CSSの吸着（scroll-snap）と行き先がずれません。
    function stops() {
      var cards = track.querySelectorAll('.pickup-card');
      var list = [];
      if (!cards.length) return [0];
      var base = cards[0].offsetLeft;
      for (var i = 0; i < cards.length; i++) list.push(cards[i].offsetLeft - base);
      return list;
    }

    // dir が 1 なら先へ、-1 なら戻る。1回で3枚ぶん送ります
    var STEP = 3;

    function go(dir) {
      var list = stops();
      var max = track.scrollWidth - track.clientWidth;
      var now = track.scrollLeft;

      // いま左端に見えているカードが何枚目か
      var index = 0;
      for (var i = 0; i < list.length; i++) {
        if (list[i] <= now + 2) index = i;
      }

      var next = index + dir * STEP;
      if (next < 0) next = 0;
      if (next > list.length - 1) next = list.length - 1;
      var target = Math.min(list[next], max);

      // 右端の手前で止まってしまわないように、進めないときは端まで送ります
      if (dir > 0 && target <= now + 2) target = max;
      if (dir < 0 && target >= now - 2) target = 0;

      // 古いブラウザは scrollTo に指定を渡せないので、その場合は直接動かします
      try {
        track.scrollTo({ left: target, behavior: 'smooth' });
      } catch (e) {
        track.scrollLeft = target;
      }
      // 動き終わったころに、もう一度ボタンの出し分けを合わせます。
      // スクロールの通知だけに頼ると、端に着いたのにボタンが消えないことがあるためです。
      window.setTimeout(update, 450);
      window.setTimeout(update, 950);
    }

    function update() {
      var max = track.scrollWidth - track.clientWidth;
      var canScroll = max > 2;
      prev.hidden = !canScroll;
      next.hidden = !canScroll;
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= max - 2;
    }

    prev.addEventListener('click', function () { go(-1); });
    next.addEventListener('click', function () { go(1); });
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  // ---- 検索結果ページ ----
  // ヘッダーの検索窓は /search/?q=… に飛びます。
  // 静的サイトなので検索する仕組みがサーバー側にありません。
  // ビルド時に書き出した search-index.json を読んで、ブラウザ側で絞り込みます。
  if (/^\/search\/?$/.test(location.pathname)) {
    initSearchPage();
  }

  function normalize(text) {
    var s = String(text || '');
    // 全角の英数字・記号を半角にそろえてから比べます（ＵＳＡ → usa）
    if (s.normalize) s = s.normalize('NFKC');
    return s.toLowerCase();
  }

  function initSearchPage() {
    var results = document.getElementById('search-results');
    var summary = document.getElementById('search-summary');
    var note = document.getElementById('search-note');
    var input = document.getElementById('search-page-input');
    if (!results || !summary) return;

    var q = '';
    try {
      q = (new URLSearchParams(location.search).get('q') || '').trim();
    } catch (e) { q = ''; }
    if (input) input.value = q;
    var headerInput = document.getElementById('header-search-input');
    if (headerInput) headerInput.value = q;
    document.title = (q ? '「' + q + '」の検索結果' : '検索') + '｜tocoとくらし';

    var heading = document.getElementById('search-heading');
    var noteText = document.getElementById('search-note-text');

    if (!q) {
      // まだ何も検索していない状態。「結果」ではないので見出しも変えます
      if (heading) heading.textContent = '検索';
      summary.textContent = 'キーワードを入れて検索してください。';
      if (noteText) noteText.textContent = 'カテゴリから見てみることもできます。';
      if (note) note.hidden = false;
      if (input) input.focus();
      return;
    }

    summary.textContent = '検索しています…';

    fetch('/search-index.json').then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (items) {
      // 空白区切りのことばは、すべて含む記事だけを出します
      var terms = normalize(q).split(/\s+/).filter(Boolean);
      var hits = items.filter(function (a) {
        var hay = normalize([a.t, a.d, a.c].join(' '));
        return terms.every(function (t) { return hay.indexOf(t) !== -1; });
      });

      summary.textContent = hits.length
        ? '「' + q + '」の検索結果：' + hits.length + '件'
        : '「' + q + '」に一致する記事は見つかりませんでした。';
      if (note) note.hidden = hits.length > 0;

      hits.forEach(function (a) { results.appendChild(resultCard(a)); });
    }).catch(function () {
      summary.textContent = '検索できませんでした。時間をおいて試してみてください。';
      if (note) note.hidden = false;
    });
  }

  // 一覧ページのカードと同じ形で組み立てます。
  // 検索語がそのまま入るので、HTMLではなく textContent で入れています。
  function resultCard(a) {
    var card = document.createElement('article');
    card.className = 'archive-card';

    var link = document.createElement('a');
    link.href = a.u;

    var img = document.createElement('img');
    img.src = a.g;
    img.alt = '';
    img.loading = 'lazy';
    link.appendChild(img);

    var body = document.createElement('div');
    var time = document.createElement('time');
    if (a.iso) time.dateTime = a.iso;
    time.textContent = a.dt || '';
    var title = document.createElement('h2');
    title.textContent = a.t;
    body.appendChild(time);
    body.appendChild(title);
    if (a.d) {
      var desc = document.createElement('p');
      desc.textContent = a.d;
      body.appendChild(desc);
    }
    link.appendChild(body);

    card.appendChild(link);
    return card;
  }

  // ---- アフィリエイトボタンのクリック計測（フェーズ2で商品カードが入ったら効きます） ----
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('.pd-btn') : null;
    if (!a || typeof window.gtag !== 'function') return;
    var box = a.closest('[data-product]');
    window.gtag('event', 'affiliate_click', {
      mall: a.dataset.mall || '',
      product: box ? box.dataset.product : '',
      page: location.pathname,
    });
  });
})();
