// Kinsoku line breaking for short CJK dialogue: closing punctuation (。，！？…」 etc.) never starts a line
// and opening brackets never end one. Lines are balanced to about perLine glyphs, with optional
// inscribed-ellipse shaping (shorter first/last lines, wider middle lines) and tate-chu-yoko tokenisation.
var CjkBreak=(function(){
var NO_START='，。、．,.！？!?…‥：；:;」』）)】〉》〕］]}〟’”ー～〜ゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ';
var NO_END='「『（(【〈《〔［[{〝‘“';
var VERTICAL_PUNCT_MAP={
'—':'︱','―':'︱','–':'︲','…':'︙','‥':'︰','～':'｜','〜':'｜',
'（':'︵','）':'︶','〔':'︹','〕':'︺','【':'︻','】':'︼',
'《':'︽','》':'︾','〈':'︿','〉':'﹀','「':'﹁','」':'﹂',
'『':'﹃','』':'﹄','｛':'︷','｝':'︸','［':'﹇','］':'﹈'
};
function glyphs(s){return Array.from(String(s||''));}
function tokenizeVertical(s){
var chars=glyphs(s),tokens=[];
for(var i=0;i<chars.length;i++){
var c=chars[i],next=chars[i+1],next2=chars[i+2];
// Combine 2-digit numbers (when not part of 3+ digits) or ?! / !! / !? into a single tate-chu-yoko cell
if(/[0-9]/.test(c)&&next&&/[0-9]/.test(next)&&!(next2&&/[0-9]/.test(next2))&&!(i>0&&/[0-9]/.test(chars[i-1]))){
tokens.push(c+next);i++;continue;
}
if((c==='!'||c==='?'||c==='！'||c==='？')&&(next==='!'||next==='?'||next==='！'||next==='？')&&!(next2&&(next2==='!'||next2==='?'||next2==='！'||next2==='？'))){
var norm=(c==='！'?'!':c==='？'?'?':c)+(next==='！'?'!':next==='？'?'?':next);
tokens.push(norm);i++;continue;
}
tokens.push(c);
}
return tokens;
}
function toVerticalGlyph(ch){
return Object.prototype.hasOwnProperty.call(VERTICAL_PUNCT_MAP,ch)?VERTICAL_PUNCT_MAP[ch]:ch;
}
function breakLines(text,perLine,options){
var g=glyphs(text).filter(function(c){return c!=='\n';});
var n=Math.max(1,Math.floor(perLine)||1);
if(g.length<=n)return [g.join('')];
var lines=Math.ceil(g.length/n),target=Math.ceil(g.length/lines),out=[],cur=[];
var elliptical=options&&options.elliptical&&lines>=3;
for(var i=0;i<g.length;i++){
cur.push(g[i]);
var left=g.length-i-1;
var lineIdx=out.length;
var lineTarget=target;
if(elliptical){
// Inscribed ellipse profile: first/last lines ~78% of max width, middle lines ~112%
var rel=lines>1?(lineIdx/(lines-1))*2-1:0;
var chord=Math.sqrt(Math.max(0.35,1-0.42*rel*rel));
lineTarget=Math.max(2,Math.round(n*chord));
}
if(cur.length>=lineTarget&&left>0){
// pull following no-start glyphs onto this line (handles "……", "！？")
while(i+1<g.length&&NO_START.indexOf(g[i+1])>=0){cur.push(g[++i]);}
// never end a line with an opening bracket
while(cur.length>1&&NO_END.indexOf(cur[cur.length-1])>=0){cur.pop();i--;}
if(i<g.length-1){out.push(cur.join(''));cur=[];}
}
}
if(cur.length)out.push(cur.join(''));
return out;
}
function breakElliptical(text,maxPerLine){
return breakLines(text,maxPerLine,{elliptical:true});
}
return {
breakLines:breakLines,
breakElliptical:breakElliptical,
tokenizeVertical:tokenizeVertical,
toVerticalGlyph:toVerticalGlyph,
VERTICAL_PUNCT_MAP:VERTICAL_PUNCT_MAP,
NO_START:NO_START,
NO_END:NO_END
};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=CjkBreak;
if(typeof window!=='undefined')window.CjkBreak=CjkBreak;
