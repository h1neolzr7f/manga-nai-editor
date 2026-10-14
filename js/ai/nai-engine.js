/* NovelAI engine (1.6): one queue (NovelAI allows one generation at a time per account), retries on 429/5xx,
 * timeout, zip unpacking, subscription/cost preview, engine preference per task. Prompts and images only go to
 * NovelAI through the local proxy; nothing is logged or sent anywhere else. */
(function (root) {
  'use strict';
  const C = root.NaiEngineCore;
  const $ = id => document.getElementById(id);
  let chain = Promise.resolve(), queued = 0, sub = null, subAt = 0, subToken = '', lastEnd = 0;

  function token() { const t = (($('novelaiApiKey') || {}).value || '').trim(); return t ? (/^bearer /i.test(t) ? t : 'Bearer ' + t) : ''; }
  function configured() { return !!token(); }
  function modelId() { const v = (($('novelaiModel') || {}).value || '').trim(); return C.MODELS.some(m => m.id === v) ? v : C.MODELS[0].id; }
  function safeMode() { try { return localStorage.getItem('mnai.nai.safeMode') === '1'; } catch (_) { return false; } }
  function setSafeMode(on) { try { localStorage.setItem('mnai.nai.safeMode', on ? '1' : '0'); } catch (_) { /* private mode */ } }
  function ucPreset() { const v = parseInt((($('novelaiUcPreset') || {}).value), 10); return Number.isFinite(v) && C.UC_PRESETS[v] ? v : 0; }
  function quality() { const q = $('novelaiQualityToggle'); return q ? q.checked : true; }

  /** Cached subscription ({tier, anlas, active}); null when unknown. */
  async function subscription(force) {
    const curTok = token();
    if (!curTok) { sub = null; subAt = 0; subToken = ''; return null; }
    if (sub && !force && subToken === curTok && Date.now() - subAt < 120000) return sub;
    try {
      const r = await fetch('/nai-proxy/health', { headers: { Authorization: curTok } });
      const d = await r.json(); if (r.ok && d && d.ok) { sub = { tier: d.tier, anlas: d.anlas, active: d.active, opus: d.tier === 3 }; subAt = Date.now(); subToken = curTok; }
    } catch (_) { /* offline: cost shown as unknown */ }
    return subToken === curTok ? sub : null;
  }
  /** Human cost line for n images of opts. */
  async function costText(opts, n) {
    const s = await subscription();
    const p = C.payload(Object.assign({ model: modelId() }, opts)).parameters;
    const c = C.cost(Object.assign({}, p, { vibes: opts.vibes || 0, preciseRefs: opts.preciseRefs || 0 }), s);
    const total = c.anlas * (n || 1);
    const tierTxt = s ? (s.opus ? 'Opus' : '订阅等级 ' + s.tier) + (s.anlas != null ? ' · 余额 ' + s.anlas + ' Anlas' : '') : '订阅未知';
    return { free: total === 0, anlas: total, text: (total === 0 ? '免费（Opus 免费额度内）' : '约 ' + total + ' Anlas') + ' · ' + p.width + '×' + p.height + ' · ' + p.steps + ' 步 · ' + tierTxt };
  }
  async function unpack(r) {
    const ct = r.headers.get('content-type') || '';
    if (/json/.test(ct)) { const j = await r.json(); const b = j.image || (j.images && j.images[0]); if (!b) throw new Error('NovelAI 没有返回图像。'); return /^data:/.test(b) ? b : 'data:image/png;base64,' + b; }
    const blob = await r.blob();
    if (/^image\//.test(blob.type)) return toDataUrl(blob);
    if (typeof JSZip === 'undefined') throw new Error('解压 NovelAI 结果需要 JSZip。');
    const zip = await JSZip.loadAsync(blob); let f = null; zip.forEach((p, x) => { if (!f && /\.(png|jpe?g|webp)$/i.test(p)) f = x; });
    if (!f) throw new Error('NovelAI 返回的压缩包里没有图像。');
    return toDataUrl(await f.async('blob'));
  }
  function toDataUrl(blob) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('读取图像失败。')); fr.readAsDataURL(blob); }); }

  async function once(body, signal, onStatus) {
    for (let attempt = 1; ; attempt++) {
      const ctl = new AbortController(); let timedOut = false;
      const stop = () => ctl.abort();
      if (signal) { if (signal.aborted) throw new DOMException('aborted', 'AbortError'); signal.addEventListener('abort', stop, { once: true }); }
      const timer = setTimeout(() => { timedOut = true; ctl.abort('timeout'); }, 180000);
      let r, text = '';
      try {
        r = await fetch('/nai-proxy/generate-image', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/zip, application/json', Authorization: token() }, body: JSON.stringify(body) });
        if (r.ok) { subAt = 0; return await unpack(r); }
        text = await r.text().catch(() => '');
        if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
        if (timedOut || ctl.signal.aborted) throw new Error('timeout');
      } catch (e) {
        if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
        if (timedOut || ctl.signal.aborted) throw Object.assign(new Error('NovelAI 3 分钟没有响应，结果未知：没有自动重试（避免重复生成或扣费）。确认后可以再点一次。'), { unknown: true });
        throw Object.assign(new Error('请求发出后连接断了，结果未知：没有自动重试（避免重复生成或扣费）。（' + (e.message || e) + '）'), { unknown: true });
      } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', stop); }
      const e = C.httpError(r.status, text);
      if (!e.retry || attempt >= 6) { const err = new Error(e.msg); err.status = r.status; throw err; }
      if (onStatus) onStatus(e.msg + '（第 ' + attempt + ' 次）');
      await new Promise(res => setTimeout(res, Math.min(30000, e.wait * attempt)));
    }
  }
  function sharedQueue() {
    if (typeof novelaiQueue !== 'undefined' && novelaiQueue && typeof novelaiQueue.add === 'function') return novelaiQueue;
    if (root && root.novelaiQueue && typeof root.novelaiQueue.add === 'function') return root.novelaiQueue;
    return null;
  }
  /** Queue one generation. opts -> NaiEngineCore.payload options (model/uc/quality/safe mode filled from settings). */
  function run(opts, signal, onStatus) {
    if (!configured()) return Promise.reject(Object.assign(new Error('还没填 NovelAI Token：请在「服务设置」里填写。'), { needsConfig: true }));
    const body = C.payload(Object.assign({ model: modelId(), ucPreset: ucPreset(), quality: quality(), safeMode: safeMode() }, opts));
    const q = sharedQueue();
    const taskFn = async () => {
      if (lastEnd && Date.now() - lastEnd < C.SPACING_MS) await new Promise(r => setTimeout(r, C.SPACING_MS - (Date.now() - lastEnd)));
      const img = await once(body, signal, onStatus);
      return { image: img, seed: body.parameters.seed, width: body.parameters.width, height: body.parameters.height, model: body.model };
    };
    queued++;
    if (q) {
      const pendingAhead = q.getTotalCount();
      if (pendingAhead > 0 && onStatus) onStatus('排队中（NovelAI 一次只生成一张，前面还有 ' + pendingAhead + ' 张）…');
      const p = q.add(taskFn);
      p.catch(() => {}).then(() => { queued = Math.max(0, queued - 1); lastEnd = Date.now(); });
      return p;
    }
    if (queued > 1 && onStatus) onStatus('排队中（NovelAI 一次只生成一张，前面还有 ' + (queued - 1) + ' 张）…');
    const p = chain.then(taskFn);
    chain = p.catch(() => {}).then(() => { queued = Math.max(0, queued - 1); lastEnd = Date.now(); });
    return p;
  }
  // Engine preference per task: remembered; NovelAI is the default when GPT is not configured.
  function preferred(task, gptReady) {
    let v = null; try { v = localStorage.getItem('mnai.engine.' + task); } catch (_) { /* ignore */ }
    if (v === 'gpt' || v === 'nai') return v;
    return !gptReady && configured() ? 'nai' : 'gpt';
  }
  function remember(task, v) { try { localStorage.setItem('mnai.engine.' + task, v); } catch (_) { /* ignore */ } }
  root.NaiEngine = Object.freeze({ run, configured, subscription, costText, preferred, remember, modelId, safeMode, setSafeMode, isRefusal: C.isRefusal });
})(window);
