// サイト全体の設定。
// WordPress の「一般設定」「カテゴリー」「メニュー」にあたるものをここに置きます。

module.exports = {
  name: 'tocoとくらし',
  tagline: 'うさぎとの毎日を、もっと心地よく。',
  description: 'うさぎのごはんやおうち、おもちゃなど、暮らしに役立つ情報とアイテムをやさしい視点で紹介します。',
  url: 'https://toco-to.com',
  lang: 'ja',

  // うさぎを迎えた月。本文の {{years}} が、ここからの年数に置き換わります。
  // 「うさぎと暮らして{{years}}年になりますが、」と書いておけば、
  // サイトを書き出すたびに数字が今の年数に更新されます。
  rabbitSince: '2024-04',

  // front-page.php のカテゴリ定義と同じ並び順
  categories: [
    { slug: 'food',   name: 'えさ・牧草',       lead: '主食からおやつまで<br>選び方やおすすめを紹介' },
    { slug: 'house',  name: 'ケージ・サークル', lead: 'おうち選びのポイントや<br>人気アイテムを紹介' },
    { slug: 'toy',    name: 'おもちゃ・用品',   lead: '遊びや運動をサポートする<br>アイテムを紹介' },
    { slug: 'care',   name: 'お手入れ・健康',   lead: '日々のケアや健康管理の<br>ヒントを紹介' },
    { slug: 'life',   name: 'しつけ・暮らし',   lead: '快適に暮らすための<br>コツや工夫を紹介' },
    { slug: 'column', name: 'コラム',           lead: 'うさぎとの暮らしの<br>読みものを紹介' },
  ],

  // 旧テーマの toco_primary_menu_fallback と同じ内容
  menu: [
    ['ホーム', '/'],
    // 独立したページがあるので、トップの案内バナー（/#beginner）ではなく本体へ送ります
    ['はじめての方へ', '/beginner/'],
    ['カテゴリから探す', '/#categories'],
    // コラム一覧のページへ。トップの中のコラム欄（/#column）ではありません
    ['コラム', '/category/column/'],
    ['お問い合わせ', '/contact/'],
  ],

  // タグが1つも無いときにトップへ出す見本
  fallbackTags: ['牧草', 'ケージ選び', 'おもちゃ', 'うさぎの食事', 'ブラッシング', 'しつけ'],

  // 旧サイトのメルマガフォームは送信先が無く機能していないため、当面は出さない
  showNewsletter: false,

  // 画像の書き出しサイズ（表示される最大サイズの2倍を目安に）
  imageMaxSide: {
    'rabbit-botanical.png': 500,
    'hero-rabbit-photo.png': 1160,
    'flower-sprig.png': 220,
    'pencil-original.png': 90,
    'category-icons-strip.png': 1280,
  },

  // 透過が不要な画像はJPEGにする（他は mix-blend-mode: multiply を使うのでPNGのまま）
  imageToJpeg: { "hero-rabbit-photo.png": "hero-rabbit-photo.jpg" },

  // Yahoo!ボタンを出すか（フェーズ1では出さない判断・設計書§3-7）
  showYahoo: false,

  // お問い合わせフォーム（Googleフォームの「埋め込む」で出てくるURL）
  // 空のあいだは、ページに「準備中」の案内が出ます。
  contactFormUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSdvQeXbTaEzkmCt6d3cql9dTwZIQu4p9zm4WZCTpfxmF8Mq0w/viewform?embedded=true',

  // Cloudflare Pages が配るホスト名。
  // 本番（toco-to.com）と中身が同じなので、こちらは検索結果に出さない設定を入れます。
  pagesDevHost: 'toco-17g.pages.dev',

  archivePerPage: 12,

  // タグの一覧ページを検索結果に出す下限。
  // 1本しかないタグのページは中身が薄く、記事本体と競合するため出しません。
  // ページ自体はどのタグにも作られるので、押しても404にはなりません。
  tagIndexMin: 2,

  // ---- WordPress時代のURLの引き取り先 ----
  //
  // 旧サイト（雑貨テーマ）のURLは、新サイトに対応するページがありません。
  // 何もしないと404になるので、ここに書いた行が dist/_redirects になり、
  // Cloudflare Pages が301（恒久的な引っ越し）で転送します。
  //
  // 一覧は Internet Archive に残っていた toco-to.com のURLから拾いました
  // （2026-09-08 時点・記事17本ぶんは監査メモの本数と一致）。
  // 中身がうさぎと無関係な旧記事なので、転送先はすべてトップにしています。
  // 末尾の `*` は「その下の階層すべて」という意味です。
  redirects: [
    // 旧記事（/1534 のような数字だけのURL）
    ['/58', '/'], ['/153', '/'], ['/259', '/'], ['/408', '/'],
    ['/529', '/'], ['/632', '/'], ['/739', '/'], ['/856', '/'],
    ['/976', '/'], ['/1033', '/'], ['/1148', '/'], ['/1239', '/'],
    ['/1336', '/'], ['/1434', '/'], ['/1534', '/'], ['/1624', '/'],
    ['/1729', '/'],

    // 旧カテゴリ。food・house・column は新サイトにも同じURLがあるので触りません
    ['/category/accessory', '/'], ['/category/accessory/*', '/'],
    ['/category/beauty-health', '/'], ['/category/beauty-health/*', '/'],
    ['/category/fashion', '/'], ['/category/fashion/*', '/'],
    ['/category/goods', '/'], ['/category/goods/*', '/'],
    ['/category/goout', '/'], ['/category/goout/*', '/'],
    ['/category/handmade', '/'], ['/category/handmade/*', '/'],
    ['/category/interior', '/'], ['/category/interior/*', '/'],
    ['/category/kids-baby', '/'], ['/category/kids-baby/*', '/'],
    ['/category/toy-2', '/'], ['/category/toy-2/*', '/'],

    // 旧固定ページ
    ['/archive', '/'],
    ['/ranking-top20', '/'],
    ['/sample-page', '/'],

    // 投稿者ページ・一覧の2ページ目
    ['/author/*', '/'],
    ['/page/*', '/'],

    // Yoast が出していたサイトマップ。新しいサイトマップに送ります
    ['/sitemap_index.xml', '/sitemap.xml'],
    ['/post-sitemap.xml', '/sitemap.xml'],
    ['/page-sitemap.xml', '/sitemap.xml'],
    ['/category-sitemap.xml', '/sitemap.xml'],
    ['/author-sitemap.xml', '/sitemap.xml'],

    // RSS
    ['/feed', '/'],
    ['/comments/feed', '/'],
  ],
};
