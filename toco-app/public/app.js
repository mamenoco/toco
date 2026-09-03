'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let STATE = { settings: {}, inventory: [], ideas: [], projects: [], site: null, categories: [] };
let CURRENT = null;   // 開いている記事
let CURMETA = {};     // その記事のフロントマター

// ---------- 通信 ----------
async function api(path, body) {
  const opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  const res = await fetch('/api/' + path, opt);
  const json = await res.json();
  if (json.error) { toast(json.error); throw new Error(json.error); }
  return json;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), 3600);
}

function modal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.add('on'); }
function closeModal() { $('#modal').classList.remove('on'); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

function flash(el, msg) {
  $(el).textContent = msg;
  setTimeout(() => { if ($(el).textContent === msg) $(el).textContent = ''; }, 2600);
}

// ---------- 画面切り替え ----------
const RENDER = {
  home: renderHome, ideas: renderIdeas, articles: renderArticles,
  inventory: renderInventory, publish: renderPublish, settings: renderSettings,
};

function show(view, keepHash) {
  if (!keepHash) setHash(view === 'editor' && CURRENT ? `edit/${CURRENT.id}` : view);
  $$('.view').forEach((v) => v.classList.remove('on'));
  $('#view-' + view).classList.add('on');
  $$('.nav').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  if (view === 'editor') $$('.nav').forEach((b) => b.classList.toggle('on', b.dataset.view === 'articles'));
  if (RENDER[view]) RENDER[view]();
  window.scrollTo(0, 0);
}
$$('.nav').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

// 画面の位置をURLに残す。ブラウザの「戻る」で前の画面に戻れます。
let HASH_LOCK = false;
function setHash(h) {
  if (HASH_LOCK) return;
  const next = "#" + h;
  if (location.hash !== next) { HASH_LOCK = true; location.hash = next; setTimeout(() => { HASH_LOCK = false; }, 0); }
}

async function applyHash() {
  const h = location.hash.replace(/^#/, "");
  const [head, id, step] = h.split("/");
  if (head === "edit" && id) {
    await openProject(id, Number(step) || null, true);
    return;
  }
  show(RENDER[head] ? head : "home", true);
}
window.addEventListener("hashchange", () => { if (!HASH_LOCK) applyHash(); });

// ---------- 全体の読み込み ----------
async function refresh() {
  STATE = await api('state');
  const s = STATE.site;
  const pend = s.deploy.isRepo ? s.deploy.changedCount : 0;
  setTail('#navPublish', pend);
  setTail('#navIdeas', (STATE.ideas || []).filter((i) => i.status === '未着手').length);
  setTail('#navArticles', STATE.projects.filter((p) => !p.published).length);
  $('#sideState').textContent = `公開 ${s.articles.published}本 / 下書き ${s.articles.draft}本`;
}

function setTail(sel, n) {
  const el = $(sel);
  el.hidden = !n;
  el.textContent = n;
}

const CAT_NAMES = () => STATE.categories.map((c) => c.name);
function catName(v) {
  const c = STATE.categories.find((x) => x.slug === v || x.name === v);
  return c ? c.name : (v || '—');
}
function catSlug(v) {
  const c = STATE.categories.find((x) => x.slug === v || x.name === v);
  return c ? c.slug : '';
}

// ================================================================
// ホーム
// ================================================================
function renderHome() {
  const s = STATE.site;
  const d = new Date();
  $('#homeDate').textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

  $('#homeDeploy').innerHTML = deployBar(s);
  bindDeployBar();

  $('#homeStats').innerHTML = [
    stat('公開中の記事', s.articles.published, '本'),
    stat('下書き', s.articles.draft, '本'),
    stat('未反映の変更', s.deploy.isRepo ? s.deploy.changedCount : '—', s.deploy.isRepo ? '件' : ''),
    stat('最後に公開', s.lastPublish ? timeAgo(s.lastPublish) : (s.deploy.lastCommit ? s.deploy.lastCommit.date.slice(5) : 'まだ'), ''),
  ].join('');

  const working = STATE.projects.filter((p) => !p.published);
  $('#homeWorking').innerHTML = working.length ? working.slice(0, 6).map((p) => `
    <div class="item"><div class="body">
      <div class="nm">${esc(p.title || p.keyword || '（無題）')}</div>
      <div class="mt">${esc(catName(p.category))}　商品${p.productCount}点　本文${p.chars}文字</div>
      <div class="acts"><button class="ghost" data-open="${p.id}">続きから</button></div>
    </div></div>`).join('') : '<p class="note">いま書きかけの記事はありません。</p>';
  $('#homeWorking').querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => openProject(b.dataset.open)));

  $('#homeNoteItem').innerHTML = STATE.inventory.length
    ? STATE.inventory.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('')
    : '<option value="">（持ちもの台帳が空です）</option>';
}

function stat(k, v, unit) {
  return `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}${unit ? `<small>${esc(unit)}</small>` : ''}</div></div>`;
}

function timeAgo(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  if (m < 1440) return `${Math.round(m / 60)}時間前`;
  return `${Math.round(m / 1440)}日前`;
}

$('#homeNoteSave').addEventListener('click', async () => {
  const id = $('#homeNoteItem').value;
  const text = $('#homeNoteText').value.trim();
  if (!id) return toast('先に持ちもの台帳に用品を登録してください');
  if (!text) return toast('気づいたことを書いてください');
  await api('inventory/note', { id, text });
  $('#homeNoteText').value = '';
  await refresh();
  toast('メモを残しました');
});

// ---------- 公開バー（ホームと公開画面で共通） ----------
function deployBar(s) {
  if (!s.deploy.isRepo) {
    return `<div class="deploybar"><div><div class="t">まだ公開の準備ができていません</div>
      <div class="d">サイトを公開するには、最初に一度だけ設定が必要です。</div></div>
      <span class="spacer"></span><button class="primary" data-go="setup">準備をする</button></div>`;
  }
  if (!s.deploy.ready) {
    return `<div class="deploybar"><div><div class="t">あと少しです</div>
      <div class="d">${esc(s.deploy.reason)}</div></div>
      <span class="spacer"></span><button class="primary" data-go="setup">設定を続ける</button></div>`;
  }
  if (s.deploy.changedCount === 0 && s.deploy.ahead === 0) {
    return `<div class="deploybar"><div><div class="t">サイトは最新です</div>
      <div class="d">未反映の変更はありません。${s.deploy.lastCommit ? '最終更新 ' + esc(s.deploy.lastCommit.date) : ''}</div></div>
      <span class="spacer"></span><button class="ghost" data-go="preview">サイトを見る</button></div>`;
  }
  return `<div class="deploybar"><div><div class="t">${s.deploy.changedCount + s.deploy.ahead}件の変更が未反映です</div>
    <div class="d">「サイトに反映する」を押すと toco-to.com に公開されます。</div></div>
    <span class="spacer"></span><button class="primary" data-go="publish">公開画面へ</button></div>`;
}

function bindDeployBar() {
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.go === 'preview') return window.open(STATE.site.siteUrl, '_blank');
    show('publish');
    if (b.dataset.go === 'setup') $('#setupCard').scrollIntoView({ behavior: 'smooth' });
  }));
}

// ================================================================
// 記事ネタ
// ================================================================
const PRI_ORDER = { '高': 0, '中': 1, '低': 2 };

