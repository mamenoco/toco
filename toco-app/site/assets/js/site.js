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
