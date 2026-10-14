const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ctx = { Math, Number, String, Array, Object, Set, Error, RegExp };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/ai/manga-production-handbook.js'), 'utf8'), ctx);
const H = ctx.MangaProductionHandbook;

// 1. Layout Vocabulary (§5.2)
const layouts = H.listLayouts();
assert.equal(layouts.length, 9, 'Must define all 9 layout codes from §5.2');
const codes = layouts.map(l => l.code);
assert.deepEqual(codes, ['R1', 'R2', 'A1', 'A2', 'A3', 'X1', 'X2', 'X3', 'S']);

// Polygon geometry checks for non-rectangular / bleeding layouts
const x1Polys = H.buildLayoutPolygons('X1', 832, 1216);
assert.equal(x1Polys.length, 3);
assert.equal(x1Polys[0].slot, 'TALL-RIGHT');
// Tapered trapezoid right frame has top-left x != bottom-left x
assert.notEqual(x1Polys[0].points[0].x, x1Polys[0].points[3].x, 'X1 tall-right frame must be a slanted trapezoid');

const x2Polys = H.buildLayoutPolygons('X2', 832, 1216);
assert.equal(x2Polys.length, 3);
assert.equal(x2Polys[2].points[0].x, 0, 'X2 large left frame must bleed to left edge x=0');
assert.equal(x2Polys[2].points[0].y, 0, 'X2 large left frame must bleed to top edge y=0');

const sPolys = H.buildLayoutPolygons('S', 832, 1216);
assert.equal(sPolys.length, 1);

// 2. Six-Layer Whole-Page Prompt Compiler (§6.2 / §6.3 / §6.4)
const compiled = H.compileWholePagePrompt({
  layoutCode: 'A1',
  style: 'monochrome, greyscale, manga lineart, screentone',
  cast: [
    { name: 'Chen Mo', description: '1boy, short black hair, worn dark coat' },
    { name: 'Lin Wu', description: '1girl, shoulder-length hair, white shirt' }
  ],
  sceneLock: 'Nighttime station platform, wet concrete floor, overhead yellow sign.',
  panels: [
    { scene: 'wide shot of Chen Mo standing by the platform edge', line: '' },
    { scene: 'medium shot of Lin Wu holding out an old brass key', line: 'Lin Wu: Take this before the last train leaves.' },
    { scene: 'close-up of Chen Mo gripping the brass key tightly', line: 'Chen Mo: I understand. / Lin Wu: Do not look back.' }
  ],
  negativePrompt: 'lowres, bad anatomy, multiple panels, text, speech bubble, watermark'
});

assert.equal(compiled.layoutCode, 'A1');
assert.equal(compiled.panelCount, 3);
assert.equal(compiled.textBlockCount, 3);
assert(compiled.prompt.includes('speech bubbles, english text.'), 'Layer 1 must include speech bubble tag when dialogue is present');
assert(compiled.prompt.includes('LARGE BOTTOM frame occupying about sixty percent'), 'Layer 2 must include A1 layout geometry');
assert(compiled.prompt.includes('Chen Mo: 1boy, short black hair'), 'Layer 3 must include character anchor');
assert(compiled.prompt.includes('UPPER-RIGHT frame ONLY: wide shot of Chen Mo standing by the platform edge. Silent frame, no speech bubble or text in this frame.'));
assert(compiled.prompt.includes("UPPER-LEFT frame ONLY: medium shot of Lin Wu holding out an old brass key. Put text block 1 in Lin Wu's speech bubble inside this frame."));
assert(compiled.prompt.includes("LARGE BOTTOM frame ONLY: close-up of Chen Mo gripping the brass key tightly. Put text block 2 in Chen Mo's speech bubble, then text block 3 in Lin Wu's speech bubble, inside this same frame."));
assert(compiled.prompt.includes('Text: Take this before the last train leaves.\n\nI understand.\n\nDo not look back.'), 'Layer 6 must have a single Text: header followed by double-newline separated blocks');

// Negative prompt conflict removal (§6.4)
assert(!compiled.negativePrompt.includes('multiple panels'), 'Multi-panel page must strip "multiple panels" from negative prompt');
assert(!compiled.negativePrompt.includes('text'), 'Dialogue page must strip "text" from negative prompt');
assert(compiled.removedNegativeConflicts.includes('multiple panels'));
assert(compiled.removedNegativeConflicts.includes('text'));

// NAI V5 Native Chinese Dialogue Auto-Detection in 06 Whole-Page Compiler
const compiledZh = H.compileWholePagePrompt({
  layoutCode: 'R1',
  style: 'monochrome, greyscale, manga lineart',
  panels: [
    { scene: '特写：深夜车站，小雪转身微笑', line: '小雪：今天一定要赶上末班车！' },
    { scene: '远景：列车进站', line: '' }
  ]
});
assert(compiledZh.prompt.includes('speech bubbles, chinese text, vertical text.'), 'Chinese dialogue should auto-select native chinese vertical text tags for NAI V5');
assert(compiledZh.prompt.includes('close-up, night, dark background, train station, platform, turning around, looking back, smile'), 'Chinese camera/scene terms should auto-expand to Danbooru English tags');
assert(compiledZh.prompt.includes('Text: 今天一定要赶上末班车！'));

