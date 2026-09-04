// 日本語のプロンプトを、画像生成向けの英語に訳す
//
// 翻訳サービスは使わず、すでに入っている Claude Code に頼みます。
// サブスクリプションで動くので追加の費用も鍵も要りません。
// ファイルは触らせないので、Write ツールの不具合（日本語が壊れる）とも無関係です。

const { spawn } = require('child_process');
const path = require('path');

const APP = path.join(__dirname, '..');

// 日本語が含まれているか
function hasJapanese(text) {
  return /[぀-ヿ㐀-鿿]/.test(String(text || ''));
}

const INSTRUCTION = [
  'あなたは画像生成AIのプロンプトを書く担当です。',
  '次の日本語を、画像生成AI（FLUX）向けの英語プロンプトに直してください。',
  '',
  '守ること：',
  '・英語のプロンプトだけを1行で出力する。説明・前置き・引用符は付けない',
  '・見たままを描写する具体的な語に置き換える（抽象語や比喩は避ける）',
  '・文字や看板を描かせる語は入れない',
  '・作風や色の指定は入れない（別途こちらで足すため）',
  '',
  '日本語：',
].join('\n');

function toEnglish(text, model, timeoutMs) {
  return new Promise((resolve, reject) => {
    const src = String(text || '').trim();
    if (!src) return resolve({ english: '', translated: false });
    if (!hasJapanese(src)) return resolve({ english: src, translated: false });

    const env = Object.assign({}, process.env);
    if (!env.LC_ALL) env.LC_ALL = env.LANG || 'ja_JP.UTF-8';
    if (!env.LANG) env.LANG = env.LC_ALL;
    ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'ANTHROPIC_API_KEY']
      .forEach((k) => delete env[k]);

    const args = ['-p', `${INSTRUCTION}${src}`, '--output-format', 'text', '--allowedTools', ''];
    if (model) args.push('--model', model);

    let child;
    try {
      child = spawn('claude', args, { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(new Error('翻訳に使う claude コマンドを起動できませんでした：' + e.message));
    }

    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });

    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) {}
      reject(new Error('翻訳に時間がかかりすぎました。英語で書くか、短くしてお試しください。'));
    }, timeoutMs || 90000);

    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error('翻訳に失敗しました：' + (err || out || '（詳細なし）').trim().slice(0, 300)));
      }
      // 前置きや引用符が付いてくることがあるので、そこだけ落とします
      const english = out.trim()
        .replace(/^```[a-z]*\n?|\n?```$/g, '')
        .split('\n').filter((l) => l.trim()).pop() || '';
      const clean = english.trim().replace(/^["'「]|["'」]$/g, '');
      if (!clean) return reject(new Error('翻訳の結果が空でした。もう一度お試しください。'));
      resolve({ english: clean, translated: true });
    });
  });
}

module.exports = { toEnglish, hasJapanese };
