/* Unified MangaCore namespace facade & non-blocking multi-page BatchQueue.
 * - window.MangaCore provides a clean, structured facade over the legacy global canvas, history,
 *   page-bar (btmProjectsMap), and layer functions while preserving 100% backward compatibility.
 * - window.MangaBatchQueue manages multi-page background tasks with per-page status badges on
 *   the bottom page bar (`queued` | `running` | `done` | `error`).
 */
(function (root) {
  'use strict';

  const pageStatuses = new Map();
  const queue = [];
  let running = false;
  let currentJob = null;
  const listeners = new Set();

  function emitChange() {
    const snap = getSnapshot();
    listeners.forEach(fn => {
      try { fn(snap); } catch (_e) { /* ignore listener errors */ }
    });
  }

  function renderPageBadge(guid) {
    if (typeof document === 'undefined' || !document || typeof document.querySelector !== 'function' || !guid) return;
    const img = document.querySelector('.btm-image[data-index="' + guid + '"]');
    if (!img || !img.parentElement) return;
    const wrapper = img.parentElement;
    let badge = wrapper.querySelector('.btm-batch-badge');
    const info = pageStatuses.get(guid);
    if (!info || !info.status || info.status === 'idle') {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'btm-batch-badge';
      badge.style.cssText = 'position:absolute;left:4px;bottom:4px;z-index:5;padding:1px 6px;border-radius:4px;font:600 11px/1.35 sans-serif;pointer-events:none;box-shadow:0 1px 4px rgba(0,0,0,.45)';
      wrapper.appendChild(badge);
    }
    const palette = {
      queued: { bg: '#334155', fg: '#e2e8f0', text: info.label || '排队中' },
      running: { bg: '#2563eb', fg: '#ffffff', text: info.label || '处理中…' },
      done: { bg: '#16a34a', fg: '#ffffff', text: info.label || '已完成' },
      error: { bg: '#dc2626', fg: '#ffffff', text: info.label || '失败' }
    };
    const style = palette[info.status] || palette.queued;
    badge.style.background = style.bg;
    badge.style.color = style.fg;
    badge.textContent = style.text;
  }

  function setPageStatus(guid, status, label) {
    if (!guid) return;
    if (!status || status === 'idle') {
      pageStatuses.delete(guid);
    } else {
      pageStatuses.set(guid, { status, label: label || '', updatedAt: Date.now() });
    }
    renderPageBadge(guid);
    emitChange();
  }

  function getPageStatus(guid) {
    return pageStatuses.get(guid) || { status: 'idle', label: '', updatedAt: 0 };
  }

  function enqueue(job) {
    if (!job || typeof job.run !== 'function') {
      throw new Error('Batch job requires a run(ctx) function');
    }
    const id = job.id || ('batch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6));
    const entry = {
      id,
      guid: job.guid || null,
      title: job.title || '批处理任务',
      queuedLabel: job.queuedLabel || '排队中',
      runningLabel: job.runningLabel || '处理中…',
      doneLabel: job.doneLabel || '已完成',
      run: job.run,
      status: 'queued'
    };
    queue.push(entry);
    if (entry.guid) setPageStatus(entry.guid, 'queued', entry.queuedLabel);
    emitChange();
    pump();
    return id;
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const job = queue.shift();
        currentJob = job;
        job.status = 'running';
        if (job.guid) setPageStatus(job.guid, 'running', job.runningLabel || '处理中…');
        emitChange();
        try {
          await job.run({
            id: job.id,
            guid: job.guid,
            setProgress(label) {
              if (job.guid) setPageStatus(job.guid, 'running', label);
            }
          });
          job.status = 'done';
          if (job.guid) setPageStatus(job.guid, 'done', job.doneLabel || '已完成');
        } catch (err) {
          job.status = 'error';
          job.error = err;
          if (job.guid) setPageStatus(job.guid, 'error', (err && err.message) ? err.message.slice(0, 18) : '失败');
        }
        currentJob = null;
        emitChange();
      }
    } finally {
      running = false;
      currentJob = null;
      emitChange();
    }
  }

  function cancelPending() {
    while (queue.length > 0) {
      const job = queue.shift();
      if (job && job.guid) setPageStatus(job.guid, 'idle');
    }
    emitChange();
  }

  function clearBadges() {
    const keys = Array.from(pageStatuses.keys());
    pageStatuses.clear();
    keys.forEach(renderPageBadge);
    emitChange();
  }

  function getSnapshot() {
    return {
      running,
      current: currentJob ? { id: currentJob.id, guid: currentJob.guid, title: currentJob.title } : null,
      queuedCount: queue.length,
      queued: queue.map(j => ({ id: j.id, guid: j.guid, title: j.title })),
      statuses: Object.fromEntries(pageStatuses.entries())
    };
  }

  function subscribe(fn) {
    if (typeof fn === 'function') listeners.add(fn);
    return () => listeners.delete(fn);
  }

  const BatchQueue = Object.freeze({
    enqueue,
    cancelPending,
    clearBadges,
    setPageStatus,
    getPageStatus,
    getSnapshot,
    subscribe,
    renderPageBadge
  });

  const MangaCore = Object.freeze({
    get canvas() {
      return typeof root.canvas !== 'undefined' ? root.canvas : null;
    },
    history: Object.freeze({
      save() {
        return typeof root.saveStateByManual === 'function' ? root.saveStateByManual() : false;
      },
      undo() {
        return typeof root.undo === 'function' ? root.undo() : false;
      },
      redo() {
        return typeof root.redo === 'function' ? root.redo() : false;
      },
      jumpTo(index) {
        return typeof root.jumpToHistoryIndex === 'function' ? root.jumpToHistoryIndex(index) : false;
      },
      pause() {
        if (typeof root.changeDoNotSaveHistory === 'function') root.changeDoNotSaveHistory();
      },
      resume() {
        if (typeof root.changeDoSaveHistory === 'function') root.changeDoSaveHistory();
      },
      get stack() {
        return Array.isArray(root.stateStack) ? root.stateStack : [];
      },
      get currentIndex() {
        return typeof root.currentStateIndex === 'number' ? root.currentStateIndex : -1;
      }
    }),
    pages: Object.freeze({
      getCurrentGuid() {
        return typeof root.getCanvasGUID === 'function' ? root.getCanvasGUID() : (root.canvas && root.canvas.canvasGuid) || null;
      },
      listGuids() {
        return typeof root.btmGetGuids === 'function' ? root.btmGetGuids() : [];
      },
      count() {
        return typeof root.btmGetGuidsSize === 'function' ? root.btmGetGuidsSize() : 0;
      },
      async switchTo(guid, saveCurrent = true) {
        if (typeof root.chengeCanvasByGuid === 'function') {
          return await root.chengeCanvasByGuid(guid, saveCurrent);
        }
        return false;
      },
      async saveCurrent(guid = null, openDrawer = false) {
        if (typeof root.btmSaveProjectFile === 'function') {
          return await root.btmSaveProjectFile(guid, openDrawer);
        }
        return false;
      }
    }),
    layers: Object.freeze({
      getObjects() {
        return root.canvas && typeof root.canvas.getObjects === 'function' ? root.canvas.getObjects() : [];
      },
      getActive() {
        return root.canvas && typeof root.canvas.getActiveObject === 'function' ? root.canvas.getActiveObject() : null;
      },
      refreshPanel() {
        if (typeof root.updateLayerPanel === 'function') root.updateLayerPanel();
      }
    }),
    batch: BatchQueue,
    openRhythmDashboard
  });

  function collectActivePagesSpec(pagesOverride) {
    const H = root.MangaProductionHandbook;
    if (!H) return [];
    if (Array.isArray(pagesOverride) && pagesOverride.length > 0) {
      return pagesOverride;
    }
    if (root.__lastScript && Array.isArray(root.__lastScript.pages) && root.__lastScript.pages.length > 0) {
      return root.__lastScript.pages.map((pg, idx) => {
        const pCount = (pg.panels && pg.panels.length) || 3;
        const defaultCode = pCount === 1 ? 'S' : pCount === 2 ? 'R1' : pCount === 4 ? (idx % 2 === 0 ? 'R2' : 'A3') : (idx % 3 === 0 ? 'A1' : idx % 3 === 1 ? 'X1' : 'A2');
        const code = pg.layoutCode || defaultCode;
        const panels = (pg.panels || []).map(p => {
          if (root.ScriptPageCore && typeof root.ScriptPageCore.toWizard === 'function' && (p.lines || !p.line)) {
            const w = root.ScriptPageCore.toWizard(p);
            return { scene: w.scene, line: w.line };
          }
          return { scene: p.scene || '', line: p.line || '' };
        });
        const totalChars = panels.reduce((sum, p) => sum + Array.from(String(p.line || '').replace(/\s+/g, '')).length, 0);
        return {
          page_id: 'p' + String(idx + 1).padStart(3, '0'),
          layoutCode: code,
          panels,
          textCharsTotal: totalChars
        };
      });
    }
    if (MangaCore.canvas) {
      const spec = H.extractPageSpecFromCanvas(MangaCore.canvas);
      return [Object.assign({ page_id: 'p001' }, spec)];
    }
    return [];
  }

  function openRhythmDashboard(pagesOverride) {
    if (typeof document === 'undefined' || !document.body || !root.MangaProductionHandbook) return null;
    const H = root.MangaProductionHandbook;
    const old = document.getElementById('handbookRhythmModal');
    if (old) old.remove();

    let pages = collectActivePagesSpec(pagesOverride);
    if (!pages.length) {
      pages = [{
        page_id: 'p001',
        layoutCode: 'A1',
        panels: [
          { scene: '清晨车站特写，小雪等车', line: '小雪：今天也要加油！' },
          { scene: '中景，列车缓缓进站', line: '' },
          { scene: '远景，小雪微笑挥手', line: '小雪：早上好！' }
        ],
        textCharsTotal: 15
      }];
    }

    const modal = document.createElement('section');
    modal.id = 'handbookRhythmModal';
    modal.className = 'ui-card';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', '创作手册 · 6页连载节奏与五维审稿看板');
    modal.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10050;width:min(760px,94vw);max-height:86vh;overflow-y:auto;padding:18px 20px;box-shadow:0 16px 48px rgba(0,0,0,.45)';

    let selectedIdx = 0;

    function renderModalContent() {
      const audit = H.auditSixPageRhythm(pages);
      const curPage = pages[selectedIdx] || pages[0];
      const curRubric = H.autoScoreCanvasPage(curPage);
      const catColor = { R: '#2563eb', A: '#059669', X: '#d97706', S: '#7c3aed' };
      const dimLabels = {
        narrative: '叙事推进 (Narrative)',
        cameraAction: '镜头与动势 (Camera & Action)',
        layoutFocus: '版式主次 (Layout Focus)',
        characterEmotion: '人物情绪与演技 (Emotion)',
        readingFlow: '视线与气泡容量 (Reading Flow)'
      };

      const cardsHtml = pages.map((pg, idx) => {
        const l = H.getLayout(pg.layoutCode || 'A1');
        const rub = H.autoScoreCanvasPage(pg);
        const chars = pg.textCharsTotal != null
          ? pg.textCharsTotal
          : (pg.panels || []).reduce((s, p) => s + Array.from(String(p.line || '')).length, 0);
        const heatBg = chars > 90 ? '#dc2626' : chars > 60 ? '#d97706' : '#16a34a';
        const activeBorder = idx === selectedIdx ? '2px solid #38bdf8' : '1px solid rgba(148,163,184,.3)';
        return (
          '<button type="button" class="ui-btn" data-hb-page="' + idx + '" style="display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:8px 10px;min-width:105px;border:' + activeBorder + ';text-align:left">' +
          '<div style="display:flex;justify-content:space-between;width:100%;align-items:center">' +
          '<strong>' + (pg.page_id || ('P' + (idx + 1))) + '</strong>' +
          '<span style="background:' + (catColor[l.category] || '#334155') + ';color:#fff;padding:1px 6px;border-radius:4px;font-size:11px">' + l.code + '</span>' +
          '</div>' +
          '<span class="ui-muted" style="font-size:11px">' + l.panelCount + ' 格 · ' + chars + ' 字</span>' +
          '<div style="width:100%;height:4px;background:rgba(148,163,184,.25);border-radius:2px;overflow:hidden">' +
          '<div style="width:' + Math.min(100, Math.round((chars / 90) * 100)) + '%;height:100%;background:' + heatBg + '"></div>' +
          '</div>' +
          '<span style="font-size:11px;color:' + (rub.passed ? '#16a34a' : '#dc2626') + '">' + rub.total + '/10 ' + (rub.passed ? '通过' : '需微调') + '</span>' +
          '</button>'
        );
      }).join('');

      const dimsHtml = Object.keys(dimLabels).map(k => {
        const sc = curRubric.scores[k] || 0;
        const pct = sc * 50;
        const barCol = sc === 2 ? '#16a34a' : sc === 1 ? '#d97706' : '#dc2626';
        return (
          '<div style="display:flex;align-items:center;gap:10px;margin:4px 0;font-size:13px">' +
          '<span style="width:185px">' + dimLabels[k] + '</span>' +
          '<div style="flex:1;height:8px;background:rgba(148,163,184,.2);border-radius:4px;overflow:hidden">' +
          '<div style="width:' + pct + '%;height:100%;background:' + barCol + '"></div>' +
          '</div>' +
          '<strong style="width:36px;text-align:right">' + sc + ' / 2</strong>' +
          '</div>'
        );
      }).join('');

      const issuesHtml = audit.issues.length === 0
        ? '<p style="color:#16a34a;margin:6px 0;font-size:13px">✓ 跨页版式节奏（R/A/X/S 交错）与每泡 30 字容量上限全部达标。</p>'
        : '<ul style="margin:6px 0;padding-left:18px;color:#f59e0b;font-size:13px">' +
          audit.issues.map(iss => '<li>' + iss.message + '</li>').join('') +
          '</ul>';

      modal.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
        '<div><strong>《创作手册》6 页连载节奏与五维审稿看板</strong><span class="ui-muted" style="margin-left:8px;font-size:12px">共 ' + pages.length + ' 页</span></div>' +
        '<button type="button" class="ui-btn ui-btn-ghost" id="handbookRhythmClose" aria-label="关闭">×</button>' +
        '</div>' +
        '<p class="ui-muted" style="margin:0 0 6px;font-size:12px">① 版式链条与字数热力（R=规整 / A=非对称 / X=异形出血 / S=全幅单格）：</p>' +
        '<div id="handbookChainGrid" style="display:flex;gap:8px;overflow-x:auto;padding-bottom:6px">' + cardsHtml + '</div>' +
        '<div style="margin-top:12px;padding:10px 12px;border-radius:8px;background:rgba(148,163,184,.08)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
        '<strong>② ' + (curPage.page_id || ('P' + (selectedIdx + 1))) + ' 五维评分详情（版式 ' + curRubric.layoutCode + ' · ' + curRubric.layoutName + '）</strong>' +
        '<span style="font-weight:700;color:' + (curRubric.passed ? '#16a34a' : '#dc2626') + '">总分 ' + curRubric.total + ' / 10（' + (curRubric.passed ? '通过 ≥8' : '未达标 <8') + '）</span>' +
        '</div>' +
        '<div id="handbookRubricDetail">' + dimsHtml + '</div>' +
        (curRubric.blockers.length ? '<p style="color:#dc2626;font-size:12px;margin:6px 0 0">阻塞项：' + curRubric.blockers.join('；') + '</p>' : '') +
        '</div>' +
        '<div style="margin-top:12px">' +
        '<strong>③ 跨页节奏与 30 字气泡容量审查：</strong>' +
        '<div id="handbookIssuesList">' + issuesHtml + '</div>' +
        '</div>' +
        '<div class="svc-row" style="margin-top:12px;justify-content:flex-end;gap:8px">' +
        '<button type="button" class="ui-btn" id="handbookAutoFixRhythm" title="按《创作手册》5.3 节自动重排连续撞版并补齐 R/A/X 交错节奏">一键优化版式节奏</button>' +
        '<button type="button" class="ui-btn ui-btn-primary" id="handbookApplyToWizard">同步当前页版式到向导</button>' +
        '</div>';

      modal.querySelectorAll('[data-hb-page]').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedIdx = Number(btn.getAttribute('data-hb-page')) || 0;
          renderModalContent();
        });
      });

      const closeBtn = modal.querySelector('#handbookRhythmClose');
      if (closeBtn) closeBtn.addEventListener('click', () => modal.remove());

      const fixBtn = modal.querySelector('#handbookAutoFixRhythm');
      if (fixBtn) {
        fixBtn.addEventListener('click', () => {
          pages = H.optimizeSixPageRhythm(pages);
          if (root.__lastScript && Array.isArray(root.__lastScript.pages)) {
            root.__lastScript.pages.forEach((pg, idx) => {
              if (pages[idx]) pg.layoutCode = pages[idx].layoutCode;
            });
          }
          renderModalContent();
        });
      }

      const syncBtn = modal.querySelector('#handbookApplyToWizard');
      if (syncBtn) {
        syncBtn.addEventListener('click', () => {
          const target = pages[selectedIdx] || pages[0];
          const sel = document.getElementById('taskPageLayoutCode');
          if (sel && target && target.layoutCode) {
            sel.value = target.layoutCode;
            sel.dispatchEvent(new Event('change'));
          }
          modal.remove();
        });
      }
    }

    document.body.appendChild(modal);
    renderModalContent();
    return modal;
  }

  function registerBatchCommands() {
    if (!root.Commands || typeof root.Commands.register !== 'function') return false;
    root.Commands.register({
      id: 'batch.detectAllPanels',
      label: '批量分析所有页面分格与阅读顺序',
      group: '批处理',
      keywords: 'batch pages panel 批量 分格 多页',
      when: () => MangaCore.pages.count() > 0,
      run: async () => {
        const guids = MangaCore.pages.listGuids();
        const originGuid = MangaCore.pages.getCurrentGuid();
        if (!guids.length) return;
        guids.forEach((guid, idx) => {
          BatchQueue.enqueue({
            guid,
            title: '分析第 ' + (idx + 1) + ' 页分格',
            queuedLabel: '待分析',
            runningLabel: '分格中…',
            doneLabel: '已分格',
            async run(ctx) {
              await MangaCore.pages.switchTo(guid, true);
              ctx.setProgress('识别分格…');
              if (root.PanelAuto && typeof root.PanelAuto.detect === 'function') {
                const res = await root.PanelAuto.detect();
                const count = res && Array.isArray(res.panels) ? res.panels.length : 0;
                BatchQueue.setPageStatus(guid, 'done', count + ' 格');
              }
              await MangaCore.pages.saveCurrent(guid, false);
            }
          });
        });
        if (originGuid) {
          BatchQueue.enqueue({
            title: '返回原页面',
            async run() {
              await MangaCore.pages.switchTo(originGuid, true);
            }
          });
        }
      }
    });
    root.Commands.register({
      id: 'batch.clearBadges',
      label: '清除页面栏批处理状态标记',
      group: '批处理',
      keywords: 'batch clear badge 标记 清除',
      when: () => MangaCore.pages.count() > 0,
      run: () => BatchQueue.clearBadges()
    });
    root.Commands.register({
      id: 'handbook.openDashboard',
      label: '打开《创作手册》6页连载节奏与五维审稿看板',
      group: '审稿',
      keywords: 'handbook dashboard rhythm 5d 看板 五维 审稿 节奏 R1 A1 X1',
      when: () => !!root.MangaProductionHandbook,
      run: () => openRhythmDashboard()
    });
    root.Commands.register({
      id: 'batch.auditHandbookRhythm',
      label: '按《创作手册》审查多页版式节奏与台词容量',
      group: '批处理',
      keywords: 'handbook rhythm audit 节奏 版式 审稿 手册 R1 A1 X1',
      when: () => MangaCore.pages.count() > 0 && !!root.MangaProductionHandbook,
      run: async () => {
        const guids = MangaCore.pages.listGuids();
        const originGuid = MangaCore.pages.getCurrentGuid();
        if (!guids.length || !root.MangaProductionHandbook) return;
        const collected = [];
        guids.forEach((guid, idx) => {
          BatchQueue.enqueue({
            guid,
            title: '采集第 ' + (idx + 1) + ' 页版式与台词',
            queuedLabel: '待审稿',
            runningLabel: '审稿中…',
            doneLabel: '已采集',
            async run() {
              await MangaCore.pages.switchTo(guid, true);
              const spec = root.MangaProductionHandbook.extractPageSpecFromCanvas(MangaCore.canvas);
              collected.push(Object.assign({}, spec, {
                guid,
                page_id: 'p' + String(idx + 1).padStart(3, '0')
              }));
            }
          });
        });
        BatchQueue.enqueue({
          title: '汇总《创作手册》节奏审稿结果',
          async run() {
            if (originGuid) await MangaCore.pages.switchTo(originGuid, true);
            const report = root.MangaProductionHandbook.auditSixPageRhythm(collected);
            const issuePages = new Set();
            report.issues.forEach(iss => (iss.pages || []).forEach(pid => issuePages.add(pid)));
            collected.forEach(item => {
              if (issuePages.has(item.page_id)) {
                BatchQueue.setPageStatus(item.guid, 'error', '需调整(' + item.layoutCode + ')');
              } else {
                BatchQueue.setPageStatus(item.guid, 'done', '合格(' + item.layoutCode + ')');
              }
            });
            openRhythmDashboard(collected);
            if (typeof root.createToast === 'function') {
              root.createToast(
                '《创作手册》多页审稿',
                report.ok
                  ? '全部 ' + collected.length + ' 页版式节奏与气泡字数均符合规范！'
                  : '发现 ' + report.issues.length + ' 项节奏/字数提醒：' + report.issues[0].message,
                4200
              );
            }
          }
        });
      }
    });
    return true;
  }

  if (typeof document !== 'undefined' && typeof setInterval === 'function') {
    let tries = 0;
    const timer = setInterval(() => {
      if (registerBatchCommands() || ++tries > 40) clearInterval(timer);
    }, 250);
  } else {
    registerBatchCommands();
  }

  root.MangaBatchQueue = BatchQueue;
  root.MangaCore = MangaCore;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MangaCore, MangaBatchQueue: BatchQueue };
  }
})(typeof window !== 'undefined' ? window : globalThis);