function renderIdeas() {
  if (!$('#fCategory').dataset.filled) {
    $('#fCategory').innerHTML = '<option value="">カテゴリ すべて</option>'
      + CAT_NAMES().map((c) => `<option>${esc(c)}</option>`).join('');
    $('#fCategory').dataset.filled = '1';
  }
  const fc = $('#fCategory').value, fs = $('#fStatus').value, fp = $('#fPriority').value;
  const all = STATE.ideas || [];
  const list = all.filter((i) => (!fc || i.category === fc) && (!fs || i.status === fs) && (!fp || i.priority === fp))
    .sort((a, b) => (PRI_ORDER[a.priority] ?? 1) - (PRI_ORDER[b.priority] ?? 1));

  $('#ideaCount').textContent = `${list.length}件 / 全${all.length}件　未着手 ${all.filter((i) => i.status === '未着手').length}件`;

  $('#ideaList').innerHTML = list.length ? `<div class="card"><table class="tbl">
    <thead><tr><th>タイトル</th><th>カテゴリ</th><th>優先</th><th>状態</th><th class="r"></th></tr></thead><tbody>
    ${list.map((i) => `<tr>
      <td class="t">${esc(i.title)}<div class="note" style="margin:2px 0 0">${esc(i.keyword || '')}${i.note ? '　' + esc(i.note) : ''}</div></td>
      <td>${esc(i.category || '—')}</td>
      <td><span class="tag">${esc(i.priority || '中')}</span></td>
      <td><span class="tag ${i.status === '未着手' ? '' : 'pink'}">${esc(i.status)}</span></td>
      <td class="r">
        ${i.status === '未着手' ? `<button class="primary" data-start="${i.id}">書きはじめる</button>` : ''}
        <button class="ghost" data-edit="${i.id}">編集</button>
        <button class="ghost danger" data-del="${i.id}">削除</button></td>
    </tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">条件に合う記事ネタがありません。</div>';

  $('#ideaList').querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', async () => {
    const r = await api('ideas/start', { id: b.dataset.start });
    await refresh();
    openProject(r.project.id);
  }));
  $('#ideaList').querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () =>
    ideaForm((STATE.ideas || []).find((x) => x.id === b.dataset.edit))));
  $('#ideaList').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('この記事ネタを削除します。よろしいですか？')) return;
    await api('ideas/delete', { id: b.dataset.del });
    await refresh(); renderIdeas();
  }));
}
['#fCategory', '#fStatus', '#fPriority'].forEach((s) => $(s).addEventListener('change', renderIdeas));

