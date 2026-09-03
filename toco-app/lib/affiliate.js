// もしもアフィリエイトのリンクを組み立てる
//
// もしもには公開APIがありません。ただしリンクを作るのに必要なのはAPIではなく
// 「リンクの型」だけです。
//
//   https://af.moshimo.com/af/c/click?a_id=…&p_id=…&pc_id=…&pl_id=…&url=商品ページのURL
//                                     └──── 広告主ごとに常に同じ値 ────┘
//
// 管理画面で一度だけリンクを発行してもらえば、あとは url= を差し替えるだけで
// 何百商品ぶんでも作れます。ポチップが内部でやっているのと同じ仕組みです。

const CLICK = 'https://af.moshimo.com/af/c/click';
const MALLS = ['amazon', 'rakuten', 'yahoo'];

// もしもの「かんたんリンク」のコード、または発行されたクリックURLから
// 広告主ごとのIDを取り出します。どちらの形でも受け付けます。
function parse(text) {
  const src = String(text || '');
  const found = {};

  // ① かんたんリンクのコード（b_l 配列に広告主ごとの情報が入っています）
  const re = /"a_id"\s*:\s*(\d+)\s*,\s*"p_id"\s*:\s*(\d+)\s*,\s*"pl_id"\s*:\s*(\d+)\s*,\s*"pc_id"\s*:\s*(\d+)\s*,\s*"s_n"\s*:\s*"([a-z]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    const mall = m[5];
    if (MALLS.includes(mall)) {
      found[mall] = { a_id: m[1], p_id: m[2], pl_id: m[3], pc_id: m[4] };
    }
  }

  // ② クリックURLを直接貼られた場合
  if (!Object.keys(found).length) {
    const urls = src.match(/https?:\/\/af\.moshimo\.com\/af\/c\/click\?[^\s"'<>]+/g) || [];
    urls.forEach((u) => {
      const q = new URLSearchParams(u.split('?')[1] || '');
      const ids = {};
      ['a_id', 'p_id', 'pc_id', 'pl_id'].forEach((k) => { if (q.get(k)) ids[k] = q.get(k); });
      if (Object.keys(ids).length < 4) return;
      // 飛び先から、どの広告主のリンクかを判断する
      const target = q.get('url') || '';
      const mall = /amazon\./.test(target) ? 'amazon'
        : /rakuten\./.test(target) ? 'rakuten'
        : /yahoo\./.test(target) || /paypaymall/.test(target) ? 'yahoo' : null;
      if (mall) found[mall] = ids;
    });
  }

  return found;
}

// 設定に保存する形（画面から見て分かるように、テンプレートの文字列も持たせます）
function toTemplates(found) {
  const out = {};
  Object.keys(found).forEach((mall) => {
    const v = found[mall];
    out[mall] = {
      a_id: v.a_id, p_id: v.p_id, pc_id: v.pc_id, pl_id: v.pl_id,
      preview: `${CLICK}?a_id=${v.a_id}&p_id=${v.p_id}&pc_id=${v.pc_id}&pl_id=${v.pl_id}&url={{URL}}`,
    };
  });
  return out;
}

// 実際のリンクを作る
function link(mall, targetUrl, templates) {
  const t = templates && templates[mall];
  if (!t || !targetUrl) return '';
  return `${CLICK}?a_id=${t.a_id}&p_id=${t.p_id}&pc_id=${t.pc_id}&pl_id=${t.pl_id}`
    + `&url=${encodeURIComponent(targetUrl)}`;
}

// 商品から、各モールの飛び先URLを決める
//   ・Amazon は ASIN があれば商品ページ、無ければ検索ページ
//   ・楽天は商品ページ（APIで取得したURL）
function targets(product, opts) {
  const options = opts || {};
  const t = {};

  if (product.amazon && product.amazon.asin) {
    t.amazon = `https://www.amazon.co.jp/dp/${product.amazon.asin}`;
  } else if (options.amazonSearchFallback !== false && product.name) {
    t.amazon = 'https://www.amazon.co.jp/s?k=' + encodeURIComponent(product.name);
  }

  if (product.rakuten && product.rakuten.url) {
    // 楽天APIが返すURLには rafcid（ウェブサービス側のトラッキング）が付くことがあります。
    // もしも経由の成果計測と競合しないよう、余計なパラメータは落とします。
    t.rakuten = String(product.rakuten.url).split('?')[0];
  } else if (product.name) {
    t.rakuten = 'https://search.rakuten.co.jp/search/mall/' + encodeURIComponent(product.name) + '/';
  }

  if (product.yahoo && product.yahoo.url) t.yahoo = product.yahoo.url;

  return t;
}

// ASINを商品ページのURLから取り出す（貼り付けを楽にするため）
function asinFromUrl(url) {
  const m = String(url || '').match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : '';
}

module.exports = { parse, toTemplates, link, targets, asinFromUrl, MALLS, CLICK };
