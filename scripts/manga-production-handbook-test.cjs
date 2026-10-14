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

// 6. Multi-Character Spatial charCaptions for 06 Whole-Page Mode & NaiEngineCore multi-center support
assert.equal(compiled.charCaptions.length, 2, 'Should extract spatial charCaptions for Chen Mo and Lin Wu');
const chenMoCap = compiled.charCaptions.find(c => c.name === 'Chen Mo');
const linWuCap = compiled.charCaptions.find(c => c.name === 'Lin Wu');
assert(chenMoCap && chenMoCap.centers.length === 2, 'Chen Mo appears in panel 1 (upper-right) and panel 3 (large bottom)');
assert(linWuCap && linWuCap.centers.length === 2, 'Lin Wu appears in panel 2 (upper-left) and panel 3 (large bottom)');
assert.equal(chenMoCap.centers[0].x, 0.7, 'Upper-right panel center X should quantize to right side (0.7)');
assert.equal(chenMoCap.centers[0].y, 0.3, 'Upper-right panel center Y should quantize to upper row (0.3)');

const payloadSpatial = ctx.NaiEngineCore.payload({
  model: 'nai-diffusion-5-full',
  prompt: compiled.prompt,
  characters: compiled.charCaptions,
  width: 832,
  height: 1216,
  allowText: true,
  allowMultiPanel: true
});
assert.equal(payloadSpatial.parameters.use_coords, true, 'Spatial charCaptions must enable use_coords');
assert.equal(payloadSpatial.parameters.v4_prompt.use_coords, true);
assert.equal(
  payloadSpatial.parameters.v4_prompt.caption.char_captions[0].centers.length,
  2,
  'v4_prompt.caption.char_captions must preserve multi-panel centers array'
);

// 7. Canvas-Page-to-06-Spec Extractor & 5-Dimension Auto-Scorer
const a1Polys = H.buildLayoutPolygons('A1', 1200, 1700);
const mockCanvas = {
  width: 1200,
  height: 1700,
  objects: [
    { isPanel: true, points: a1Polys[0].points, tempPrompt: '特写：少女在车站回头' },
    { isPanel: true, points: a1Polys[1].points, tempPrompt: '中景：少年伸出手' },
    { isPanel: true, points: a1Polys[2].points, tempPrompt: '远景：夕阳下的列车进站，两人微笑' },
    { type: 'vertical-textbox', left: a1Polys[0].bbox.left + 20, top: a1Polys[0].bbox.top + 20, width: 60, height: 140, text: '终于等到你了！' },
    { type: 'vertical-textbox', left: a1Polys[2].bbox.left + 40, top: a1Polys[2].bbox.top + 40, width: 80, height: 180, text: '我们走吧。' }
  ]
};
const extractedSpec = H.extractPageSpecFromCanvas(mockCanvas);
assert.equal(extractedSpec.layoutCode, 'A1', 'Should infer A1 layout from 3-panel geometry');
assert.equal(extractedSpec.panels.length, 3);
assert.equal(extractedSpec.bubbleCount, 2);
assert(extractedSpec.panels[0].line.includes('终于等到你了！'));

const autoRubric = H.autoScoreCanvasPage(extractedSpec);
assert.equal(autoRubric.passed, true, 'Complete 3-panel page with camera variety, emotion cues, and short bubbles should pass 5D rubric');
assert(autoRubric.total >= 8);

// 8. Auto-Optimize 6-Page Rhythm
const optimizedSix = H.optimizeSixPageRhythm([
  { page_id: 'p001', layoutCode: 'A1', panels: [{}, {}, {}] },
  { page_id: 'p002', layoutCode: 'A1', panels: [{}, {}, {}] },
  { page_id: 'p003', layoutCode: 'A1', panels: [{}, {}, {}] },
  { page_id: 'p004', layoutCode: 'A1', panels: [{}, {}, {}] },
  { page_id: 'p005', layoutCode: 'A1', panels: [{}, {}, {}] },
  { page_id: 'p006', layoutCode: 'A1', panels: [{}, {}, {}] }
]);
const auditOptimized = H.auditSixPageRhythm(optimizedSix);
assert.equal(auditOptimized.ok, true, 'optimizeSixPageRhythm must resolve consecutive layout collisions and 6-page window mix');

// 9. Smart Text Bubble Patch Bright-Pixel Estimator (for covering NAI V5 native glyphs)
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/ai/manga-smart-text-core.js'), 'utf8'), ctx);
const mixedPixels = new Uint8ClampedArray([
  // 3 black ink pixels (glyph stroke) + 5 bright paper pixels
  15, 15, 15, 255,
  20, 20, 20, 255,
  10, 10, 10, 255,
  252, 252, 250, 255,
  254, 254, 252, 255,
  255, 255, 255, 255,
  250, 250, 248, 255,
  253, 253, 251, 255
]);
const patchCol = ctx.MangaSmartTextCore.computeBubblePatchColor(mixedPixels);
assert.equal(patchCol.safe, true);
assert(patchCol.r >= 250 && patchCol.g >= 250 && patchCol.b >= 248, 'computeBubblePatchColor must ignore black ink strokes and return clean paper color');

console.log('manga-production-handbook-test OK');
