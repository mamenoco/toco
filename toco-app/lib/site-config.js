// サイト全体の設定。
// WordPress の「一般設定」「カテゴリー」「メニュー」にあたるものをここに置きます。

module.exports = {
  name: 'tocoとくらし',
  tagline: 'うさぎとの毎日を、もっと心地よく。',
  description: 'うさぎのごはんやおうち、おもちゃなど、暮らしに役立つ情報とアイテムをやさしい視点で紹介します。',
  url: 'https://toco-to.com',
  lang: 'ja',

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
    ['はじめての方へ', '/#beginner'],
    ['カテゴリから探す', '/#categories'],
    ['コラム', '/#column'],
    ['おすすめ商品', '/#pickup'],
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
  contactFormUrl: '',

  archivePerPage: 12,
};