function ideaForm(idea) {
  const it = idea || {};
  modal(`<h3>${idea ? '記事ネタを編集' : '記事ネタを追加'}</h3>
    <label>タイトル<input id="iTitle" value="${esc(it.title || '')}"></label>
    <label>検索キーワード<input id="iKw" value="${esc(it.keyword || '')}" placeholder="うさぎ 牧草"></label>
    <div class="grid2">
      <label>カテゴリ<select id="iCat">${CAT_NAMES().map((c) =>
    `<option ${c === it.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label>優先度<select id="iPri">${['高', '中', '低'].map((p) =>
    `<option ${p === (it.priority || '中') ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    </div>
    <label>メモ<textarea id="iNote" rows="2">${esc(it.note || '')}</textarea></label>
    <div class="row end"><button class="ghost" id="iCancel">やめる</button><button class="primary" id="iOk">保存</button></div>`);
  $('#iCancel').onclick = closeModal;
  $('#iOk').onclick = async () => {
    const title = $('#iTitle').value.trim();
    if (!title) return toast('タイトルを入れてください');
    await api('ideas/save', {
      id: it.id, title, keyword: $('#iKw').value.trim() || title,
      category: $('#iCat').value, priority: $('#iPri').value, note: $('#iNote').value.trim(),
    });
    closeModal(); await refresh(); renderIdeas();
  };
}
$('#btnIdeaNew').addEventListener('click', () => ideaForm(null));
$('#btnIdeaBulk').addEventListener('click', () => {
  modal(`<h3>まとめて追加</h3>
    <p class="note">1行に1件。「タイトル / キーワード」の形でも書けます。</p>
    <label>カテゴリ<select id="mCat">${CAT_NAMES().map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
    <textarea id="mText" rows="8" placeholder="うさぎの牧草のおすすめ / うさぎ 牧草"></textarea>
    <div class="row end"><button class="ghost" id="mCancel">やめる</button><button class="primary" id="mOk">追加</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const text = $('#mText').value.trim();
    if (!text) return toast('内容を入れてください');
    const r = await api('ideas/add-many', { text, category: $('#mCat').value });
    closeModal(); await refresh(); renderIdeas();
    toast(`${r.added}件を追加しました`);
  };
});

// ================================================================
// 記事の一覧
// ================================================================
function renderArticles() {
  const list = STATE.projects;
  $('#artCount').textContent = `${list.length}本（公開 ${list.filter((p) => p.published).length}本）`;
  $('#articleList').innerHTML = list.length ? `<div class="card"><table class="tbl">
    <thead><tr><th>タイトル</th><th>カテゴリ</th><th>商品</th><th>本文</th><th>状態</th><th class="r"></th></tr></thead><tbody>
    ${list.map((p) => `<tr>
      <td class="t">${esc(p.title || p.keyword || '（無題）')}
        <div class="note" style="margin:2px 0 0">/${esc(p.slug)}/</div></td>
      <td>${esc(catName(p.category))}</td>
      <td>${p.productCount}点</td>
      <td>${p.chars ? p.chars.toLocaleString() + '文字' : '—'}</td>
      <td><span class="tag ${p.published ? 'ok' : ''}">${p.published ? '公開' : '下書き'}</span></td>
      <td class="r"><button class="primary" data-open="${p.id}">開く</button></td>
    </tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">まだ記事がありません。「記事ネタ」から書きはじめるか、「新しい記事」で作成してください。</div>';
  $('#articleList').querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => openProject(b.dataset.open)));
}

$('#btnNewArticle').addEventListener('click', () => {
  modal(`<h3>新しい記事</h3>
    <label>タイトル（あとから変えられます）<input id="nTitle"></label>
    <label>検索キーワード<input id="nKw" placeholder="うさぎ 牧草"></label>
    <label>カテゴリ<select id="nCat">${CAT_NAMES().map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
    <div class="row end"><button class="ghost" id="nCancel">やめる</button><button class="primary" id="nOk">作る</button></div>`);
  $('#nCancel').onclick = closeModal;
  $('#nOk').onclick = async () => {
    const r = await api('project/create', {
      title: $('#nTitle').value.trim(), keyword: $('#nKw').value.trim(), category: $('#nCat').value,
    });
    closeModal(); await refresh(); openProject(r.project.id);
  };
});

// ================================================================
// 記事の詳細
// ================================================================
async function openProject(id, wantStep, keepHash) {
  const r = await api('project/get?id=' + encodeURIComponent(id));
  if (!r.project) return toast('記事が見つかりません');
  CURRENT = r.project;
  CURMETA = r.project.meta || {};
  STATE.inventory = r.inventory;

  $('#edTitle').textContent = CURRENT.title || CURRENT.keyword || '（無題）';
  $('#edMeta').textContent = `${catName(CURRENT.category)}　/${CURRENT.slug}/`;
  $('#searchKeyword').value = CURRENT.keyword || '';
  $('#articleText').value = CURRENT.article || '';
  $('#briefPreview').value = '';
  $('#briefPath').textContent = '';
  $('#aiResultBox').style.display = 'none';
  $('#checkResults').innerHTML = '';
  $('#checkStatus').innerHTML = '';
  $('#checkSolved').innerHTML = '';
  CHECKS = []; PREV_LABELS = null;

  fillMetaForm();
  renderPicked();
  renderReviewStep();
  renderPlaceholders();
  updateChars();
  gotoStep(wantStep || ((CURRENT.article || '').length ? 2 : 1));
  show('editor', keepHash);
}

$('#btnBackList').addEventListener('click', async () => { await refresh(); show('articles'); });

$('#btnDeleteProject').addEventListener('click', async () => {
  if (!confirm('この記事を削除します。よろしいですか？')) return;
  const alsoFile = confirm('記事ファイル（Markdown）も一緒に削除しますか？\nOK＝削除する／キャンセル＝ファイルは残す');
  await api('project/delete', { id: CURRENT.id, deleteArticle: alsoFile });
  await refresh(); show('articles');
});

function gotoStep(n) {
  if (CURRENT) setHash(`edit/${CURRENT.id}/${n}`);
  $$('.step').forEach((b) => b.classList.toggle('on', b.dataset.step === String(n)));
  $$('.stepbox').forEach((b) => { b.hidden = b.dataset.box !== String(n); });
  markStepsDone();
}
$$('.step').forEach((b) => b.addEventListener('click', () => gotoStep(b.dataset.step)));

function markStepsDone() {
  const hasProd = (CURRENT?.products || []).length > 0;
  const hasText = $('#articleText').value.trim().length > 400;
  const checked = CHECKS.length > 0 && !CHECKS.some((c) => c.level === 'error');
  [[1, hasProd], [2, hasText], [3, checked]].forEach(([n, ok]) => {
    const el = document.querySelector(`.step[data-step="${n}"]`);
    if (el) el.classList.toggle('done', !!ok && !el.classList.contains('on'));
  });
}

async function saveProject(patch) {
  const r = await api('project/update', Object.assign({ id: CURRENT.id }, patch));
  Object.assign(CURRENT, patch);
  if (r.project) CURRENT.chars = r.project.chars;
  return r;
}

function updateChars() {
  const n = $('#articleText').value.length;
  $('#articleChars').textContent = n ? `${n.toLocaleString()}文字` : '';
}
$('#articleText').addEventListener('input', updateChars);

// ---- ステップ1：商品 ----
function ownedMatch(name) {
  return STATE.inventory.find((i) => {
    const key = (i.name || '').replace(/\s+/g, '').slice(0, 8);
    return key && (name || '').replace(/\s+/g, '').includes(key);
  });
}

$('#btnSearch').addEventListener('click', async () => {
  const kw = $('#searchKeyword').value.trim();
  if (!kw) return toast('キーワードを入れてください');
  $('#searchNote').innerHTML = '<span class="spin"></span>検索しています…';
  try {
    const r = await api('search', { keyword: kw, hits: 30 });
    $('#searchNote').textContent = `${r.items.length}件（レビュー件数の多い順）`;
    $('#searchResults').innerHTML = r.items.map((it, i) => `
      <div class="item"><img src="${esc(it.image)}" alt="">
        <div class="body"><div class="nm">${esc(it.name)}</div>
          <div class="mt">${esc(it.shop)}　${it.price ? it.price + '円' : '価格不明'}　★${it.reviewAverage || '-'}（${it.reviewCount || 0}件）
            ${ownedMatch(it.name) ? '<span class="badge own">持ちもの台帳にあり</span>' : ''}</div>
          <div class="acts"><button class="ghost" data-add="${i}">この記事に載せる</button>
            <a class="mt" href="${esc(it.url)}" target="_blank">商品ページ</a></div>
        </div></div>`).join('');
    $('#searchResults').querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
      const it = r.items[Number(b.dataset.add)];
      it.owned = !!ownedMatch(it.name);
      await saveProject({ products: (CURRENT.products || []).concat([it]) });
      renderPicked(); renderReviewStep(); toast('追加しました');
    }));
  } catch (e) { $('#searchNote').textContent = ''; }
});

$('#btnManualAdd').addEventListener('click', () => {
  modal(`<h3>手入力で商品を追加</h3>
    <p class="note">検索で出てこない商品や、Amazon限定の商品に使ってください。</p>
    <label>商品名<input id="mName"></label>
    <label>ブランド・メーカー<input id="mBrand"></label>
    <label>商品ページURL<input id="mUrl"></label>
    <div class="row end"><button class="ghost" id="mCancel">やめる</button><button class="primary" id="mOk">追加</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const name = $('#mName').value.trim();
    if (!name) return toast('商品名を入れてください');
    const it = {
      id: Math.random().toString(36).slice(2), name, shop: $('#mBrand').value.trim(),
      url: $('#mUrl').value.trim(), price: '', reviewCount: 0, reviewAverage: '',
      image: '', caption: '', specs: {}, reviewText: '', reviewUrl: '', owned: !!ownedMatch(name),
    };
    await saveProject({ products: (CURRENT.products || []).concat([it]) });
    closeModal(); renderPicked(); renderReviewStep();
  };
});

function renderPicked() {
  const list = CURRENT.products || [];
  $('#pickedCount').textContent = list.length + '点';
  $('#pickedList').innerHTML = list.length ? list.map((p, i) => `
    <div class="item"><img src="${esc(p.image)}" alt="">
      <div class="body"><div class="nm">${esc(p.name)}</div>
        <div class="mt">${esc(p.shop)}　★${p.reviewAverage || '-'}（${p.reviewCount || 0}件）
          ${p.owned ? '<span class="badge own">体験あり</span>' : ''}
          ${p.reviewText ? '<span class="badge rev">口コミ取得済み</span>' : ''}
          ${Object.keys(p.specs || {}).length ? '<span class="badge">スペック入力済み</span>' : ''}</div>
        <div class="acts"><button class="ghost" data-spec="${i}">スペックを入れる</button>
          <button class="ghost danger" data-rm="${i}">外す</button></div>
      </div></div>`).join('') : '<p class="note">まだ商品が選ばれていません。</p>';

  $('#pickedList').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    await saveProject({ products: (CURRENT.products || []).filter((_, i) => i !== Number(b.dataset.rm)) });
    renderPicked(); renderReviewStep();
  }));
  $('#pickedList').querySelectorAll('[data-spec]').forEach((b) =>
    b.addEventListener('click', () => editSpecs(Number(b.dataset.spec))));
  markStepsDone();
}

const SPEC_PRESET = {
  'えさ・牧草': ['種類', '刈り取り時期', '内容量', '原産国', '対象'],
  'ケージ・サークル': ['外寸', '底面', '扉', 'トレー', 'キャスター'],
  'おもちゃ・用品': ['素材', 'サイズ', 'タイプ', '対象', '洗えるか'],
  'お手入れ・健康': ['タイプ', 'サイズ', '素材', '対象', '洗えるか'],
  'しつけ・暮らし': ['タイプ', 'サイズ', '素材', '対象', '備考'],
};

function editSpecs(idx) {
  const p = CURRENT.products[idx];
  const keys = SPEC_PRESET[catName(CURRENT.category)] || SPEC_PRESET['おもちゃ・用品'];
  modal(`<h3>スペック：${esc(p.name).slice(0, 40)}</h3>
    <p class="note">記事内で項目をそろえるため、カテゴリごとに固定しています。分からない項目は空欄で構いません（記事では「–」になります）。</p>
    ${keys.map((k, i) => `<label>${esc(k)}<input id="sp${i}" value="${esc((p.specs || {})[k] || '')}"></label>`).join('')}
    <div class="row end"><button class="ghost" id="spCancel">やめる</button><button class="primary" id="spOk">保存</button></div>`);
  $('#spCancel').onclick = closeModal;
  $('#spOk').onclick = async () => {
    const specs = {};
    keys.forEach((k, i) => { const v = $('#sp' + i).value.trim(); if (v) specs[k] = v; });
    const products = CURRENT.products.slice();
    products[idx] = Object.assign({}, p, { specs });
    await saveProject({ products });
    closeModal(); renderPicked();
  };
}

function renderReviewStep() {
  const list = CURRENT.products || [];
  $('#reviewList').innerHTML = list.length ? list.map((p, i) => `
    <div class="item"><div class="body">
      <div class="nm">${esc(p.name)}</div>
      <div class="mt">★${p.reviewAverage || '-'}（${p.reviewCount || 0}件）
        ${p.reviewText ? '<span class="badge rev">取得済み ' + p.reviewText.length + '文字</span>' : '<span class="badge">未取得</span>'}</div>
      <div class="acts"><button class="ghost" data-fetch="${i}" ${p.reviewText ? 'disabled' : ''}>口コミを取得</button>
        ${p.url ? `<a class="mt" href="${esc(p.url)}" target="_blank">商品ページ</a>` : ''}</div>
    </div></div>`).join('') : '<p class="note">先に商品を選んでください。</p>';

  $('#reviewList').querySelectorAll('[data-fetch]').forEach((b) => b.addEventListener('click', async () => {
    const p = CURRENT.products[Number(b.dataset.fetch)];
    if (!p.url) return toast('商品ページのURLがありません');
    b.disabled = true; b.textContent = '取得中…';
    try {
      await api('reviews/fetch', { projectId: CURRENT.id, productId: p.id });
      const r = await api('project/get?id=' + CURRENT.id);
      CURRENT = r.project; renderReviewStep(); renderPicked(); toast('取得しました');
    } catch (e) { b.disabled = false; b.textContent = '口コミを取得'; }
  }));
}

// ---- ステップ2：執筆 ----
$('#btnBrief').addEventListener('click', async () => {
  const r = await api('brief', { id: CURRENT.id });
  $('#briefPath').textContent = '書き出しました';
  $('#briefPreview').value = r.markdown;
  toast('材料を書き出しました');
});
$('#btnCopyBrief').addEventListener('click', () => {
  if (!$('#briefPreview').value) return toast('先に書き出してください');
  navigator.clipboard.writeText($('#briefPreview').value).then(() => toast('コピーしました'));
});

$('#btnSaveArticle').addEventListener('click', async () => {
  await saveProject({ article: $('#articleText').value });
  renderPlaceholders(); updateChars(); markStepsDone();
  if (CHECKS.length) runCheck();
  flash('#articleSaved', '保存しました');
});

$('#btnOpenPreview').addEventListener('click', async () => {
  await saveProject({ article: $('#articleText').value });
  await api('site/build', {});
  window.open(STATE.site.previewUrl + CURRENT.slug + '/', '_blank');
});

let AI_JOB = null, AI_TIMER = null;

function aiBusy(on, label) {
  $('#btnAiRevise').disabled = on;
  $('#btnAiWrite').disabled = on;
  $('#btnAiCancel').style.display = on ? '' : 'none';
  $('#aiStatus').innerHTML = on ? `<span class="spin"></span>${esc(label || '実行中…')}` : (label || '');
}

async function aiRun(mode) {
  if (AI_JOB) return toast('いま実行中です');
  const instruction = $('#aiInstruction').value.trim();
  if (mode === 'revise' && !instruction) return toast('どこをどう直すか書いてください');
  if (mode === 'write' && (CURRENT.products || []).length === 0) return toast('先に商品を選んでください');
  if (mode === 'write' && $('#articleText').value.trim()
    && !confirm('いまの本文は残したまま、新しい案を下に表示します。よろしいですか？')) return;

  $('#aiResultBox').style.display = 'none';
  aiBusy(true, '準備しています…');
  try {
    const r = await api('ai/run', { id: CURRENT.id, mode, instruction, article: $('#articleText').value });
    AI_JOB = r.jobId; aiPoll();
  } catch (e) { aiBusy(false, ''); }
}

function aiPoll() {
  clearInterval(AI_TIMER);
  AI_TIMER = setInterval(async () => {
    if (!AI_JOB) return clearInterval(AI_TIMER);
    let r;
    try { r = await (await fetch('/api/ai/status?jobId=' + AI_JOB)).json(); } catch (e) { return; }

    if (r.status === 'running') {
      const m = Math.floor(r.seconds / 60), s = r.seconds % 60;
      return aiBusy(true, `実行中… ${m ? m + '分' : ''}${s}秒`);
    }
    clearInterval(AI_TIMER);
    AI_JOB = null;

    if (r.status === 'done') {
      aiBusy(false, '');
      $('#aiResult').value = r.article;
      $('#aiResultBox').style.display = '';
      const w = r.warnings || [];
      $('#aiDiffNote').innerHTML = w.length
        ? `<span style="color:var(--err)">${w.map(esc).join(' ')}</span>` : `${r.article.length}文字`;
      toast(w.length ? '注意点があります。確認してください' : 'できました。内容を確認してください');
    } else if (r.status === 'canceled') {
      aiBusy(false, '中止しました');
    } else {
      aiBusy(false, '');
      modal(`<h3>うまくいきませんでした</h3>
        <p class="note">Claude Code からのメッセージです。使用量の上限に達している場合は、しばらく待つと再開できます。</p>
        <textarea rows="10" readonly>${esc(r.error || '（詳細なし）')}</textarea>
        <div class="row end"><button class="primary" id="eOk">閉じる</button></div>`);
      $('#eOk').onclick = closeModal;
    }
  }, 2000);
}

$('#btnAiRevise').addEventListener('click', () => aiRun('revise'));
$('#btnAiWrite').addEventListener('click', () => aiRun('write'));
$('#btnAiCancel').addEventListener('click', async () => {
  if (!AI_JOB) return;
  await api('ai/cancel', { jobId: AI_JOB });
  AI_JOB = null; clearInterval(AI_TIMER); aiBusy(false, '中止しました');
});
$('#btnAiApply').addEventListener('click', async () => {
  $('#articleText').value = $('#aiResult').value;
  await saveProject({ article: $('#articleText').value });
  $('#aiResultBox').style.display = 'none';
  $('#aiInstruction').value = '';
  renderPlaceholders(); updateChars(); markStepsDone();
  if (CHECKS.length) runCheck();
  toast('反映して保存しました');
});
$('#btnAiDiscard').addEventListener('click', () => {
  $('#aiResultBox').style.display = 'none'; toast('取り消しました');
});

// ---- あなたが書く場所 ----
function findPlaceholders(text) {
  const lines = text.split('\n');
  const out = [];
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes('<!--')) inComment = true;
    if (inComment) { if (l.includes('-->')) inComment = false; continue; }
    if (l.indexOf('【') < 0) continue;
    let start = i, end = i;
    if (/^\s*>/.test(l)) {
      while (start > 0 && /^\s*>/.test(lines[start - 1])) start--;
      while (end + 1 < lines.length && /^\s*>/.test(lines[end + 1])) end++;
    }
    let heading = '記事の冒頭';
    for (let j = start - 1; j >= 0; j--) {
      const m = lines[j].match(/^#{2,4}\s+(.+)$/);
      if (m) { heading = m[1].trim(); break; }
    }
    const guide = lines.slice(start, end + 1)
      .map((x) => x.replace(/^\s*>\s?/, '').replace(/^【|】$/g, '')).join('\n');
    out.push({ start, end, heading, guide, isBlock: end > start });
    i = end;
  }
  return out;
}

function renderPlaceholders() {
  const list = findPlaceholders($('#articleText').value);
  const box = $('#phBox');
  if (!list.length) { box.style.display = 'none'; return; }
  box.style.display = '';
  $('#phCount').textContent = `${list.length}か所`;
  $('#phList').innerHTML = list.map((p, i) => `
    <div class="phcard">
      <div class="phhead">${i + 1}. ${esc(p.heading)}</div>
      <pre class="phguide">${esc(p.guide)}</pre>
      <textarea id="phText${i}" rows="${p.isBlock ? 5 : 2}" placeholder="${p.isBlock
    ? '例：1年ほど使っています。届いてすぐ気づいたのは床の滑りやすさで、〜'
    : '例：うさぎと暮らして2年になりますが、'}"></textarea>
      <div class="row"><button class="primary" data-ph="${i}">ここに入れる</button>
        <span class="note">入れたあと、本文で前後のつながりを確認してください。</span></div>
    </div>`).join('');

  $('#phList').querySelectorAll('[data-ph]').forEach((b) => b.addEventListener('click', async () => {
    const idx = Number(b.dataset.ph);
    const cur = findPlaceholders($('#articleText').value)[idx];
    const val = $('#phText' + idx).value.trim();
    if (!cur) return toast('場所が見つかりません。本文を確認してください');
    if (!val) return toast('文章を書いてください');
    const lines = $('#articleText').value.split('\n');
    lines.splice(cur.start, cur.end - cur.start + 1, val);
    $('#articleText').value = lines.join('\n');
    await saveProject({ article: $('#articleText').value });
    renderPlaceholders(); updateChars(); toast('本文に入れました');
  }));
}
$('#articleText').addEventListener('blur', renderPlaceholders);

// ---- ステップ3：チェック ----
let CHECKS = [], PREV_LABELS = null;

async function runCheck() {
  const r = await api('check', { id: CURRENT.id, article: $('#articleText').value });
  const labels = new Set(r.results.filter((c) => c.level === 'error' || c.level === 'warn').map((c) => c.label));
  if (PREV_LABELS) {
    const solved = [...PREV_LABELS].filter((l) => !labels.has(l));
    $('#checkSolved').innerHTML = solved.length
      ? `<div class="solvedbox"><b>前回のチェックから ${solved.length}件 直りました</b>${solved.map(esc).join(' ／ ')}</div>` : '';
  } else { $('#checkSolved').innerHTML = ''; }
  PREV_LABELS = labels;
  CHECKS = r.results;

  const label = (lv) => lv === 'error' ? '要修正' : lv === 'warn' ? '確認' : lv === 'ok' ? 'OK' : 'メモ';
  const nErr = CHECKS.filter((c) => c.level === 'error').length;
  const nWarn = CHECKS.filter((c) => c.level === 'warn').length;
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  $('#checkStatus').innerHTML =
    `<span><span class="num n-error">${nErr}</span>要修正</span>`
    + `<span><span class="num n-warn">${nWarn}</span>確認</span>`
    + (nErr + nWarn === 0 ? '<span class="n-ok">すべて解消しています</span>'
      : '<span class="note" style="margin:0">直したら、もう一度チェックしてください</span>')
    + `<span class="when">最終チェック ${hhmm}</span>`;

  $('#checkResults').innerHTML = CHECKS.map((c, i) => `
    <div class="chkrow ${c.level}">
      <b>${label(c.level)}：${esc(c.label)}</b>
      <p>${esc(c.detail)}</p>
      ${(c.fix || c.goto) ? `<div class="row" style="margin:7px 0 0">
        ${c.fix ? `<button class="ghost" data-fix="${i}">これを直してもらう</button>` : ''}
        ${c.goto ? `<button class="primary" data-goto="${i}">${c.goto.view === 'inventory' ? '持ちもの台帳を開く' : '書く場所へ移動'}</button>` : ''}
      </div>` : ''}
      ${!c.fix && c.goto && c.goto.step ? '<p class="note" style="margin-top:5px">※ここはご自身で書き足してください。AIには書かせません。</p>' : ''}
    </div>`).join('');

  const fixable = CHECKS.filter((c) => c.fix).length;
  $('#btnFixAll').style.display = fixable >= 2 ? '' : 'none';
  $('#btnFixAll').textContent = `直せる${fixable}件をまとめて直してもらう`;
  $('#checkResults').querySelectorAll('[data-fix]').forEach((b) =>
    b.addEventListener('click', () => askFix([CHECKS[Number(b.dataset.fix)]])));
  $('#checkResults').querySelectorAll('[data-goto]').forEach((b) =>
    b.addEventListener('click', () => jumpTo(CHECKS[Number(b.dataset.goto)].goto)));
  markStepsDone();
  renderPubReady();
}
$('#btnCheck').addEventListener('click', runCheck);
$('#btnFixAll').addEventListener('click', () => askFix(CHECKS.filter((c) => c.fix)));

function textTop(ta, idx) {
  const cs = getComputedStyle(ta);
  const d = document.createElement('div');
  ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop',
    'paddingRight', 'paddingBottom', 'paddingLeft', 'borderWidth', 'textIndent']
    .forEach((k) => { d.style[k] = cs[k]; });
  Object.assign(d.style, {
    position: 'absolute', visibility: 'hidden', left: '-9999px',
    width: ta.clientWidth + 'px', boxSizing: 'border-box',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  });
  d.textContent = ta.value.slice(0, idx);
  const mark = document.createElement('span');
  mark.textContent = '​';
  d.appendChild(mark);
  document.body.appendChild(d);
  const top = mark.offsetTop;
  document.body.removeChild(d);
  return top;
}

function jumpTo(g) {
  if (!g) return;
  if (g.view === 'inventory') { show('inventory'); toast('使っている用品を登録してください'); return; }
  gotoStep(2);
  const ta = $('#articleText');
  if (!g.find) { ta.focus(); return; }
  const idx = ta.value.indexOf(g.find);
  if (idx < 0) { ta.focus(); return toast('本文で場所が見つかりませんでした。書き換えられた可能性があります'); }
  ta.focus();
  ta.setSelectionRange(idx, idx + g.find.length);
  ta.scrollTop = Math.max(0, textTop(ta, idx) - ta.clientHeight / 3);
  ta.scrollIntoView({ block: 'start', behavior: 'smooth' });
  toast('この段落に書き足してください（選択されています）');
}

function askFix(items) {
  const list = items.filter((c) => c.fix);
  if (!list.length) return toast('自動で直せる項目がありません');
  const instruction = list.length === 1 ? list[0].fix
    : '次の点を直してください。指示にない箇所は一字も変更しないでください。\n\n'
    + list.map((c, i) => `${i + 1}. ${c.fix}`).join('\n');
  gotoStep(2);
  $('#aiInstruction').value = instruction;
  aiRun('revise');
}

// ---- ステップ4：公開の設定 ----
function fillMetaForm() {
  const m = CURMETA;
  $('#pubTitle').value = m.title || CURRENT.title || '';
  $('#pubSlug').value = CURRENT.slug || '';
  $('#pubCategory').innerHTML = STATE.categories.map((c) =>
    `<option value="${c.slug}" ${catSlug(m.category || CURRENT.category) === c.slug ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  $('#pubTags').value = Array.isArray(m.tags) ? m.tags.join(', ') : (m.tags || '');
  $('#pubDesc').value = m.description || '';
  $('#pubDate').value = (m.date || '').slice(0, 10);
  $$('input[name=pubStatus]').forEach((r) => { r.checked = r.value === (m.status === 'publish' ? 'publish' : 'draft'); });
  $('#eyeTitle').value = m.title || CURRENT.title || '';
  const theme = { food: 'food', house: 'house', toy: 'toy', care: 'care', life: 'life' }[catSlug(CURRENT.category)];
  if (theme) $('#eyeTheme').value = theme;
  updateUrlPreview();
  renderPubReady();
  drawEyecatch();
}

function updateUrlPreview() {
  const slug = $('#pubSlug').value.trim();
  $('#pubUrlPreview').innerHTML = slug
    ? `公開されるURL： <b>https://toco-to.com/${esc(slug)}/</b>`
    : '<span style="color:var(--err)">URLを入力してください</span>';
}
$('#pubSlug').addEventListener('input', updateUrlPreview);

$('#btnSaveMeta').addEventListener('click', async () => {
  const slug = $('#pubSlug').value.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return toast('URLは英小文字・数字・ハイフンで入力してください');
  if (slug !== CURRENT.slug && CURMETA.status === 'publish'
    && !confirm('公開済みの記事のURLを変えると、いまのURLは開けなくなります。続けますか？')) return;
  const r = await api('article/save', {
    id: CURRENT.id, slug, title: $('#pubTitle').value.trim(),
    category: $('#pubCategory').value, tags: $('#pubTags').value,
    description: $('#pubDesc').value.trim(), date: $('#pubDate').value,
    status: document.querySelector('input[name=pubStatus]:checked').value,
    article: $('#articleText').value,
  });
  CURRENT.slug = slug;
  CURRENT.title = r.article.meta.title;
  CURMETA = r.article.meta;
  $('#edTitle').textContent = CURRENT.title;
  $('#edMeta').textContent = `${catName(CURRENT.category)}　/${CURRENT.slug}/`;
  await refresh();
  renderPubReady();
  flash('#metaSaved', '保存しました');
});
$$('input[name=pubStatus]').forEach((r) => r.addEventListener('change', renderPubReady));

// 公開できる状態かを、その場で示す
function renderPubReady() {
  if (!CURRENT) return;
  const want = document.querySelector('input[name=pubStatus]:checked').value === 'publish';
  const items = [
    ['タイトル', !!$('#pubTitle').value.trim()],
    ['URL', /^[a-z0-9][a-z0-9-]*$/.test($('#pubSlug').value.trim())],
    ['説明文', $('#pubDesc').value.trim().length >= 40],
    ['本文', $('#articleText').value.trim().length > 800],
    ['アイキャッチ', !!CURMETA.eyecatch],
    ['公開前チェックに要修正なし', CHECKS.length > 0 && !CHECKS.some((c) => c.level === 'error')],
  ];
  const ng = items.filter(([, ok]) => !ok);
  $('#pubReady').innerHTML = !want
    ? '<p class="note">下書きのままです。サイトには出ません。</p>'
    : `<div class="stepline">${items.map(([k, ok]) =>
      `<div><span class="no" style="background:${ok ? '#dfeee4' : '#faeae7'};color:${ok ? 'var(--ok)' : 'var(--err)'}">${ok ? '✓' : '!'}</span><span>${esc(k)}</span></div>`).join('')}</div>`
    + (ng.length ? `<p class="note">${ng.length}件そろっていませんが、このまま公開することもできます。</p>`
      : '<p class="note" style="color:var(--ok)">公開の準備ができています。</p>');
}
['#pubTitle', '#pubDesc'].forEach((s) => $(s).addEventListener('input', renderPubReady));

$('#btnBuildOnly').addEventListener('click', async () => {
  $('#pubLog').style.display = '';
  $('#pubLog').textContent = 'サイトを書き出しています…';
  const r = await api('site/build', {});
  $('#pubLog').textContent = `書き出しました（記事${r.result.articles}本・${r.result.ms}ms）\n`
    + `プレビュー： ${STATE.site.previewUrl}${CURRENT.slug}/`;
  window.open(STATE.site.previewUrl + CURRENT.slug + '/', '_blank');
});

$('#btnPublishNow').addEventListener('click', async () => {
  await $('#btnSaveMeta').click();
  const want = document.querySelector('input[name=pubStatus]:checked').value === 'publish';
  if (!confirm(want ? 'この記事を公開して、サイトに反映します。よろしいですか？'
    : '下書きのままサイトを更新します。よろしいですか？')) return;
  $('#pubLog').style.display = '';
  $('#pubLog').textContent = '処理しています…';
  try {
    const r = await api('site/publish', { message: `${CURRENT.title || CURRENT.slug} を更新` });
    $('#pubLog').textContent = r.log.join('\n');
    await refresh();
    toast(r.pushed ? '公開しました' : '手元に記録しました');
  } catch (e) { $('#pubLog').textContent = String(e.message || e); }
});

// ---- アイキャッチ ----
const THEMES = {
  food: { bg: '#eef4ea', bar: '#6f9463', label: 'えさ・牧草' },
  house: { bg: '#eaf0f4', bar: '#5f7f99', label: 'ケージ・サークル' },
  toy: { bg: '#fbf0e6', bar: '#c98b6b', label: 'おもちゃ・用品' },
  care: { bg: '#f7ecef', bar: '#b3707f', label: 'お手入れ・健康' },
  life: { bg: '#f1eef6', bar: '#7f739c', label: 'しつけ・暮らし' },
};
let EYE_FROM_FILE = false;

function drawEyecatch() {
  const cv = $('#eyeCanvas');
  if (!cv || EYE_FROM_FILE) return;
  const g = cv.getContext('2d');
  const t = THEMES[$('#eyeTheme').value] || THEMES.toy;
  const W = 1200, H = 630;
  cv.width = W; cv.height = H;
  g.fillStyle = t.bg; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff';
  g.beginPath(); g.roundRect(56, 56, W - 112, H - 112, 20); g.fill();
  g.fillStyle = t.bar; g.fillRect(56, 56, 10, H - 112);
  g.fillStyle = t.bar;
  g.font = '500 26px "Hiragino Sans", sans-serif';
  g.fillText(t.label, 110, 132);

  const title = ($('#eyeTitle').value || '（タイトル未入力）');
  g.fillStyle = '#3d3630';
  const size = title.length > 34 ? 46 : title.length > 24 ? 54 : 62;
  g.font = `700 ${size}px "Hiragino Sans", sans-serif`;
  const maxW = W - 220;
  const lines = [];
  let line = '';
  for (const ch of title) {
    if (g.measureText(line + ch).width > maxW) { lines.push(line); line = ch; } else line += ch;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 4);
  const lh = size * 1.45;
  let y = H / 2 - ((shown.length - 1) * lh) / 2 + size / 3;
  shown.forEach((l) => { g.fillText(l, 110, y); y += lh; });

  g.fillStyle = '#8b8179';
  g.font = '400 24px "Hiragino Sans", sans-serif';
  g.fillText('tocoとくらし', 110, H - 108);
}
$('#btnMakeEye').addEventListener('click', () => { EYE_FROM_FILE = false; drawEyecatch(); });
$('#eyeTitle').addEventListener('input', drawEyecatch);
$('#eyeTheme').addEventListener('change', drawEyecatch);

$$('input[name=eyeMode]').forEach((r) => r.addEventListener('change', () => {
  const mode = document.querySelector('input[name=eyeMode]:checked').value;
  $('#eyeUploadBox').style.display = mode === 'upload' ? '' : 'none';
  $('#eyeGenerateBox').style.display = mode === 'generate' ? '' : 'none';
  if (mode === 'generate') { EYE_FROM_FILE = false; drawEyecatch(); }
}));

$('#eyeFile').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const before = Math.round(file.size / 1024);
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const cv = $('#eyeCanvas'), g = cv.getContext('2d');
      const W = 1200, H = 630;
      cv.width = W; cv.height = H;
      g.fillStyle = '#fffaf6'; g.fillRect(0, 0, W, H);
      const scale = Math.max(W / img.width, H / img.height);
      const w = img.width * scale, h = img.height * scale;
      g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      EYE_FROM_FILE = true;
      $('#btnClearEye').style.display = '';
      const after = Math.round(cv.toDataURL('image/jpeg', 0.85).length * 0.75 / 1024);
      $('#eyeFileInfo').innerHTML = `${esc(file.name)}　${before}KB → <strong>約${after}KB</strong>（1200×630に調整）`;
      toast('画像を読み込みました');
    };
    img.onerror = () => toast('画像を読み込めませんでした');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

$('#btnClearEye').addEventListener('click', () => {
  $('#eyeFile').value = ''; $('#eyeFileInfo').textContent = '';
  $('#btnClearEye').style.display = 'none';
  EYE_FROM_FILE = false; drawEyecatch();
});

function eyecatchDataUrl() {
  const cv = $('#eyeCanvas');
  return EYE_FROM_FILE ? cv.toDataURL('image/jpeg', 0.85) : cv.toDataURL('image/png');
}

$('#btnSaveEye').addEventListener('click', async () => {
  if (!CURRENT.slug) return toast('先にURLを決めて保存してください');
  const r = await api('eyecatch/save', { id: CURRENT.id, dataUrl: eyecatchDataUrl() });
  CURMETA.eyecatch = r.path;
  renderPubReady();
  flash('#eyeSaved', '保存しました：' + r.path);
});

$('#btnDownloadEye').addEventListener('click', () => {
  const a = document.createElement('a');
  a.download = (CURRENT?.slug || 'eyecatch') + (EYE_FROM_FILE ? '.jpg' : '.png');
  a.href = eyecatchDataUrl();
  a.click();
});

// ================================================================
// 持ちもの台帳
// ================================================================
function renderInventory() {
  const list = STATE.inventory || [];
  $('#invList').innerHTML = list.length ? list.map((i) => `
    <div class="card">
      <div class="row"><b>${esc(i.name)}</b>
        <span class="tag">${esc(i.category || '—')}</span>
        <span class="tag ${i.status === '使用中' ? 'ok' : ''}">${esc(i.status || '使用中')}</span>
        <span class="note" style="margin:0">${esc(i.since || '')}から</span>
        <span class="spacer"></span>
        <button class="ghost" data-note="${i.id}">気づいたことを追加</button>
        <button class="ghost" data-edit="${i.id}">編集</button>
        <button class="ghost danger" data-del="${i.id}">削除</button></div>
      ${(i.notes || []).length ? `<div class="list" style="margin-top:10px">${i.notes.map((n) =>
    `<div class="item"><div class="body"><div class="mt">${esc(n.date)}</div><div>${esc(n.text)}</div></div></div>`).join('')}</div>`
    : '<p class="note">まだメモがありません。気づいたことを書き足しておくと、記事の材料になります。</p>'}
    </div>`).join('')
    : '<div class="empty">まだ登録がありません。実際に使っている用品を登録すると、その商品にだけ実体験を書けるようになります。</div>';

  $('#invList').querySelectorAll('[data-note]').forEach((b) => b.addEventListener('click', async () => {
    const text = prompt('気づいたことを書いてください');
    if (!text) return;
    await api('inventory/note', { id: b.dataset.note, text });
    await refresh(); renderInventory();
  }));
  $('#invList').querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () =>
    itemForm(STATE.inventory.find((x) => x.id === b.dataset.edit))));
  $('#invList').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('削除します。よろしいですか？')) return;
    await api('inventory/delete', { id: b.dataset.del });
    await refresh(); renderInventory();
  }));
}

