// tocoとくらし 記事制作アプリ
//
// 記事を書いて、サイトに公開するところまでを1つの画面で行います。
// Node.js の標準モジュールだけで動きます（npm install は不要）。
//
// 処理の中身は lib/ に分かれています。このファイルは受付（ルーティング）だけです。
//   lib/db.js         設定・記事ネタ・持ちもの台帳の保存
//   lib/articles.js   記事ファイル（articles/*.md）の読み書き
//   lib/research.js   楽天の商品検索とレビュー取得
//   lib/brief.js      執筆用の材料（ブリーフ）の書き出し
//   lib/claude.js     Claude Code の呼び出し
//   lib/checks.js     公開前チェック
//   lib/markdown.js   Markdown → HTML
//   lib/build.js      サイトの書き出し
//   lib/deploy.js     Git で公開する
//   lib/fal.js        fal.ai での動画生成
//   lib/stamps.js     動く LINE スタンプの切り出しと zip 化

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DB = require('./lib/db.js');
const articles = require('./lib/articles.js');
const research = require('./lib/research.js');
const { buildBrief } = require('./lib/brief.js');
const claude = require('./lib/claude.js');
const { runChecks } = require('./lib/checks.js');
const markdown = require('./lib/markdown.js');
const builder = require('./lib/build.js');
const deploy = require('./lib/deploy.js');
const siteConfig = require('./lib/site-config.js');
const affiliate = require('./lib/affiliate.js');
const products = require('./lib/products.js');
const curate = require('./lib/curate.js');
const links = require('./lib/links.js');
const similarity = require('./lib/similarity.js');
const imageAI = require('./lib/image-ai.js');
const translate = require('./lib/translate.js');
const preview = require('./lib/preview-server.js');
const fal = require('./lib/fal.js');
const stamps = require('./lib/stamps.js');

const ROOT = __dirname;
const PORT = 4567;
const PREVIEW_PORT = 4569;

// ---------- 応答の道具 ----------

function send(res, code, data, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve({}); }
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
};

// ---------- 記事とプロジェクトのつなぎ ----------

// プロジェクト（作業の記録）と記事ファイルは、スラッグで結び付けます。
function bodyOf(project) {
  if (!project || !project.slug) return '';
  const a = articles.read(project.slug);
  return a ? a.body : '';
}

function metaOf(project) {
  const a = project && project.slug ? articles.read(project.slug) : null;
  return a ? a.meta : {};
}

// プロジェクトの内容を記事ファイルに書き出す
function writeArticle(project, body, patch) {
  const cur = project.slug ? articles.read(project.slug) : null;
  const meta = Object.assign({
    title: project.title || project.keyword || '',
    category: project.category || '',
    status: 'draft',
    date: DB.today(),
  }, cur ? cur.meta : {}, patch || {});
  if (!meta.title) meta.title = project.title || project.keyword || project.slug;
  meta.updated = DB.today();
  return articles.save(project.slug, meta, body != null ? body : (cur ? cur.body : ''));
}

// カテゴリ名（「ケージ・サークル」）とスラッグ（house）はどちらでも受け付ける
function categorySlug(v) {
  const c = siteConfig.categories.find((x) => x.slug === v || x.name === v);
  return c ? c.slug : '';
}

function projectSummary(x) {
  const a = x.slug ? articles.read(x.slug) : null;
  return {
    id: x.id, title: x.title, keyword: x.keyword, category: x.category,
    slug: x.slug || '', status: x.status, createdAt: x.createdAt,
    productCount: (x.products || []).length,
    hasArticle: !!(a && a.body.trim()),
    chars: a ? a.body.length : 0,
    published: !!(a && a.meta.status === 'publish'),
  };
}

// ---------- サイトの状態 ----------

const LAST = { build: null, publish: null };

function siteState() {
  const list = articles.list();
  const d = deploy.state();
  return {
    articles: {
      total: list.length,
      published: list.filter((a) => a.status === 'publish').length,
      draft: list.filter((a) => a.status !== 'publish').length,
      list,
    },
    deploy: d,
    lastBuild: LAST.build,
    lastPublish: LAST.publish,
    previewUrl: `http://localhost:${PREVIEW_PORT}/`,
    siteUrl: siteConfig.url,
    distExists: fs.existsSync(path.join(ROOT, 'dist', 'index.html')),
  };
}

