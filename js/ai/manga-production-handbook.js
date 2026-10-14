/* MangaProductionHandbook: programmatic implementation of the Manga-NAI Production Manual (06 workflow).
 * Covers:
 * 1. Layout Vocabulary (§5.2): R1, R2, A1, A2, A3, X1, X2, X3, S with polygon geometry & English prompt templates.
 * 2. Six-Layer Whole-Page Prompt Compiler (§6.2 / §6.3): builds 06-style single-page multi-panel prompts with
 *    <POSITION> frame ONLY, speaker bubble mapping, and a single trailing Text: block, plus negative-prompt conflict checks.
 * 3. Six-Page Rhythm & Visual Signature Auditor (§5.3) + 5-Dimension Page Rubric (§5.4).
 * 4. Free-Tier Guard & `nai_generate.py` jobs.json / 06 `pages.json` converter & validator (§1.7 / §7.1 / §7.2).
 */
(function (root) {
  'use strict';

  const FREE_LIMITS = Object.freeze({
    maxPixels: 1048576,
    maxSteps: 28,
    maxScale: 10,
    maxSamples: 1,
    defaultWidth: 832,
    defaultHeight: 1216,
    defaultSteps: 28,
    defaultScale: 5.0,
    minQuotaPercent: 10
  });

  // §5.2 Layout vocabulary: R = regular, A = staggered/asymmetric, X = expressive/irregular/bleed, S = single emphasis
  const LAYOUT_VOCABULARY = Object.freeze({
    R1: {
      code: 'R1',
      category: 'R',
      name: '规整双格（R1）',
      panelCount: 2,
      purpose: '对照、问答、动作前后、停顿',
      slots: ['UPPER', 'LOWER'],
      promptBlock:
        'Exactly TWO rectangular bordered frames stacked vertically on one portrait page: an UPPER frame and a LOWER frame separated by a clean horizontal white gutter.\n' +
        'Read upper frame, then lower frame. No extra inset frames.\n' +
        'Each frame contains one complete moment and only its own text.',
      polygons(w, h, m, g) {
        const iw = w - 2 * m, ih = h - 2 * m, half = Math.round((ih - g) / 2);
        return [
          rectPoly(m, m, iw, half),
          rectPoly(m, m + half + g, iw, ih - half - g)
        ];
      }
    },
    R2: {
      code: 'R2',
      category: 'R',
      name: '规整四格网格（R2）',
      panelCount: 4,
      purpose: '稳定节拍、并列信息、平稳交谈',
      slots: ['UPPER-RIGHT', 'UPPER-LEFT', 'LOWER-RIGHT', 'LOWER-LEFT'],
      promptBlock:
        'Exactly FOUR rectangular frames in a clean two-by-two grid with straight white gutters.\n' +
        'Read upper-right, upper-left, lower-right, lower-left. No inset frames.\n' +
        'Each frame contains one complete moment and only its own text.',
      polygons(w, h, m, g) {
        const iw = w - 2 * m, ih = h - 2 * m;
        const cw = Math.round((iw - g) / 2), ch = Math.round((ih - g) / 2);
        return [
          rectPoly(m + cw + g, m, iw - cw - g, ch),
          rectPoly(m, m, cw, ch),
          rectPoly(m + cw + g, m + ch + g, iw - cw - g, ih - ch - g),
          rectPoly(m, m + ch + g, cw, ih - ch - g)
        ];
      }
    },
    A1: {
      code: 'A1',
      category: 'A',
      name: '上二小格 + 下方主大格（A1）',
      panelCount: 3,
      purpose: '准备 → 回应 → 情绪/动作落点（主格约占 60%）',
      slots: ['UPPER-RIGHT', 'UPPER-LEFT', 'LARGE BOTTOM'],
      promptBlock:
        'Exactly THREE bordered frames on one portrait page: a small UPPER-RIGHT frame, a wider UPPER-LEFT frame, and a LARGE BOTTOM frame occupying about sixty percent of the page height. The bottom frame has a gently slanted upper edge.\n' +
        'Read upper-right, upper-left, then bottom. No extra inset frames.\n' +
        'Each frame contains one complete moment and only its own text.',
      polygons(w, h, m, g) {
        const iw = w - 2 * m, ih = h - 2 * m;
        const topH = Math.round(ih * 0.38), rightW = Math.round(iw * 0.46), leftW = iw - rightW - g;
        const slant = Math.round(ih * 0.025);
        return [
          [
            { x: m + leftW + g, y: m },
            { x: m + iw, y: m },
            { x: m + iw, y: m + topH - slant },
            { x: m + leftW + g, y: m + topH }
          ],
          [
            { x: m, y: m },
            { x: m + leftW, y: m },
            { x: m + leftW, y: m + topH },
            { x: m, y: m + topH + slant }
          ],
          [
            { x: m, y: m + topH + slant + g },
            { x: m + iw, y: m + topH - slant + g },
            { x: m + iw, y: m + ih },
            { x: m, y: m + ih }
          ]
        ];
      }
    },
    A2: {
      code: 'A2',
      category: 'A',
      name: '右侧通高大格 + 左侧上下小格（A2）',
      panelCount: 3,
      purpose: '身体纵向动作、空间与反应并置',
      slots: ['TALL RIGHT', 'UPPER-LEFT', 'LOWER-LEFT'],
      promptBlock:
        'Exactly THREE bordered frames on one portrait page: one TALL RIGHT frame occupying the full page height and about forty-five percent of the width, and on the LEFT side an UPPER-LEFT frame above a LOWER-LEFT frame.\n' +
        'Read tall-right, upper-left, then lower-left. No extra inset frames.\n' +
        'Each frame contains one complete moment and only its own text.',
      polygons(w, h, m, g) {
        const iw = w - 2 * m, ih = h - 2 * m;
        const leftW = Math.round(iw * 0.52), rightW = iw - leftW - g;
        const topH = Math.round((ih - g) * 0.45);
        return [
          rectPoly(m + leftW + g, m, rightW, ih),
          rectPoly(m, m, leftW, topH),
          rectPoly(m, m + topH + g, leftW, ih - topH - g)
        ];
      }
    },
    A3: {
      code: 'A3',
      category: 'A',
      name: '错位四格（A3）',
      panelCount: 4,
      purpose: '连续行动、带节奏的交流（宽高不同、中缝错开）',
      slots: ['UPPER-RIGHT', 'UPPER-LEFT', 'LOWER-RIGHT', 'LOWER-LEFT'],
      promptBlock:
        'Exactly FOUR staggered rectangular frames with offset vertical gutters: a narrow UPPER-RIGHT frame and a wide UPPER-LEFT frame on the top row, above a wide LOWER-RIGHT frame and a narrow LOWER-LEFT frame on the bottom row.\n' +
        'Read upper-right, upper-left, lower-right, lower-left. No inset frames.\n' +
        'Each frame contains one complete moment and only its own text.',
      polygons(w, h, m, g) {
        const iw = w - 2 * m, ih = h - 2 * m;
        const topH = Math.round(ih * 0.44), botH = ih - topH - g;
        const topLeftW = Math.round(iw * 0.58), topRightW = iw - topLeftW - g;
        const botLeftW = Math.round(iw * 0.38), botRightW = iw - botLeftW - g;
        return [
          rectPoly(m + topLeftW + g, m, topRightW, topH),
          rectPoly(m, m, topLeftW, topH),
          rectPoly(m + botLeftW + g, m + topH + g, botRightW, botH),
          rectPoly(m, m + topH + g, botLeftW, botH)
        ];
      }
    },
    X1: {
      code: 'X1',
      category: 'X',
      name: '斜切梯形异形三格（X1）',
      panelCount: 3,
      purpose: '动势、不稳定、局势突变；斜线呼应动作',
      slots: ['TALL-RIGHT', 'UPPER-LEFT', 'LOWER-LEFT'],
      promptBlock:
        'Exactly THREE frames. One tall tapered trapezoid on the RIGHT occupies the full page height and about forty percent of its width. Its left edge slopes inward toward the bottom. On the LEFT, a small upper frame sits above a large lower frame.\n' +
        'Read tall-right, upper-left, lower-left. Keep faces and speech bubbles away from the acute corners. No extra inset frames.\n' +
        'Each frame contains one complete moment and only its own text.',
      polygons(w, h, m, g) {
        const iw = w - 2 * m, ih = h - 2 * m;
        const topSplit = Math.round(iw * 0.54), botSplit = Math.round(iw * 0.66);
        const leftMidY = Math.round(ih * 0.38), slantY = Math.round(ih * 0.05);
        const midSplitX = Math.round(topSplit + (botSplit - topSplit) * (leftMidY / ih));
        return [
          [
            { x: m + topSplit + g, y: m },
            { x: m + iw, y: m },
            { x: m + iw, y: m + ih },
            { x: m + botSplit + g, y: m + ih }
          ],
          [
            { x: m, y: m },
            { x: m + topSplit, y: m },
            { x: m + midSplitX, y: m + leftMidY - slantY },
            { x: m, y: m + leftMidY + slantY }
          ],
          [
            { x: m, y: m + leftMidY + slantY + g },
            { x: m + midSplitX, y: m + leftMidY - slantY + g },
            { x: m + botSplit, y: m + ih },
            { x: m, y: m + ih }
          ]
        ];
      }
    },
    X2: {
      code: 'X2',
      category: 'X',
      name: '左侧主画面出血 + 右侧上下两小格（X2）',
      panelCount: 3,
      purpose: '登场、情绪放大、揭示场面停留',
      slots: ['UPPER-RIGHT', 'LOWER-RIGHT', 'LARGE LEFT'],
      promptBlock:
        'Exactly THREE distinct frames. Two small bordered frames are stacked on the RIGHT. One large main frame fills the LEFT side and bleeds to the left page edge.\n' +
        'Read upper-right, lower-right, then the large left frame. White gutters clearly separate the three moments. No character crosses into either small frame.\n' +
        'Each frame contains one complete moment and only its own text.',
      polygons(w, h, m, g) {
        const iw = w - 2 * m, ih = h - 2 * m;
        const leftW = Math.round(iw * 0.6), rightW = iw - leftW - g;
        const topH = Math.round((ih - g) * 0.46);
        return [
          rectPoly(m + leftW + g, m, rightW, topH),
          rectPoly(m + leftW + g, m + topH + g, rightW, ih - topH - g),
          rectPoly(0, 0, m + leftW, h) // bleeds to top/left/bottom edges
        ];
      }
    },
    X3: {
      code: 'X3',
      category: 'X',
      name: '主大画面内嵌反应/道具插格（X3）',
      panelCount: 3,
      purpose: '同时性、微表情或关键道具细节特写（插格计入总格数）',
      slots: ['UPPER-RIGHT', 'LARGE MAIN', 'INSET'],
      allowsInset: true,
      promptBlock:
        'Exactly THREE frames: an UPPER-RIGHT lead-in frame, a LARGE MAIN frame occupying the lower seventy percent of the page, and ONE small bordered INSET frame overlapping the lower-left corner of the main frame to show a simultaneous close-up detail or reaction.\n' +
        'Read upper-right, large main frame, then the lower-left inset frame.\n' +
        'Each frame contains one complete moment and only its own text.',
      polygons(w, h, m, g) {
        const iw = w - 2 * m, ih = h - 2 * m;
        const topH = Math.round(ih * 0.28);
        return [
          rectPoly(m, m, iw, topH),
          rectPoly(m, m + topH + g, iw, ih - topH - g),
          rectPoly(m + Math.round(iw * 0.06), m + Math.round(ih * 0.66), Math.round(iw * 0.36), Math.round(ih * 0.28))
        ];
      }
    },
    S: {
      code: 'S',
      category: 'S',
      name: '单格全幅强调页（S）',
      panelCount: 1,
      purpose: '停顿、重大揭示、情绪巅峰',
      slots: ['FULL PAGE'],
      promptBlock:
        'Exactly ONE large full-page bordered frame occupying the entire page.\n' +
        'No extra inset frames or split panels. Focus on one decisive moment.',
      polygons(w, h, m) {
        return [rectPoly(m, m, w - 2 * m, h - 2 * m)];
      }
    }
  });

  function rectPoly(x, y, w, h) {
    return [
      { x: Math.round(x), y: Math.round(y) },
      { x: Math.round(x + w), y: Math.round(y) },
      { x: Math.round(x + w), y: Math.round(y + h) },
      { x: Math.round(x), y: Math.round(y + h) }
    ];
  }

  function getLayout(code) {
    const key = String(code || 'A1').trim().toUpperCase();
    return LAYOUT_VOCABULARY[key] || LAYOUT_VOCABULARY.A1;
  }

  function listLayouts() {
    return Object.keys(LAYOUT_VOCABULARY).map(k => LAYOUT_VOCABULARY[k]);
  }

  function buildLayoutPolygons(code, width, height) {
    const w = Math.max(200, Number(width) || 1200);
    const h = Math.max(200, Number(height) || 1700);
    const m = Math.round(0.04 * Math.min(w, h));
    const g = Math.round(0.014 * Math.min(w, h));
    const layout = getLayout(code);
    const polys = layout.polygons(w, h, m, g);
    return polys.map((pts, i) => {
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      return {
        index: i,
        slot: layout.slots[i] || ('FRAME ' + (i + 1)),
        points: pts,
        bbox: { left: minX, top: minY, width: maxX - minX, height: maxY - minY }
      };
    });
  }

  // §6.2 & §6.3 Six-Layer Whole-Page Prompt Compiler
  function compileWholePagePrompt(spec) {
    const s = spec || {};
    const layout = getLayout(s.layoutCode || (s.layout && s.layout.code) || 'A1');
    const panels = Array.isArray(s.panels) ? s.panels : [];
    const hasDialogue = panels.some(p => Array.isArray(p.lines) ? p.lines.some(l => (l.render_text || l.text || l.zh || '').trim()) : Boolean(String(p.line || '').trim()));

    // Layer 1: Global style, colour mode, medium, text language
    const baseStyle = String(s.style || 'monochrome, greyscale, manga lineart, delicate lineart, comic').trim().replace(/\.$/, '');
    const allDialogueText = panels
      .map(p => normalizePanelLines(p).map(l => l.text).join(''))
      .join('');
    const hasCjkDialogue = /[\u4e00-\u9fff]/.test(allDialogueText);
    const defaultLangTag = hasDialogue
      ? (hasCjkDialogue ? 'speech bubbles, chinese text, vertical text' : 'speech bubbles, english text')
      : 'no text';
    const langTag = s.textLanguage ? String(s.textLanguage).trim() : defaultLangTag;
    const layer1 = baseStyle + (langTag ? ', ' + langTag : '') + '.';

    // Layer 2: Exact frame count, geometry, borders, reading order
    const layer2 = s.customLayoutPrompt ? String(s.customLayoutPrompt).trim() : layout.promptBlock;

    // Layer 3: Cast identity anchors, continuity & physical scene lock
    const castLines = [];
    if (Array.isArray(s.cast)) {
      s.cast.forEach(c => {
        if (!c) return;
        if (typeof c === 'string' && c.trim()) castLines.push(c.trim());
        else if (c.name && c.description) castLines.push(c.name.trim() + ': ' + c.description.trim().replace(/\.$/, '') + '.');
      });
    }
    if (s.sceneLock) castLines.push(String(s.sceneLock).trim().replace(/\.$/, '') + '.');
    const layer3 = castLines.join('\n');

    // Layer 4 & 5: Per-frame <SLOT> ONLY + text block references, and collect trailing Text blocks
    const frameBlocks = [];
    const textBlocks = [];
    let blockCounter = 0;

    for (let i = 0; i < layout.panelCount; i++) {
      const p = panels[i] || {};
      const slot = (p.position ? String(p.position).toUpperCase().replace(/_/g, '-') : layout.slots[i]) || ('FRAME ' + (i + 1));
      const rawVisual = String(p.visual_en || p.scene || p.visual_zh || 'character in scene').trim().replace(/\.$/, '');
      const visual = expandSceneToEnglishTags(rawVisual);
      const rawLines = normalizePanelLines(p);
      let bubbleInstr = '';
      if (!rawLines.length) {
        bubbleInstr = ' Silent frame, no speech bubble or text in this frame.';
      } else {
        const refs = rawLines.map(lineObj => {
          blockCounter++;
          textBlocks.push(lineObj.text);
          const sp = lineObj.speaker && lineObj.speaker !== '旁白' ? (lineObj.speaker + "'s speech bubble") : (lineObj.speaker === '旁白' ? 'a narration box' : 'a speech bubble');
          return 'text block ' + blockCounter + ' in ' + sp;
        });
        if (refs.length === 1) {
          bubbleInstr = ' Put ' + refs[0] + ' inside this frame.';
        } else {
          bubbleInstr = ' Put ' + refs.slice(0, -1).join(', ') + ', then ' + refs[refs.length - 1] + ', inside this same frame. Bubble tails identify their speakers.';
        }
      }
      frameBlocks.push(slot + ' frame ONLY: ' + visual + '.' + bubbleInstr);
    }

    const layer4 = frameBlocks.join('\n\n');

    // Layer 6: Trailing Text block (each block appears once, separated by blank lines)
    let layer5and6 = '';
    if (textBlocks.length > 0) {
      layer5and6 =
        'Render only the following text blocks, each exactly once.\n' +
        'Do not print frame labels, block numbers, character names or page titles.\n\n' +
        'Text: ' + textBlocks[0] +
        (textBlocks.length > 1 ? '\n\n' + textBlocks.slice(1).join('\n\n') : '');
    } else {
      layer5and6 = 'Do not print any speech bubbles, frame labels, character names or text.';
    }

    const prompt = [layer1, layer2, layer3, layer4, layer5and6].filter(Boolean).join('\n\n');

    // Negative prompt conflict audit (§6.4)
    const rawNegative = String(s.negativePrompt || '').trim();
    const cleanedNegative = reconcileWholePageNegative(rawNegative, {
      isMultiPanel: layout.panelCount > 1,
      hasDialogue: textBlocks.length > 0,
      allowsInset: !!layout.allowsInset
    });

    return {
      prompt,
      negativePrompt: cleanedNegative.negative,
      removedNegativeConflicts: cleanedNegative.removed,
      layoutCode: layout.code,
      panelCount: layout.panelCount,
      textBlockCount: textBlocks.length,
      textCharsTotal: textBlocks.join('').length
    };
  }

  const CN_SCENE_LEXICON = Object.freeze([
    [/特写|面部特写|脸部特写/g, 'close-up'],
    [/大特写|眼部特写/g, 'extreme close-up'],
    [/中景|半身/g, 'medium shot, cowboy shot'],
    [/全景|远景|大远景/g, 'wide shot, establishing shot'],
    [/俯视|俯拍|高机位/g, 'from above, high angle'],
    [/仰视|仰拍|低机位/g, 'from below, low angle'],
    [/背影|从背后/g, 'from behind, back view'],
    [/侧脸|侧面/g, 'profile, from side'],
    [/斜切|倾斜镜头/g, 'dutch angle'],
    [/速度线/g, 'speed lines, motion lines'],
    [/冲击线|集中线/g, 'emphasis lines'],
    [/清晨|早晨/g, 'morning light'],
    [/黄昏|夕阳|傍晚/g, 'sunset, golden hour'],
    [/夜晚|深夜|夜里/g, 'night, dark background'],
    [/雨天|下雨|暴雨/g, 'rain, wet'],
    [/车站|站台/g, 'train station, platform'],
    [/列车|电车|车厢/g, 'train, train interior'],
    [/教室/g, 'classroom'],
    [/走廊/g, 'hallway, corridor'],
    [/街道|街头/g, 'street, city street'],
    [/屋顶|天台/g, 'rooftop'],
    [/转身|回头/g, 'turning around, looking back'],
    [/奔跑|跑向/g, 'running'],
    [/微笑|笑了/g, 'smile'],
    [/惊讶|震惊/g, 'surprised, wide eyes'],
    [/严肃|凝重/g, 'serious expression'],
    [/流泪|哭泣/g, 'tears, crying'],
    [/握紧|抓紧/g, 'clenched hand, gripping tightly'],
    [/递给|伸出手/g, 'reaching out, holding out']
  ]);

  function expandSceneToEnglishTags(sceneText) {
    const raw = String(sceneText || '').trim().replace(/\.$/, '');
    if (!raw) return 'character in scene';
    if (!/[\u4e00-\u9fff]/.test(raw)) return raw;
    const matched = [];
    CN_SCENE_LEXICON.forEach(pair => {
      if (pair[0].test(raw)) {
        pair[0].lastIndex = 0;
        if (matched.indexOf(pair[1]) < 0) matched.push(pair[1]);
      }
    });
    return matched.length ? (matched.join(', ') + ' (' + raw + ')') : raw;
  }

  function normalizePanelLines(p) {
    if (!p) return [];
    if (Array.isArray(p.lines)) {
      return p.lines
        .map(l => ({
          speaker: String((l && l.speaker) || '').trim(),
          text: String((l && (l.render_text || l.text || l.zh)) || '').trim()
        }))
        .filter(l => l.text.length > 0);
    }
    if (typeof p.line === 'string' && p.line.trim()) {
      return p.line
        .split(/\s*(?:\/|／|\||｜|\n)\s*/)
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
          const m = /^([^:：\n]{1,24}?)\s*[:：]\s*(.+)$/.exec(part);
          return m ? { speaker: m[1].trim(), text: m[2].trim() } : { speaker: '', text: part };
        });
    }
    return [];
  }

  // §6.4 Reconcile negative prompt conflicts for whole-page generation
  function reconcileWholePageNegative(negativeStr, opts) {
    const o = opts || {};
    const tags = String(negativeStr || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    const removed = [];
    const kept = tags.filter(tag => {
      const low = tag.toLowerCase();
      if (o.isMultiPanel && (low === 'multiple panels' || low === 'multi-panel' || low === 'comic' || low === 'multiple views')) {
        removed.push(tag);
        return false;
      }
      if (o.hasDialogue && (low === 'text' || low === 'speech bubble' || low === 'speech bubbles' || low === 'english text' || low === 'chinese text' || low === 'vertical text' || low === 'dialogue')) {
        removed.push(tag);
        return false;
      }
      if (o.allowsInset && (low === 'inset frame' || low === 'extra inset frames')) {
        removed.push(tag);
        return false;
      }
      return true;
    });
    return { negative: kept.join(', '), removed };
  }

  // §5.3 Six-Page Rhythm & Visual Signature Auditor
  // visual_signature format: [layoutCode, heroPosArea, heroShot, actionDir, density, beat]
  function auditSixPageRhythm(pages) {
    const list = Array.isArray(pages) ? pages : [];
    const issues = [];
    const pageSummaries = list.map((p, idx) => {
      const sig = Array.isArray(p.visual_signature) ? p.visual_signature : [];
      const code = String((p.layout && p.layout.code) || p.layoutCode || sig[0] || 'A1').toUpperCase();
      const layout = getLayout(code);
      return {
        pageId: p.page_id || ('p' + String(idx + 1).padStart(3, '0')),
        index: idx,
        code: layout.code,
        category: layout.category,
        signature: [
          layout.code,
          sig[1] || (p.layout && p.layout.hero_panel) || '',
          sig[2] || (p.panels && p.panels[0] && p.panels[0].shot) || '',
          sig[3] || '',
          sig[4] || '',
          sig[5] || p.purpose || ''
        ],
        exceptionReason: p.exception_reason || null
      };
    });

    // Rule 1: No 3 consecutive pages with the exact same layout code (unless exception_reason is documented)
    for (let i = 0; i <= pageSummaries.length - 3; i++) {
      const a = pageSummaries[i], b = pageSummaries[i + 1], c = pageSummaries[i + 2];
      if (a.code === b.code && b.code === c.code && !c.exceptionReason) {
        issues.push({
          rule: 'no-3-identical-layouts',
          pages: [a.pageId, b.pageId, c.pageId],
          message: '第 ' + (i + 1) + '–' + (i + 3) + ' 页连续 3 页复用同一版式（' + a.code + '），违反手册 5.3 节节奏要求。'
        });
      }
    }

    // Rule 2: Adjacent pages must have at least 2 substantive changes in visual_signature
    for (let i = 0; i < pageSummaries.length - 1; i++) {
      const cur = pageSummaries[i], nxt = pageSummaries[i + 1];
      if (nxt.exceptionReason) continue;
      let diffs = 0;
      let nonEmptyPairs = 0;
      for (let k = 0; k < 6; k++) {
        const v1 = String(cur.signature[k] || '').trim();
        const v2 = String(nxt.signature[k] || '').trim();
        if (v1 && v2) {
          nonEmptyPairs++;
          if (v1 !== v2) diffs++;
        }
      }
      if (nonEmptyPairs >= 2 && diffs < 2) {
        issues.push({
          rule: 'adjacent-signature-variety',
          pages: [cur.pageId, nxt.pageId],
          message: cur.pageId + ' 与 ' + nxt.pageId + ' 相邻视觉签名实质变化不足 2 项（当前仅 ' + diffs + ' 项变化）。'
        });
      }
    }

    // Rule 3: Every 6-page sliding window must contain at least 1 R, 1 X (or S), and >= 3 distinct layout codes
    if (pageSummaries.length >= 6) {
      for (let start = 0; start <= pageSummaries.length - 6; start++) {
        const win = pageSummaries.slice(start, start + 6);
        const hasR = win.some(x => x.category === 'R');
        const hasX = win.some(x => x.category === 'X' || x.category === 'S');
        const distinctCodes = new Set(win.map(x => x.code)).size;
        if (!hasR || !hasX || distinctCodes < 3) {
          issues.push({
            rule: 'six-page-window-mix',
            pages: win.map(x => x.pageId),
            message:
              '第 ' + (start + 1) + '–' + (start + 6) + ' 页窗口版式交错不足：' +
              (!hasR ? '缺少规整版式（R1/R2）；' : '') +
              (!hasX ? '缺少异形/出血/强调版式（X1/X2/X3/S）；' : '') +
              (distinctCodes < 3 ? '具体版式少于 3 种（当前 ' + distinctCodes + ' 种）。' : '')
          });
        }
      }
    }

    // Rule 4: Dialogue bubble character length warning (§4.3: ~8-30 CJK chars per bubble)
    list.forEach((p, idx) => {
      const pageId = p.page_id || ('p' + String(idx + 1).padStart(3, '0'));
      (p.panels || []).forEach((panel, pi) => {
        const lines = normalizePanelLines(panel);
        if (lines.length > 2) {
          issues.push({
            rule: 'bubbles-per-panel',
            pages: [pageId],
            message: pageId + ' 第 ' + (pi + 1) + ' 格气泡数为 ' + lines.length + '（手册建议常规每格 0–2 个气泡）。'
          });
        }
        lines.forEach(l => {
          const len = Array.from(l.text).length;
          if (len > 30) {
            issues.push({
              rule: 'bubble-char-capacity',
              pages: [pageId],
              message: pageId + ' 第 ' + (pi + 1) + ' 格台词「' + l.text.slice(0, 12) + '…」长达 ' + len + ' 字（超过每泡 30 字容量预警，建议拆分或精简）。'
            });
          }
        });
      });
    });

    return {
      ok: issues.length === 0,
      pageCount: list.length,
      issues,
      summaries: pageSummaries
    };
  }

  // §5.4 5-Dimension Page Rubric Evaluator (0-2 each, total 10; passes when total >= 8, no 0-score dimension, and no blockers)
  function evaluatePageRubric(scores, blockers) {
    const dims = ['narrative', 'cameraAction', 'layoutFocus', 'characterEmotion', 'readingFlow'];
    const normalized = {};
    let total = 0;
    const zeroDims = [];
    dims.forEach(d => {
      const raw = Number(scores && scores[d]);
      const val = Number.isFinite(raw) ? Math.max(0, Math.min(2, Math.round(raw))) : 0;
      normalized[d] = val;
      total += val;
      if (val === 0) zeroDims.push(d);
    });
    const activeBlockers = Array.isArray(blockers) ? blockers.filter(Boolean) : [];
    const passed = total >= 8 && zeroDims.length === 0 && activeBlockers.length === 0;
    return {
      passed,
      total,
      scores: normalized,
      zeroDims,
      blockers: activeBlockers
    };
  }

  // §7.1 & §7.2 Validate & Convert jobs for `nai_generate.py`
  function validateNaiJob(job) {
    const errors = [];
    if (!job || typeof job !== 'object') return { ok: false, errors: ['Job must be an object'] };
    const hasPrompt = typeof job.prompt === 'string' && job.prompt.trim().length > 0;
    const hasPromptFile = typeof job.prompt_file === 'string' && job.prompt_file.trim().length > 0;
    if ((hasPrompt && hasPromptFile) || (!hasPrompt && !hasPromptFile)) {
      errors.push('prompt 与 prompt_file 必须二选一且非空');
    }
    const hasNeg = typeof job.negative_prompt === 'string' && job.negative_prompt.trim().length > 0;
    const hasNegFile = typeof job.negative_file === 'string' && job.negative_file.trim().length > 0;
    if (hasNeg && hasNegFile) {
      errors.push('negative_prompt 与 negative_file 不能同时指定');
    }
    if (typeof job.output !== 'string' || !/\.png$/i.test(job.output.trim())) {
      errors.push('output 必须为 .png 路径');
    }
    const width = job.width == null ? FREE_LIMITS.defaultWidth : Number(job.width);
    const height = job.height == null ? FREE_LIMITS.defaultHeight : Number(job.height);
    if (!Number.isInteger(width) || width <= 0 || width % 64 !== 0) {
      errors.push('width 必须为正的 64 倍数');
    }
    if (!Number.isInteger(height) || height <= 0 || height % 64 !== 0) {
      errors.push('height 必须为正的 64 倍数');
    }
    if (width * height > FREE_LIMITS.maxPixels) {
      errors.push('尺寸 ' + width + 'x' + height + ' (' + (width * height) + ' px) 超过免费上限 ' + FREE_LIMITS.maxPixels);
    }
    const steps = job.steps == null ? FREE_LIMITS.defaultSteps : Number(job.steps);
    if (!Number.isInteger(steps) || steps < 1 || steps > FREE_LIMITS.maxSteps) {
      errors.push('steps 必须为 1–' + FREE_LIMITS.maxSteps + ' 整数');
    }
    const scale = job.scale == null ? FREE_LIMITS.defaultScale : Number(job.scale);
    if (!Number.isFinite(scale) || scale <= 0 || scale > FREE_LIMITS.maxScale) {
      errors.push('scale 必须为 (0, ' + FREE_LIMITS.maxScale + '] 内的有限数');
    }
    if (job.seed != null) {
      const seed = Number(job.seed);
      if (!Number.isInteger(seed) || seed < 0 || seed >= 4294967296) {
        errors.push('seed 必须为 [0, 2^32) 内的整数');
      }
    }
    const allowedKeys = new Set([
      'prompt', 'prompt_file', 'negative_prompt', 'negative_file',
      'output', 'width', 'height', 'steps', 'scale', 'seed'
    ]);
    Object.keys(job).forEach(k => {
      if (!allowedKeys.has(k)) errors.push('包含 nai_generate.py 不支持的未知字段: ' + k);
    });
    return { ok: errors.length === 0, errors };
  }

  // Convert 06 `pages.json` ({ negative_prompt, jobs: [{ prompt_text, negative_append, output, seed, width, height, scale, page_id }] })
  // into strict `nai_generate.py` jobs array + separate mapping list (§7.2)
  function convert06PagesToJobs(pagesJson, options) {
    const opts = options || {};
    const globalNeg = String((pagesJson && pagesJson.negative_prompt) || '').trim();
    const rawJobs = Array.isArray(pagesJson && pagesJson.jobs) ? pagesJson.jobs : [];
    const jobs = [];
    const mapping = [];
    const seenOutputs = new Set();

    rawJobs.forEach((item, idx) => {
      const prompt = String(item.prompt || item.prompt_text || '').trim();
      const negAppend = String(item.negative_append || '').trim();
      const mergedNeg = [globalNeg, negAppend].filter(Boolean).join(', ');
      const pageId = item.page_id || ('p' + String(idx + 1).padStart(3, '0'));
      const outPath = opts.outputDir
        ? opts.outputDir.replace(/\/+$/, '') + '/' + pageId + '.png'
        : String(item.output || ('../产物/raw/r01/' + pageId + '_a.png')).trim();
      if (seenOutputs.has(outPath)) {
        throw new Error('Duplicate output path in jobs conversion: ' + outPath);
      }
      seenOutputs.add(outPath);
      const job = {
        prompt,
        output: outPath,
        width: item.width || FREE_LIMITS.defaultWidth,
        height: item.height || FREE_LIMITS.defaultHeight,
        steps: Math.min(FREE_LIMITS.maxSteps, item.steps || FREE_LIMITS.defaultSteps),
        scale: item.scale || FREE_LIMITS.defaultScale,
        seed: item.seed != null ? Number(item.seed) : (2026092901 + idx)
      };
      if (mergedNeg) job.negative_prompt = mergedNeg;
      const check = validateNaiJob(job);
      if (!check.ok) {
        throw new Error('Invalid converted job at index ' + idx + ' (' + pageId + '): ' + check.errors.join('; '));
      }
      jobs.push(job);
      mapping.push({ index: idx, page_id: pageId, output: outPath, seed: job.seed });
    });

    return { jobs, mapping };
  }

  root.MangaProductionHandbook = Object.freeze({
    FREE_LIMITS,
    LAYOUT_VOCABULARY,
    getLayout,
    listLayouts,
    buildLayoutPolygons,
    expandSceneToEnglishTags,
    compileWholePagePrompt,
    reconcileWholePageNegative,
    auditSixPageRhythm,
    evaluatePageRubric,
    validateNaiJob,
    convert06PagesToJobs
  });
})(typeof window !== 'undefined' ? window : globalThis);