function itemForm(item) {
  const it = item || {};
  modal(`<h3>${item ? '用品を編集' : '用品を追加'}</h3>
    <p class="note">ここに登録した商品にだけ、記事で実体験を書けるようになります。</p>
    <label>商品名<input id="vName" value="${esc(it.name || '')}"></label>
    <div class="grid2">
      <label>カテゴリ<select id="vCat">${CAT_NAMES().map((c) =>
    `<option ${c === it.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label>状態<select id="vStatus">${['使用中', '使用をやめた', '買い替えた'].map((s) =>
    `<option ${s === (it.status || '使用中') ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
    </div>
    <label>使いはじめ（例 2025-04）<input id="vSince" value="${esc(it.since || '')}"></label>
    <div class="row end"><button class="ghost" id="vCancel">やめる</button><button class="primary" id="vOk">保存</button></div>`);
  $('#vCancel').onclick = closeModal;
  $('#vOk').onclick = async () => {
    const name = $('#vName').value.trim();
    if (!name) return toast('商品名を入れてください');
    await api('inventory/save', {
      id: it.id, name, category: $('#vCat').value,
      status: $('#vStatus').value, since: $('#vSince').value.trim(),
    });
    closeModal(); await refresh(); renderInventory();
  };
}
$('#btnInvNew').addEventListener('click', () => itemForm(null));

// ================================================================
// 公開
// ================================================================
async function renderPublish() {
  const s = STATE.site;
  $('#pubDeploy').innerHTML = deployBar(s);
  bindDeployBar();
  $('#pubStats').innerHTML = [
    stat('公開中', s.articles.published, '本'),
    stat('下書き', s.articles.draft, '本'),
    stat('未反映', s.deploy.isRepo ? s.deploy.changedCount + s.deploy.ahead : '—', s.deploy.isRepo ? '件' : ''),
    stat('書き出し', s.lastBuild ? timeAgo(s.lastBuild) : (s.distExists ? '済み' : 'まだ'), ''),
  ].join('');

  $('#pubArticleRows').innerHTML = s.articles.list.map((a) => `<tr>
    <td class="t">${esc(a.title)}</td>
    <td class="note" style="padding:10px">/${esc(a.slug)}/</td>
    <td>${esc(catName(a.category))}</td>
    <td class="note" style="padding:10px">${esc(a.updated || a.mtime)}</td>
    <td class="r"><button class="${a.status === 'publish' ? 'primary' : 'ghost'}" data-toggle="${a.slug}">
      ${a.status === 'publish' ? '公開中' : '下書き'}</button></td></tr>`).join('')
    || '<tr><td colspan="5" class="note">記事がありません。</td></tr>';

  $('#pubArticleRows').querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const slug = b.dataset.toggle;
    const pr = STATE.projects.find((p) => p.slug === slug);
    if (!pr) return toast('この記事はアプリの管理下にありません。記事画面から開いてください');
    const now = s.articles.list.find((a) => a.slug === slug).status;
    await api('article/save', { id: pr.id, slug, status: now === 'publish' ? 'draft' : 'publish' });
    await refresh(); renderPublish();
  }));

  try {
    const h = await api('site/history');
    $('#pubHistory').innerHTML = h.history.length
      ? `<table class="tbl"><tbody>${h.history.map((x) =>
        `<tr><td class="note" style="padding:8px 10px;width:120px">${esc(x.date)}</td><td>${esc(x.subject)}</td>
         <td class="r note">${esc(x.hash)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="note">まだありません。</p>';
  } catch (e) { $('#pubHistory').innerHTML = '<p class="note">まだありません。</p>'; }

  renderSetup(s);
}

function renderSetup(s) {
  const d = s.deploy;
  if (d.ready) {
    $('#setupBody').innerHTML = `<p class="note">設定は完了しています。</p>
      <table class="tbl"><tbody>
      <tr><td>GitHub</td><td>${esc(d.remote)}</td></tr>
      <tr><td>ブランチ</td><td>${esc(d.branch)}</td></tr>
      <tr><td>鍵の除外</td><td><span class="tag ok">data/ は公開されません</span></td></tr>
      </tbody></table>`;
    return;
  }
  $('#setupBody').innerHTML = `
    <p class="note">サイトを公開するために、最初に一度だけ設定します。順番に進めてください。</p>
    <div class="stepline">
      <div><span class="no">1</span><span>GitHubで<b>プライベート</b>リポジトリを作る（中身は空のままで構いません）</span></div>
      <div><span class="no">2</span><span>そのリポジトリのURLを下に貼って「準備する」を押す</span></div>
      <div><span class="no">3</span><span>Cloudflare Pages でそのリポジトリを選び、出力先を <code>toco-app/dist</code> にする</span></div>
    </div>
    <label>GitHubリポジトリのURL<input id="setupRemote" placeholder="https://github.com/ユーザー名/toco.git"
      value="${esc(d.remote || '')}"></label>
    <div class="row"><button class="primary" id="btnSetup">準備する</button>
      <span class="note">${esc(d.reason || '')}</span></div>
    <pre class="logbox" id="setupLog" style="display:none"></pre>`;

  $('#btnSetup').addEventListener('click', async () => {
    const r = await api('site/setup', { remoteUrl: $('#setupRemote').value.trim() });
    $('#setupLog').style.display = '';
    $('#setupLog').textContent = r.log.join('\n');
    await refresh(); renderPublish();
  });
}

$('#btnSiteBuild').addEventListener('click', async () => {
  $('#siteLog').style.display = '';
  $('#siteLog').textContent = 'サイトを書き出しています…';
  const r = await api('site/build', {});
  const mb = (n) => (n / 1048576).toFixed(2) + 'MB';
  $('#siteLog').textContent = `書き出しました（${r.result.ms}ms）
  記事 ${r.result.articles}本（下書き ${r.result.drafts}本）
  画像 ${mb(r.result.imagesBefore)} → ${mb(r.result.imagesAfter)}
  プレビュー： ${STATE.site.previewUrl}`;
  await refresh();
});

$('#btnSitePreview').addEventListener('click', async () => {
  await api('site/build', {});
  window.open(STATE.site.previewUrl, '_blank');
});

$('#btnSitePublish').addEventListener('click', async () => {
  if (!confirm('サイトに反映します。公開状態の記事が toco-to.com に出ます。よろしいですか？')) return;
  $('#siteLog').style.display = '';
  $('#siteLog').textContent = '処理しています…';
  try {
    const r = await api('site/publish', { message: $('#pubMessage').value.trim() || '' });
    $('#siteLog').textContent = r.log.join('\n');
    $('#pubMessage').value = '';
    await refresh(); renderPublish();
    toast(r.pushed ? '公開しました' : '手元に記録しました');
  } catch (e) { $('#siteLog').textContent = String(e.message || e); }
});

// ================================================================
// 設定
// ================================================================
function renderSettings() {
  const s = STATE.settings || {};
  $('#setRakutenId').value = s.rakutenAppId || '';
  $('#setRakutenKey').value = s.rakutenAccessKey || '';
  $('#setModel').value = s.aiModel || 'claude-opus-5';
}

$('#btnSaveSettings').addEventListener('click', async () => {
  await api('settings/save', {
    rakutenAppId: $('#setRakutenId').value.trim(),
    rakutenAccessKey: $('#setRakutenKey').value.trim(),
    aiModel: $('#setModel').value,
  });
  await refresh();
  flash('#settingsSaved', '保存しました');
});
$('#setModel').addEventListener('change', () => $('#btnSaveSettings').click());

$('#btnTestRakuten').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await api('settings/test-rakuten', {});
    flash('#settingsSaved', 'つながりました：' + r.sample);
  } finally { e.target.disabled = false; }
});