// ---------- ルーティング ----------

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;

  if (!p.startsWith('/api/')) {
    // 公開前チェックのプレビューで、本番と同じ見た目にするためのCSS
    if (p === "/preview.css") {
      const css = path.join(ROOT, "dist", "assets", "css", "site.css");
      if (!fs.existsSync(css)) return send(res, 404, "/* まだビルドされていません */", MIME[".css"]);
      return send(res, 200, fs.readFileSync(css), MIME[".css"]);
    }

    // /assets/ は site/assets/（商品画像・アイキャッチ・ファビコン）から配ります。
    // 画面で商品画像を表示するために必要です。
    if (p.startsWith('/assets/')) {
      const asset = path.join(ROOT, 'site', path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (asset.startsWith(path.join(ROOT, 'site')) && fs.existsSync(asset) && fs.statSync(asset).isFile()) {
        return send(res, 200, fs.readFileSync(asset),
          MIME[path.extname(asset)] || 'application/octet-stream');
      }
      return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    }
    // /videos/ は fal.ai で作った動画（toco-app/videos/）を配ります。
    if (p.startsWith('/videos/')) {
      const v = path.join(fal.OUT_DIR, path.basename(p));
      if (fs.existsSync(v) && fs.statSync(v).isFile()) {
        return send(res, 200, fs.readFileSync(v), MIME[path.extname(v)] || 'video/mp4');
      }
      return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    }
    // /stamps/ は切り出したスタンプ（toco-app/stamps/）を配ります。
    if (p.startsWith('/stamps/')) {
      const rel = path.normalize(decodeURIComponent(p.slice('/stamps/'.length))).replace(/^(\.\.[/\\])+/, '');
      const f = path.join(stamps.STAMP_DIR, rel);
      if (f.startsWith(stamps.STAMP_DIR) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        return send(res, 200, fs.readFileSync(f), f.endsWith('.zip') ? 'application/zip' : 'image/png');
      }
      return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    }
    const file = p === '/' ? '/index.html' : p;
    const full = path.join(ROOT, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return send(res, 200, fs.readFileSync(full), MIME[path.extname(full)] || 'application/octet-stream');
    }
    return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }

  const db = DB.loadDb();
  const settings = DB.loadSettings();
  const body = req.method === 'POST' ? await readBody(req) : {};

  try {
    // ===== 全体の状態 =====
    if (p === '/api/state') {
      if (!db.ideas) { db.ideas = DB.seedIdeas(); DB.saveDb(db); }
      return send(res, 200, {
        settings,
        inventory: db.inventory,
        ideas: db.ideas,
        projects: db.projects.map(projectSummary),
        site: siteState(),
        categories: siteConfig.categories,
        productCount: products.load().length,
      });
    }

    // ===== 設定 =====
    if (p === '/api/settings/save') {
      return send(res, 200, { ok: true, settings: DB.saveSettings(body) });
    }

    // ===== もしもアフィリエイト =====
    // 管理画面で発行したリンク（かんたんリンクのコード、またはクリックURL）を
    // そのまま貼ってもらい、広告主ごとのIDを取り出して保存します。
    if (p === '/api/settings/moshimo') {
      const found = affiliate.parse(body.text || '');
      const malls = Object.keys(found);
      if (!malls.length) {
        return send(res, 200, { error: 'リンクを読み取れませんでした。もしもの「かんたんリンク」のコードを、そのまま貼り付けてください。' });
      }
      const tpl = affiliate.toTemplates(found);
      const merged = Object.assign({}, settings.moshimo || {}, tpl);
      DB.saveSettings({ moshimo: merged });
      return send(res, 200, { ok: true, malls, moshimo: merged });
    }

    // ===== 商品マスタ =====
    if (p === '/api/products') {
      return send(res, 200, {
        products: products.markOwned(products.load(), db.inventory),
        moshimo: settings.moshimo || {},
      });
    }

    if (p === '/api/products/save') {
      const src = body.product || {};
      if (!src.name) return send(res, 200, { error: '商品名を入れてください' });
      const id = src.id || products.suggestId(src.idHint || src.name);
      // Amazonの商品ページURLを貼られたら、ASINを取り出します
      if (src.amazonUrl) src.amazon = Object.assign({}, src.amazon, { asin: affiliate.asinFromUrl(src.amazonUrl) });
      delete src.amazonUrl; delete src.idHint;
      return send(res, 200, { ok: true, product: products.upsert(Object.assign({}, src, { id })) });
    }

    // クリップボードの取り込み。
    // 画面で「取り込みモード」を開いているあいだだけ呼ばれます。
    // Amazonの商品URL以外は返さないので、関係のない内容がアプリに渡ることはありません。
    if (p === '/api/clipboard/amazon') {
      let text = '';
      try { text = execSync('pbpaste', { encoding: 'utf8', timeout: 3000 }); }
      catch (e) { return send(res, 200, { asin: '', url: '' }); }
      const m = String(text).match(/https?:\/\/(?:www\.)?amazon\.co\.jp\/[^\s"'<>]*/);
      if (!m) return send(res, 200, { asin: '', url: '' });
      const asin = affiliate.asinFromUrl(m[0]);
      return send(res, 200, { asin, url: asin ? m[0] : '' });
    }

    if (p === '/api/products/delete') {
      products.remove(body.id);
      return send(res, 200, { ok: true });
    }

    // 記事で選んだ商品を、まとめて商品マスタに登録します
    if (p === '/api/products/from-picked') {
      const pr = db.projects.find((x) => x.id === body.id);
      if (!pr) return send(res, 200, { error: '記事が見つかりません' });
      const made = (pr.products || []).map((item) => {
        const existing = products.load().find((x) =>
          (x.rakuten && item.code && x.rakuten.itemCode === item.code) || x.name === item.name);
        return products.upsert(products.fromSearchItem(item, {
          id: existing ? existing.id : undefined,
          category: categorySlug(pr.category),
          brand: existing ? existing.brand : '',
        }));
      });
      return send(res, 200, { ok: true, products: made });
    }

    // 商品カードの下書き（記事に貼る記法）
    if (p === '/api/products/snippet') {
      return send(res, 200, { snippet: '{{product:' + String(body.id || '') + '}}' });
    }

    if (p === '/api/settings/test-rakuten') {
      if (!settings.rakutenAppId) return send(res, 200, { error: '楽天アプリIDを入力してください。' });
      const items = await research.rakutenSearch(settings.rakutenAppId,
        settings.rakutenAccessKey, 'うさぎ 牧草', 1);
      return send(res, 200, { ok: true, sample: items[0] ? items[0].name : '（該当なし）' });
    }

    if (p === '/api/myip') {
      const get = async (url) => {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
          return (await r.text()).trim();
        } catch (e) { return ''; }
      };
      const ipv4 = await get('https://api.ipify.org');
      const any = await get('https://api64.ipify.org');
      return send(res, 200, { ipv4, ipv6: any && any !== ipv4 ? any : '' });
    }

    // ===== 持ちもの台帳 =====
    if (p === '/api/inventory/save') {
      if (body.id) {
        const i = db.inventory.findIndex((x) => x.id === body.id);
        if (i >= 0) db.inventory[i] = Object.assign(db.inventory[i], body);
      } else {
        db.inventory.push(Object.assign({ id: DB.newId(), notes: [] }, body));
      }
      DB.saveDb(db);
      return send(res, 200, { ok: true, inventory: db.inventory });
    }

    if (p === '/api/inventory/delete') {
      db.inventory = db.inventory.filter((x) => x.id !== body.id);
      DB.saveDb(db);
      return send(res, 200, { ok: true, inventory: db.inventory });
    }

    if (p === '/api/inventory/note') {
      const it = db.inventory.find((x) => x.id === body.id);
      if (it) {
        it.notes = it.notes || [];
        it.notes.unshift({ date: DB.today(), text: body.text });
        DB.saveDb(db);
      }
      return send(res, 200, { ok: true, inventory: db.inventory });
    }

    // ===== 記事ネタ =====
    if (p === '/api/ideas/save') {
      db.ideas = db.ideas || DB.seedIdeas();
      if (body.id) {
        const i = db.ideas.findIndex((x) => x.id === body.id);
        if (i >= 0) db.ideas[i] = Object.assign(db.ideas[i], body);
      } else {
        db.ideas.push(Object.assign({ id: DB.newId(), status: '未着手', priority: '中', projectId: null }, body));
      }
      DB.saveDb(db);
      return send(res, 200, { ok: true, ideas: db.ideas });
    }

    if (p === '/api/ideas/add-many') {
      db.ideas = db.ideas || DB.seedIdeas();
      const lines = String(body.text || '').split('\n').map((s) => s.trim()).filter(Boolean);
      lines.forEach((line) => {
        const parts = line.split(/\s*[\/｜|,、]\s*/);
        db.ideas.push({
          id: DB.newId(), title: parts[0], keyword: parts[1] || parts[0],
          category: body.category || '', priority: '中', note: '',
          status: '未着手', projectId: null,
        });
      });
      DB.saveDb(db);
      return send(res, 200, { ok: true, ideas: db.ideas, added: lines.length });
    }

    if (p === '/api/ideas/delete') {
      db.ideas = (db.ideas || []).filter((x) => x.id !== body.id);
      DB.saveDb(db);
      return send(res, 200, { ok: true, ideas: db.ideas });
    }

    if (p === '/api/ideas/start') {
      const idea = (db.ideas || []).find((x) => x.id === body.id);
      if (!idea) return send(res, 200, { error: '記事ネタが見つかりません' });
      const pr = newProject(db, {
        title: idea.title, keyword: idea.keyword, category: idea.category,
        slug: idea.slug || '',
        ideaId: idea.id, ideaNote: idea.note || '',
      });
      idea.status = '作成中';
      idea.projectId = pr.id;
      DB.saveDb(db);
      return send(res, 200, { ok: true, project: pr });
    }

    // ===== 記事（プロジェクト） =====
    if (p === '/api/project/create') {
      const pr = newProject(db, body);
      DB.saveDb(db);
      return send(res, 200, { ok: true, project: pr });
    }

    if (p === '/api/project/get') {
      const pr = db.projects.find((x) => x.id === u.searchParams.get('id'));
      if (!pr) return send(res, 200, { project: null });
      return send(res, 200, {
        project: Object.assign({}, pr, { article: bodyOf(pr), meta: metaOf(pr) }),
        inventory: db.inventory,
        categories: siteConfig.categories,
      });
    }

    if (p === '/api/project/update') {
      const i = db.projects.findIndex((x) => x.id === body.id);
      if (i < 0) return send(res, 200, { error: '記事が見つかりません' });
      const patch = Object.assign({}, body);
      delete patch.article;
      db.projects[i] = Object.assign(db.projects[i], patch);
      DB.saveDb(db);
      if (body.article != null) writeArticle(db.projects[i], body.article);
      return send(res, 200, { ok: true, project: projectSummary(db.projects[i]) });
    }

    if (p === '/api/project/delete') {
      const gone = db.projects.find((x) => x.id === body.id);
      db.projects = db.projects.filter((x) => x.id !== body.id);
      if (gone && gone.ideaId) {
        const idea = (db.ideas || []).find((x) => x.id === gone.ideaId);
        if (idea) { idea.status = '未着手'; idea.projectId = null; }
      }
      DB.saveDb(db);
      if (gone && gone.slug && body.deleteArticle) articles.remove(gone.slug);
      return send(res, 200, { ok: true });
    }

    // 記事カードとして差し込める先の一覧
    if (p === '/api/link-targets') {
      const list = articles.list()
        .filter((a) => a.status === 'publish')
        .map((a) => ({ slug: a.slug, title: a.title, kind: '記事' }));
      const pagesDir = path.join(ROOT, '..', 'pages');
      if (fs.existsSync(pagesDir)) {
        fs.readdirSync(pagesDir).filter((f) => f.endsWith('.md')).forEach((f) => {
          const slug = f.replace(/\.md$/, '');
          const { meta } = articles.parse(fs.readFileSync(path.join(pagesDir, f), 'utf8'));
          list.push({ slug, title: meta.title || slug, kind: 'ページ' });
        });
      }
      return send(res, 200, { targets: list });
    }

    // ===== 記事内リンクの待ち行列 =====
    // 本文の {{link:スラッグ|文字}} を集めて、まだ書いていない記事を一覧にします。
    if (p === '/api/links/pending') {
      return send(res, 200, { links: links.scan() });
    }

    // リンク待ちを記事ネタに登録する
    if (p === '/api/links/to-idea') {
      db.ideas = db.ideas || DB.seedIdeas();
      const exists = db.ideas.find((x) => x.slug === body.slug);
      if (exists) return send(res, 200, { ok: true, ideas: db.ideas, already: true });
      db.ideas.push({
        id: DB.newId(),
        title: body.title || body.label || body.slug,
        keyword: body.keyword || body.label || body.slug,
        slug: body.slug,
        category: body.category || '',
        priority: '高', note: `「${body.from || ''}」からリンク待ち`,
        status: '未着手', projectId: null,
      });
      DB.saveDb(db);
      return send(res, 200, { ok: true, ideas: db.ideas });
    }

    // ===== 記事ファイル =====
    if (p === '/api/article/save') {
      const pr = db.projects.find((x) => x.id === body.id);
      if (!pr) return send(res, 200, { error: '記事が見つかりません' });

      let patchEye = '';
      // スラッグを変えるときはファイル名も変える（URLが変わるので注意が要る）
      if (body.slug && body.slug !== pr.slug) {
        if (!articles.isValidSlug(body.slug)) {
          return send(res, 200, { error: 'URLは英小文字・数字・ハイフンだけで入力してください' });
        }
        if (pr.slug && articles.read(pr.slug)) articles.rename(pr.slug, body.slug);
        // アイキャッチはスラッグ名で保存しているので、一緒に付け替えます
        const eyeDir = path.join(ROOT, 'site', 'assets', 'eyecatch');
        ['png', 'jpg'].forEach((ext) => {
          const from = path.join(eyeDir, `${pr.slug}.${ext}`);
          if (fs.existsSync(from)) {
            fs.renameSync(from, path.join(eyeDir, `${body.slug}.${ext}`));
            patchEye = `/assets/eyecatch/${body.slug}.${ext}`;
          }
        });
        pr.slug = body.slug;
      }

      const patch = {};
      if (patchEye) patch.eyecatch = patchEye;
      ['title', 'description', 'eyecatch', 'date'].forEach((k) => {
        if (body[k] != null) patch[k] = body[k];
      });
      if (body.category != null) { patch.category = categorySlug(body.category); pr.category = body.category; }
      if (body.tags != null) {
        patch.tags = Array.isArray(body.tags) ? body.tags
          : String(body.tags).split(/[,、]/).map((s) => s.trim()).filter(Boolean);
      }
      if (body.status != null) patch.status = body.status === 'publish' ? 'publish' : 'draft';
      if (body.title != null) pr.title = body.title;

      const saved = writeArticle(pr, body.article != null ? body.article : null, patch);
      pr.status = saved.meta.status === 'publish' ? '公開' : '下書き';

      // 記事ネタ側の状態も合わせます。合っていないと一覧が実態とずれます。
      if (pr.ideaId) {
        const idea = (db.ideas || []).find((x) => x.id === pr.ideaId);
        if (idea) {
          idea.status = saved.meta.status === 'publish' ? '公開' : '作成中';
          if (!idea.slug && pr.slug) idea.slug = pr.slug;
        }
      }
      DB.saveDb(db);
      return send(res, 200, { ok: true, article: saved, project: projectSummary(pr) });
    }

    // ===== 商品検索・口コミ =====
    // 候補の自動選出。
    // 楽天の検索結果は同じ商品が複数ショップから出てくるため、
    // まとめてから人気・評価・価格帯で10点前後に絞ります。
    if (p === '/api/search/curate') {
      if (!settings.rakutenAppId) {
        return send(res, 200, { error: '設定画面で楽天アプリIDを登録してください。' });
      }
      const keyword = String(body.keyword || '').trim();
      if (!keyword) return send(res, 200, { error: 'キーワードを入れてください' });

      // 1ページ30件が上限なので、2ページ取って母数を増やします
      const opts = { ng: String(body.ng || '').trim(), genreId: String(body.genreId || '').trim() };
      let items = [];
      for (let page = 1; page <= 2; page++) {
        const part = await research.rakutenSearch(settings.rakutenAppId,
          settings.rakutenAccessKey, keyword, 30, page, opts);
        items = items.concat(part);
        if (part.length < 30) break;
        await new Promise((r) => setTimeout(r, 1100));   // 連続アクセスを避ける
      }

      const r = curate.curate(items, { want: Number(body.want) || 10, inventory: db.inventory });
      return send(res, 200, r);
    }

    if (p === '/api/search') {
      if (!settings.rakutenAppId) {
        return send(res, 200, { error: '設定画面で楽天アプリIDを登録してください。' });
      }
      const items = await research.rakutenSearch(settings.rakutenAppId,
        settings.rakutenAccessKey, body.keyword, body.hits, 1,
        { ng: String(body.ng || '').trim(), genreId: String(body.genreId || '').trim() });
      return send(res, 200, { items });
    }

    if (p === '/api/reviews/fetch') {
      const pr = db.projects.find((x) => x.id === body.projectId);
      if (!pr) return send(res, 200, { error: '記事が見つかりません' });
      const prod = (pr.products || []).find((x) => x.id === body.productId);
      if (!prod) return send(res, 200, { error: '商品が見つかりません' });
      if (prod.reviewText) return send(res, 200, { ok: true, cached: true, product: prod });
      const r = await research.fetchReviewText(prod.url);
      prod.reviewUrl = r.reviewUrl;
      prod.reviewText = r.text;
      DB.saveDb(db);
      return send(res, 200, { ok: true, product: prod });
    }

    // ===== ブリーフ =====
    if (p === '/api/brief') {
      const pr = db.projects.find((x) => x.id === body.id);
      if (!pr) return send(res, 200, { error: '記事が見つかりません' });
      registerPicked(pr);          // 先にIDを確定させてからブリーフに書く
      const md = buildBrief(pr, db.inventory);
      const dir = path.join(ROOT, '..', 'articles', 'briefs');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${(pr.keyword || 'brief').replace(/[\/\\:*?"<>|\s]/g, '_')}-${pr.id}.md`);
      fs.writeFileSync(file, md, 'utf8');
      return send(res, 200, { ok: true, path: file, markdown: md });
    }

    // ===== Claude Code =====
    if (p === '/api/ai/run') {
      const pr = db.projects.find((x) => x.id === body.id);
      if (!pr) return send(res, 200, { error: '記事が見つかりません' });
      const current = body.article != null ? body.article : bodyOf(pr);

      if (body.mode === 'revise') {
        if (!current.trim()) return send(res, 200, { error: '先に記事の本文が必要です。' });
        if (!(body.instruction || '').trim()) {
          return send(res, 200, { error: 'どこをどう直すか、指示を書いてください。' });
        }
      }

      if (body.mode === 'write') registerPicked(pr);   // 商品IDを確定させてから書かせる
      const brief = body.mode === 'write' ? buildBrief(pr, db.inventory) : '';
      const prompt = claude.buildPrompt(body.mode, pr, body.instruction || '', brief, current);
      const jobId = DB.newId();
      claude.startClaude(jobId, prompt, settings.aiModel, {
        // 進捗の目安。書き直しは元の長さ、新規は記事1本ぶんの目安を使います。
        expected: body.mode === 'revise' ? (current.length || 8000) : 10000,
        workFile: claude.workPaths(pr).article,
        baseText: body.mode === 'revise' ? current : '',
        baseLength: current.length,
        protectedBefore: claude.protectedBlocks ? claude.protectedBlocks(current) : [],
      });
      return send(res, 200, { ok: true, jobId });
    }

    if (p === '/api/ai/status') {
      const job = claude.JOBS[u.searchParams.get('jobId')];
      if (!job) return send(res, 200, { error: '実行が見つかりません' });
      // 書き出し中のファイルの大きさから、どのくらい進んだかを見ます。
      // 日本語はUTF-8で1文字およそ3バイトなので、そこから文字数を見積もります。
      let written = 0;
      try { written = Math.round(fs.statSync(job.workFile).size / 3); } catch (e) {}
      return send(res, 200, {
        status: job.status,
        seconds: Math.round((Date.now() - job.startedAt) / 1000),
        written,
        expected: job.expected || 0,
        article: job.article || '',
        warnings: job.warnings || [],
        suggested: job.suggested || null,
        error: job.status === 'error' ? job.error.slice(-1600) : '',
      });
    }

    if (p === '/api/ai/ping') {
      const jobId = DB.newId();
      const pingFile = path.join(ROOT, 'data', 'ping.txt');
      fs.mkdirSync(path.dirname(pingFile), { recursive: true });
      // 日本語で書かせて、文字コードまで含めて確かめます。
      // 空のファイルだと Write ツールを使われるので、目印を1行入れておきます。
      fs.writeFileSync(pingFile, '（ここを書き換えます）\n', 'utf8');
      claude.startClaude(jobId, [
        `${pingFile} には「（ここを書き換えます）」という1行だけが入っています。`,
        'Edit ツールで、その1行を「動作確認できました」に置き換えてください。',
        'Write ツールは使わないでください。',
        '終わったら「完了」とだけ答えてください。',
      ].join('\n'), settings.aiModel, { workFile: pingFile });
      return send(res, 200, { ok: true, jobId });
    }

    if (p === '/api/ai/cancel') {
      const job = claude.JOBS[body.jobId];
      if (job && job.child) {
        job.status = 'canceled';
        try { job.child.kill(); } catch (e) {}
      }
      return send(res, 200, { ok: true });
    }

    // ===== 動画生成（fal.ai） =====
    if (p === '/api/video/models') {
      return send(res, 200, { models: fal.PRESETS, hasKey: !!settings.falKey });
    }

    if (p === '/api/video/generate') {
      if (!settings.falKey) return send(res, 200, { error: '設定画面で fal.ai の API キーを入れてください。' });
      const prompt = String(body.prompt || '').trim();
      if (!prompt) return send(res, 200, { error: '動画の説明（プロンプト）を書いてください。' });
      const model = String(body.model || '').trim();
      if (!model) return send(res, 200, { error: 'モデルを選んでください。' });
      const preset = fal.PRESETS.find((m) => m.id === model);
      let extra = {};
      if (body.extra) {
        try { extra = typeof body.extra === 'string' ? JSON.parse(body.extra) : body.extra; }
        catch (e) { return send(res, 200, { error: '追加パラメータの JSON が読めません。' }); }
      }
      const input = Object.assign({}, preset ? preset.input : {}, { prompt }, extra);
      if (body.imageUrl) input.image_url = String(body.imageUrl);
      if ((preset && preset.kind === 'image') && !input.image_url) {
        return send(res, 200, { error: 'このモデルは画像が必要です。画像を選ぶか URL を入れてください。' });
      }
      const jobId = fal.start(settings.falKey, { model, input });
      return send(res, 200, { ok: true, jobId });
    }

    if (p === '/api/video/status') {
      const job = fal.JOBS[u.searchParams.get('jobId')];
      if (!job) return send(res, 200, { error: '実行が見つかりません' });
      return send(res, 200, {
        status: job.status,
        queuePosition: job.queuePosition ?? null,
        logs: job.logs || [],
        seconds: Math.round((Date.now() - job.startedAt) / 1000),
        file: job.file ? '/videos/' + path.basename(job.file) : '',
        error: job.error || '',
      });
    }

    if (p === '/api/video/list') {
      return send(res, 200, { videos: fal.list().map((v) => Object.assign({}, v, { src: '/videos/' + v.id + '.mp4' })) });
    }

    if (p === '/api/video/delete') {
      return send(res, 200, { ok: fal.remove(String(body.id || '')) });
    }

    // ===== 動く LINE スタンプ =====
    if (p === '/api/stamp/list') {
      return send(res, 200, { sets: stamps.list(), zips: stamps.listZips(), maxBytes: stamps.MAX_BYTES });
    }

    if (p === '/api/stamp/cut') {
      const id = String(body.videoId || '');
      if (!/^\d+$/.test(id)) return send(res, 200, { error: '動画を選んでください。' });
      const video = path.join(fal.OUT_DIR, id + '.mp4');
      if (!fs.existsSync(video)) return send(res, 200, { error: '動画が見つかりません。' });
      try {
        const meta = stamps.cut(video, body);
        return send(res, 200, { ok: true, set: meta });
      } catch (e) {
        return send(res, 200, { error: '切り出しに失敗しました: ' + String(e.stderr || e.message || e).slice(0, 400) });
      }
    }

    if (p === '/api/stamp/zip') {
      try {
        const r = stamps.makeZip(Array.isArray(body.picks) ? body.picks : [], body.name);
        return send(res, 200, Object.assign({ ok: true }, r));
      } catch (e) {
        return send(res, 200, { error: 'zip の作成に失敗しました: ' + String(e.stderr || e.message || e).slice(0, 400) });
      }
    }

    if (p === '/api/stamp/delete-set') {
      return send(res, 200, { ok: stamps.removeSet(String(body.id || '')) });
    }

    // ===== 公開前チェック =====
    if (p === '/api/check') {
      const pr = db.projects.find((x) => x.id === body.id);
      if (!pr) return send(res, 200, { error: '記事が見つかりません' });
      const text = body.article != null ? body.article : bodyOf(pr);
      if (body.article != null) writeArticle(pr, body.article);
      return send(res, 200, { results: runChecks(text, pr, db.inventory) });
    }

    // ===== コピペチェック =====
    // ・集めた口コミの文が、そのまま本文に入っていないか
    // ・自分の別の記事と同じ言い回しになっていないか
    // ・外部サイトとの照合は検索が要るので、確認用のフレーズを出すところまで
    if (p === '/api/check/similar') {
      const pr = db.projects.find((x) => x.id === body.id);
      if (!pr) return send(res, 200, { error: '記事が見つかりません' });
      const text = body.article != null ? body.article : bodyOf(pr);
      if (!text.trim()) return send(res, 200, { error: '先に本文を書いてください' });

      // 1. 口コミの転載
      const reviews = [];
      (pr.products || []).forEach((prod) => {
        if (!prod.reviewText) return;
        const runs = similarity.commonRuns(text, prod.reviewText, { gram: 16, min: 22 });
        if (runs.length) reviews.push({ name: prod.name, runs: runs.slice(0, 5) });
      });

      // 2. 自分の別の記事との重なり
      const internal = [];
      articles.list().forEach((a2) => {
        if (a2.slug === pr.slug) return;
        const other = articles.read(a2.slug);
        if (!other || !other.body.trim()) return;
        const runs = similarity.commonRuns(text, other.body, { gram: 20, min: 30 });
        if (runs.length) {
          internal.push({
            slug: a2.slug, title: a2.title,
            rate: Math.round(similarity.overlapRate(text, other.body, { gram: 20, min: 30 }) * 100),
            runs: runs.slice(0, 5),
          });
        }
      });

      // 3. 外部照合用のフレーズ
      const phrases = similarity.searchPhrases(text, 6).map((q) => ({
        text: q,
        google: 'https://www.google.com/search?q=' + encodeURIComponent('"' + q + '"'),
      }));

      return send(res, 200, { reviews, internal, phrases, chars: text.length });
    }

    // ===== プレビュー用のHTML（1記事だけ） =====
    // 商品カードや関連記事カードも含め、本番とまったく同じ描画にします。
    if (p === '/api/preview-html') {
      const pr = db.projects.find((x) => x.id === (body.id || u.searchParams.get('id')));
      if (!pr) return send(res, 200, { error: '記事が見つかりません' });
      const md = body.article != null ? body.article : bodyOf(pr);
      // 目次は本文の最初の見出しの直前に入るので、プレビューでも同じ位置にします
      // プレビューでは、どのHTMLが本文の何行目かを埋め込みます（その場で直せるようにするため）
      const r = builder.renderArticle(md, { trackSource: true });
      let html = r.html;
      if (r.toc) {
        const at = html.indexOf('<h2');
        html = at === -1 ? r.toc + html : html.slice(0, at) + r.toc + html.slice(at);
      }
      return send(res, 200, { html, toc: '', headings: r.headings });
    }

    // ===== アイキャッチを生成する（fal.ai） =====
    if (p === '/api/eyecatch/generate') {
      const pr = db.projects.find((x) => x.id === body.id);
      if (!pr || !pr.slug) return send(res, 200, { error: '先にURL（スラッグ）を決めてください' });
      // 日本語で書かれていたら、画像生成向けの英語に直してから送ります。
      // 翻訳は Claude Code に頼むので、追加の鍵や費用はかかりません。
      const t = await translate.toEnglish(body.prompt, settings.aiModel);
      const r = await imageAI.generate(settings.falKey, {
        prompt: t.english,
        model: body.model,
        style: settings.imageStyle || imageAI.DEFAULT_STYLE,
      });
      const file = path.join(ROOT, 'site', 'assets', 'eyecatch', `${pr.slug}.jpg`);
      // 同じ名前のpngが残っていると、どちらが使われるか分からなくなるので消します
      const png = file.replace(/\.jpg$/, '.png');
      if (fs.existsSync(png)) fs.unlinkSync(png);
      const size = imageAI.saveAs(r.buffer, file);
      const rel = `/assets/eyecatch/${pr.slug}.jpg`;
      writeArticle(pr, null, { eyecatch: rel });
      return send(res, 200, {
        ok: true, path: rel, kb: Math.round(size / 1024),
        promptJa: t.translated ? String(body.prompt).trim() : '',
        promptEn: t.english,
      });
    }

    if (p === '/api/eyecatch/models') {
      return send(res, 200, {
        models: imageAI.MODELS,
        hasKey: !!settings.falKey,
        style: settings.imageStyle || imageAI.DEFAULT_STYLE,
        defaultStyle: imageAI.DEFAULT_STYLE,
      });
    }

    // ===== 本文に入れる画像 =====
    // 大きな写真をそのまま置くとページが重くなるので、
    // 受け取った時点で幅1200pxに縮めて保存します。
    if (p === '/api/image/upload') {
      const pr = db.projects.find((x) => x.id === body.id);
      if (!pr || !pr.slug) return send(res, 200, { error: '先にURL（スラッグ）を決めてください' });
      const m = String(body.dataUrl || '').match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
      if (!m) return send(res, 200, { error: '画像を読み取れませんでした' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 20 * 1024 * 1024) return send(res, 200, { error: '画像が大きすぎます（20MBまで）' });

      const dir = path.join(ROOT, 'site', 'assets', 'img', pr.slug);
      fs.mkdirSync(dir, { recursive: true });
      const ext = m[1] === 'png' ? 'png' : 'jpg';
      const base = String(body.name || 'photo').toLowerCase()
        .replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'photo';
      let name = `${base}.${ext}`;
      for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${base}-${n}.${ext}`;
      const file = path.join(dir, name);
      fs.writeFileSync(file, buf);

      const before = buf.length;
      let width = 0, height = 0;
      let out = file;
      let outName = name;
      try {
        // 写真をPNGのまま置くと数MBになります。透過が要らないものはJPEGに変換します。
        let toJpeg = ext !== 'png';
        if (ext === 'png') {
          const alpha = execSync(`sips -g hasAlpha "${file}"`, { encoding: 'utf8' });
          toJpeg = /hasAlpha:\s*no/.test(alpha);
        }
        if (toJpeg && ext === 'png') {
          outName = name.replace(/\.png$/, '.jpg');
          out = path.join(dir, outName);
        }
        execSync(`sips -Z 1200${toJpeg ? ' -s format jpeg -s formatOptions 82' : ''}`
          + ` "${file}" --out "${out}"`, { stdio: 'ignore' });
        if (out !== file) fs.unlinkSync(file);
        const info = execSync(`sips -g pixelWidth -g pixelHeight "${out}"`, { encoding: 'utf8' });
        width = Number((info.match(/pixelWidth:\s*(\d+)/) || [])[1] || 0);
        height = Number((info.match(/pixelHeight:\s*(\d+)/) || [])[1] || 0);
      } catch (e) { out = file; outName = name; }

      const after = fs.statSync(out).size;
      const rel = `/assets/img/${pr.slug}/${outName}`;
      return send(res, 200, {
        ok: true, path: rel, width, height,
        before: Math.round(before / 1024), after: Math.round(after / 1024),
        markdown: `![](${rel}${width ? ` ${width}x${height}` : ''})`,
      });
    }

    // 記事に入っている画像の一覧
    if (p === '/api/image/list') {
      const pr = db.projects.find((x) => x.id === u.searchParams.get('id'));
      if (!pr || !pr.slug) return send(res, 200, { images: [] });
      const dir = path.join(ROOT, 'site', 'assets', 'img', pr.slug);
      if (!fs.existsSync(dir)) return send(res, 200, { images: [] });
      return send(res, 200, {
        images: fs.readdirSync(dir).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f)).map((f) => ({
          name: f, path: `/assets/img/${pr.slug}/${f}`,
          kb: Math.round(fs.statSync(path.join(dir, f)).size / 1024),
        })),
      });
    }

    if (p === '/api/image/delete') {
      const pr = db.projects.find((x) => x.id === body.id);
      if (!pr || !pr.slug) return send(res, 200, { error: '記事が見つかりません' });
      const file = path.join(ROOT, 'site', 'assets', 'img', pr.slug, path.basename(String(body.name || '')));
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return send(res, 200, { ok: true });
    }

    // ===== アイキャッチの保存 =====
    if (p === '/api/eyecatch/save') {
      const pr = db.projects.find((x) => x.id === body.id);
      if (!pr || !pr.slug) return send(res, 200, { error: '先にURL（スラッグ）を決めてください' });
      const m = String(body.dataUrl || '').match(/^data:image\/(png|jpeg);base64,(.+)$/);
      if (!m) return send(res, 200, { error: '画像を読み取れませんでした' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 8 * 1024 * 1024) return send(res, 200, { error: '画像が大きすぎます（8MBまで）' });
      const dir = path.join(ROOT, 'site', 'assets', 'eyecatch');
      fs.mkdirSync(dir, { recursive: true });
      const name = `${pr.slug}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`;
      fs.writeFileSync(path.join(dir, name), buf);
      const rel = `/assets/eyecatch/${name}`;
      writeArticle(pr, null, { eyecatch: rel });
      return send(res, 200, { ok: true, path: rel });
    }

    if (p === '/api/eyecatch/delete') {
      const pr = db.projects.find((x) => x.id === body.id);
      if (!pr || !pr.slug) return send(res, 200, { error: '記事が見つかりません' });
      const dir = path.join(ROOT, 'site', 'assets', 'eyecatch');
      ['png', 'jpg'].forEach((ext) => {
        const f = path.join(dir, `${pr.slug}.${ext}`);
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
      writeArticle(pr, null, { eyecatch: '' });
      return send(res, 200, { ok: true });
    }

    // ===== サイトの公開 =====
    if (p === '/api/site/state') {
      return send(res, 200, siteState());
    }

    if (p === '/api/site/build') {
      // drafts:true のときだけ下書きも書き出します（手元のプレビュー専用）。
      // 「サイトに反映する」は必ず下書きを除いて作り直すので、公開されることはありません。
      const r = builder.build({
        year: new Date().getFullYear(), assetVer: String(Date.now()).slice(-6),
        includeDrafts: !!body.drafts,
      });
      LAST.build = new Date().toISOString();
      return send(res, 200, { ok: true, result: r, site: siteState() });
    }

    if (p === '/api/site/setup') {
      const r = deploy.setup(body.remoteUrl || '');
      return send(res, 200, { ok: true, log: r.log, site: siteState() });
    }

    if (p === '/api/site/publish') {
      const log = [];
      const r = builder.build({ year: new Date().getFullYear(), assetVer: String(Date.now()).slice(-6) });
      LAST.build = new Date().toISOString();
      log.push(`サイトを書き出しました（記事${r.articles}本・${r.ms}ms）`);

      const pushed = deploy.push(body.message || `記事を更新（${DB.today()}）`);
      pushed.log.forEach((x) => log.push(x));
      if (pushed.pushed) LAST.publish = new Date().toISOString();

      return send(res, 200, { ok: true, log, pushed: pushed.pushed, site: siteState() });
    }

    if (p === '/api/site/history') {
      return send(res, 200, { history: deploy.history(15) });
    }

    return send(res, 404, { error: '不明なリクエストです' });
  } catch (e) {
    return send(res, 200, { error: e.message || String(e) });
  }
});

// 記事で選んだ商品を商品マスタに登録し、確定したIDを商品に書き戻します。
// これをしておかないと、AIが記法のIDを推測してしまい、商品カードが出なくなります。
function registerPicked(pr) {
  let changed = false;
  (pr.products || []).forEach((item) => {
    const master = products.load();
    const found = master.find((x) =>
      (item.code && x.rakuten && x.rakuten.itemCode === item.code)
      || (item.url && x.rakuten && x.rakuten.url
          && x.rakuten.url.split('?')[0] === String(item.url).split('?')[0])
      || x.name === item.name);
    const saved = products.upsert(products.fromSearchItem(item, {
      id: found ? found.id : undefined,
      category: categorySlug(pr.category),
      brand: found ? found.brand : '',
    }));
    if (item.masterId !== saved.id) { item.masterId = saved.id; changed = true; }
  });
  if (changed) {
    const db = DB.loadDb();
    const i = db.projects.findIndex((x) => x.id === pr.id);
    if (i >= 0) { db.projects[i].products = pr.products; DB.saveDb(db); }
  }
  return pr.products.map((x) => x.masterId).filter(Boolean);
}

// 新しい記事（プロジェクト）を作る。同時に空の記事ファイルも用意します。
function newProject(db, src) {
  const id = DB.newId();
  const slug = articles.suggestSlug(src.slug || `article-${db.projects.length + 1}`);
  const pr = {
    id, slug,
    title: src.title || '', keyword: src.keyword || '', category: src.category || '',
    status: '下書き', createdAt: DB.today(),
    products: [], eyecatch: null,
    ideaId: src.ideaId || null, ideaNote: src.ideaNote || '',
  };
  db.projects.unshift(pr);
  articles.save(slug, {
    title: pr.title || pr.keyword || slug,
    category: categorySlug(pr.category),
    status: 'draft', date: DB.today(),
  }, '');
  return pr;
}

server.listen(PORT, '127.0.0.1', () => {
  preview.start(PREVIEW_PORT);
  const url = `http://localhost:${PORT}/`;
  console.log('');
  console.log('  tocoとくらし 記事制作アプリ を起動しました');
  console.log('  ' + url);
  console.log(`  サイトのプレビュー： http://localhost:${PREVIEW_PORT}/`);
  console.log('');
  console.log('  終了するには、このウィンドウで Control + C を押してください。');
  console.log('');
  try { execSync(`open "${url}"`); } catch (e) {}
});
