// 商品検索とレビュー取得（楽天ウェブサービス）
// （server.js から切り出したものです。処理内容は変えていません）

const fs = require("fs");
const path = require("path");

// ---------- 外部アクセスの制御 ----------
// レビューページの取得は連続アクセスを避けるため、最短間隔をあけます。
const MIN_INTERVAL_MS = 3000;
let lastFetchAt = 0;

async function politeFetch(url) {
  const wait = Math.max(0, lastFetchAt + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept-Language': 'ja,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`取得できませんでした（HTTP ${res.status}）`);
  return await res.text();
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t　]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- 楽天 商品検索 ----------

// 2026年の仕様変更で、applicationId（UUID）に加えて accessKey が必須になりました。
// accessKey は秘密の値なので、URLではなくヘッダーで送ります。
async function rakutenSearch(appId, accessKey, keyword, hits) {
  if (!accessKey) {
    throw new Error('設定画面で「アクセスキー」も登録してください（2026年からApplication IDだけでは使えません）。');
  }
  const url =
    'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701' +
    `?applicationId=${encodeURIComponent(appId)}` +
    `&keyword=${encodeURIComponent(keyword)}` +
    `&hits=${hits || 30}&sort=-reviewCount&imageFlag=1`;
  const res = await fetch(url, { headers: { accessKey } });
  const json = await res.json().catch(() => ({}));
  if (json.error) {
    let msg = json.error_description || json.error;
    if (/applicationId/i.test(msg)) {
      msg += '（管理画面の Application ID と Access Key が正しいか、'
        + '「Allowed IP addresses」にいまのIPが登録されているかを確認してください）';
    }
    throw new Error(`楽天API: ${msg}`);
  }
  if (!res.ok) throw new Error(`楽天API: HTTP ${res.status}`);
  return (json.Items || []).map((w) => {
    const i = w.Item || w;
    return {
      id: newId(),
      name: i.itemName,
      code: i.itemCode,
      url: i.itemUrl,
      price: i.itemPrice,
      reviewCount: i.reviewCount,
      reviewAverage: i.reviewAverage,
      shop: i.shopName,
      image: (i.mediumImageUrls && i.mediumImageUrls[0] && i.mediumImageUrls[0].imageUrl) || '',
      caption: (i.itemCaption || '').slice(0, 600),
      specs: {},
      reviewText: '',
      reviewUrl: '',
    };
  });
}

// ---------- レビューページの取得 ----------

async function fetchReviewText(itemUrl) {
  const itemHtml = await politeFetch(itemUrl);
  const m = itemHtml.match(/https:\/\/review\.rakuten\.co\.jp\/item\/1\/[0-9]+_[0-9]+\/1\.1\//);
  if (!m) throw new Error('レビューページが見つかりませんでした');
  const reviewUrl = m[0];
  const reviewHtml = await politeFetch(reviewUrl);
  let text = htmlToText(reviewHtml);
  // 絞り込みUIなどの前置きを落として、レビュー本体から始める
  for (const marker of ['この条件で探す', 'レビュー一覧']) {
    const i = text.indexOf(marker);
    if (i > 0) { text = text.slice(i + marker.length); break; }
  }
  const cut = text.indexOf('ショップ内の関連商品');
  if (cut > 0) text = text.slice(0, cut);
  text = text.replace(/\n\s*(さらに表示|参考になった|不適切レビュー報告)\s*\n/g, '\n');
  return { reviewUrl, text: text.replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000) };
}


module.exports = { politeFetch, htmlToText, rakutenSearch, fetchReviewText };