$('#btnMyIp').addEventListener('click', async () => {
  $('#myIpNote').textContent = '調べています…';
  const r = await api('myip');
  $('#myIpNote').textContent = `IPv4 ${r.ipv4 || '不明'}${r.ipv6 ? '　IPv6 ' + r.ipv6 : ''}`;
});

$('#btnPingAi').addEventListener('click', async () => {
  $('#aiPingNote').innerHTML = '<span class="spin"></span>試しています…';
  try {
    const r = await api('ai/ping', {});
    const t = setInterval(async () => {
      const st = await (await fetch('/api/ai/status?jobId=' + r.jobId)).json();
      if (st.status === 'running') return;
      clearInterval(t);
      $('#aiPingNote').textContent = st.status === 'done' ? '動きました。記事を書いてもらえます。' : '動きませんでした。';
      if (st.status === 'error') {
        modal(`<h3>Claude Code が動きませんでした</h3><textarea rows="10" readonly>${esc(st.error)}</textarea>
          <div class="row end"><button class="primary" id="pOk">閉じる</button></div>`);
        $('#pOk').onclick = closeModal;
      }
    }, 2000);
  } catch (e) { $('#aiPingNote').textContent = ''; }
});

// ---------- 起動 ----------
(async function boot() {
  await refresh();
  if (location.hash.length > 1) await applyHash();
  else renderHome();
})();
