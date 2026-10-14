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
    batch: BatchQueue
  });

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