// NaiEngineCore payload preserves text & multi-panel for 06 Whole-Page prompts (no "no text" quality collision, no "multiple views" UC collision)
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/ai/nai-engine-core.js'), 'utf8'), ctx);
const payload06 = ctx.NaiEngineCore.payload({
  model: 'nai-diffusion-5-full',
  prompt: compiledZh.prompt,
  width: 832,
  height: 1216,
  quality: true,
  ucPreset: 0,
  preservePositiveStyle: true
});
assert(!/\bno text\b/i.test(payload06.input), '06 prompt with dialogue must not have "no text" appended by qualityToggle');
assert(!/\bmultiple views\b/i.test(payload06.parameters.negative_prompt), '06 multi-panel prompt must strip "multiple views" from UC preset');

// 3. Six-Page Rhythm & Visual Signature Auditor (§5.3)
const badPages = [
  { page_id: 'p001', visual_signature: ['A1', 'bottom', 'wide', 'left-to-right', 'medium', 'setup'], panels: [{ line: '短句' }] },
  { page_id: 'p002', visual_signature: ['A1', 'bottom', 'wide', 'left-to-right', 'medium', 'setup'], panels: [{ line: '这是一句非常非常长、明显超过了三十个汉字气泡容量上限的测试台词内容，用来触发容量预警检查' }] },
  { page_id: 'p003', visual_signature: ['A1', 'bottom', 'wide', 'left-to-right', 'medium', 'setup'], panels: [] },
  { page_id: 'p004', visual_signature: ['A2', 'right', 'medium', 'vertical', 'sparse', 'progress'], panels: [] },
  { page_id: 'p005', visual_signature: ['A1', 'bottom', 'close', 'diagonal', 'dense', 'turn'], panels: [] },
  { page_id: 'p006', visual_signature: ['A2', 'right', 'wide', 'left-to-right', 'medium', 'hook'], panels: [] }
];
const auditBad = H.auditSixPageRhythm(badPages);
assert.equal(auditBad.ok, false);
const rulesTriggered = new Set(auditBad.issues.map(i => i.rule));
assert(rulesTriggered.has('no-3-identical-layouts'), 'Should detect 3 consecutive A1 pages');
assert(rulesTriggered.has('adjacent-signature-variety'), 'Should detect <2 signature diffs between p001 and p002');
assert(rulesTriggered.has('six-page-window-mix'), 'Should detect missing R and X layouts in 6-page window');
assert(rulesTriggered.has('bubble-char-capacity'), 'Should detect >30 CJK chars in a single bubble');

const goodPages = [
  { page_id: 'p001', visual_signature: ['A1', 'bottom', 'wide', 'left-to-right', 'medium', 'setup'], panels: [{ line: '你来了。' }] },
  { page_id: 'p002', visual_signature: ['R1', 'lower', 'medium', 'still', 'sparse', 'dialogue'], panels: [{ line: '久等了。' }] },
  { page_id: 'p003', visual_signature: ['A2', 'right', 'full', 'vertical', 'medium', 'progress'], panels: [] },
  { page_id: 'p004', visual_signature: ['X1', 'right', 'close', 'diagonal', 'dense', 'turn'], panels: [] },
  { page_id: 'p005', visual_signature: ['X2', 'left-bleed', 'wide', 'right-to-left', 'sparse', 'climax'], panels: [] },
  { page_id: 'p006', visual_signature: ['A3', 'lower-left', 'medium', 'still', 'medium', 'aftermath'], panels: [] }
];
const auditGood = H.auditSixPageRhythm(goodPages);
assert.equal(auditGood.ok, true, 'Well-paced 6-page sequence should pass without issues');

// 4. Five-Dimension Page Rubric (§5.4)
const passRubric = H.evaluatePageRubric({ narrative: 2, cameraAction: 2, layoutFocus: 2, characterEmotion: 1, readingFlow: 2 }, []);
assert.equal(passRubric.passed, true);
assert.equal(passRubric.total, 9);

const zeroDimRubric = H.evaluatePageRubric({ narrative: 2, cameraAction: 2, layoutFocus: 2, characterEmotion: 0, readingFlow: 2 }, []);
assert.equal(zeroDimRubric.passed, false, 'Any 0-score dimension must fail even when total >= 8');

// 5. Free-tier Guard & nai_generate.py jobs conversion (§1.7 / §7.1 / §7.2)
assert.equal(H.validateNaiJob({ prompt: '1girl', output: 'out/p001.png', width: 832, height: 1216, steps: 28, scale: 5 }).ok, true);
const overPixel = H.validateNaiJob({ prompt: '1girl', output: 'out/p001.png', width: 1024, height: 1536, steps: 28, scale: 5 });
assert.equal(overPixel.ok, false, '1024x1536 exceeds 1,048,576 free pixel limit');
const unknownKey = H.validateNaiJob({ prompt: '1girl', output: 'out/p001.png', page_id: 'p001' });
assert.equal(unknownKey.ok, false, 'nai_generate.py jobs must reject unknown fields like page_id');

const converted = H.convert06PagesToJobs({
  negative_prompt: 'lowres, bad anatomy',
  jobs: [
    { page_id: 'p001', prompt_text: 'page 1 prompt', negative_append: 'extra digits', seed: 12345 },
    { page_id: 'p002', prompt_text: 'page 2 prompt', negative_append: '', seed: 12346 }
  ]
}, { outputDir: '/tmp/raw' });

assert.equal(converted.jobs.length, 2);
assert.equal(converted.jobs[0].output, '/tmp/raw/p001.png');
assert.equal(converted.jobs[0].negative_prompt, 'lowres, bad anatomy, extra digits');
assert.equal('page_id' in converted.jobs[0], false, 'Converted job must strip page_id into separate mapping');
assert.equal(converted.mapping[0].page_id, 'p001');

console.log('manga-production-handbook-test OK');
