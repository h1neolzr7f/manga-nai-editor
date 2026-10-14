const assert = require('assert');
const vm = require('vm'), fs = require('fs'), path = require('path');
const ctx = {}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/ui/util/cjk-break.js'), 'utf8') + ';this.CjkBreak=CjkBreak;', ctx);
const { breakLines, breakElliptical, tokenizeVertical, toVerticalGlyph, NO_START, NO_END } = ctx.CjkBreak;
const cases = ['伞忘在家里了……', '这是……小猫？', '今天也要加油！', '要一起走吗？', '你说什么？！真的假的……', '「明天见」她说。', '啊……下雨了。', '我们一起回家吧，好不好？', 'abc'];
for (const t of cases) for (let per = 2; per <= 9; per++) {
  const lines = breakLines(t, per);
  assert.strictEqual(lines.join(''), t, 'no glyph lost: ' + t);
  lines.slice(1).forEach(l => assert.ok(NO_START.indexOf(Array.from(l)[0]) < 0, `line starts with closing punct: ${t} @${per} → ${lines.join('|')}`));
  lines.slice(0, -1).forEach(l => assert.ok(NO_END.indexOf(Array.from(l).pop()) < 0, `line ends with opening bracket: ${t} @${per} → ${lines.join('|')}`));
}
assert.strictEqual(breakLines('这是……小猫？', 5).join('|'), '这是……|小猫？');
assert.strictEqual(breakLines('今天也要加油！', 9).join('|'), '今天也要加油！');

// Tate-chu-yoko tokenisation: 2-digit numbers and ?!/!! pairs combine into single cells, 3+ digits stay separate
assert.strictEqual(tokenizeVertical('什么！？第12话100%').join('|'), '什|么|!?|第|12|话|1|0|0|%');
assert.strictEqual(toVerticalGlyph('—'), '︱');
assert.strictEqual(toVerticalGlyph('「'), '﹁');
assert.strictEqual(toVerticalGlyph('…'), '︙');

// Elliptical line breaking preserves all characters and shapes multi-line balloons into an inscribed oval
const longText = '今天放学以后我们一起去车站前面的那家书店看看最新出的漫画吧！';
const ovalLines = breakElliptical(longText, 7);
assert.strictEqual(ovalLines.join(''), longText);
assert.ok(ovalLines.length >= 3);
const midIdx = Math.floor(ovalLines.length / 2);
assert.ok(Array.from(ovalLines[midIdx]).length >= Array.from(ovalLines[0]).length, 'middle line is at least as wide as top line');

console.log('cjk-break: OK');
