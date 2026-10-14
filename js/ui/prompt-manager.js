/* exported openPromptChangeFloatingWindow */
function openPromptChangeFloatingWindow() {
const floatingWindow=document.createElement("div");
floatingWindow.className="floating-windowPromptClass";
floatingWindow.style.cursor="move";

floatingWindow.innerHTML=`
      <h4>Prompt Replace</h4>
      ${createPromptPair("Old Prompt1", "New Prompt1")}
      ${createPromptPair("Old Prompt2", "New Prompt2")}
      ${createPromptPair("Old Prompt3", "New Prompt3")}
      ${createPromptPair("Old Negative Prompt1", "New Negative Prompt1")}
      ${createPromptPair("Old Negative Prompt2", "New Negative Prompt2")}
      ${createPromptPair("Old Negative Prompt3", "New Negative Prompt3")}
      <button onclick="applyChanges()">All Change</button>
      <button onclick="closePromptChangeFloatingWindow()">Close</button>
  `;

document.body.appendChild(floatingWindow);
makeDraggable(floatingWindow);
}

function createPromptPair(oldLabel,newLabel) {
const oldId=oldLabel.replace(/\s/g,'-').toLowerCase();
const newId=newLabel.replace(/\s/g,'-').toLowerCase();

return `
    <div class="prompt-replace-form-group">
      <textarea id="${oldId}-old" placeholder="${oldLabel}"></textarea>
      <textarea id="${newId}-new" placeholder="${newLabel}"></textarea>
    </div>
  `;
}
function applyChanges() {
var layers=canvas.getObjects();

var positivePrompts=[
{old: $('old-prompt1-old').value,new: $('new-prompt1-new').value},
{old: $('old-prompt2-old').value,new: $('new-prompt2-new').value},
{old: $('old-prompt3-old').value,new: $('new-prompt3-new').value}
];
var negativePrompts=[
{old: $('old-negative-prompt1-old').value,new: $('new-negative-prompt1-new').value},
{old: $('old-negative-prompt2-old').value,new: $('new-negative-prompt2-new').value},
{old: $('old-negative-prompt3-old').value,new: $('new-negative-prompt3-new').value}
];

layers.forEach(function(layer) {
positivePrompts.forEach(function(prompt) {
if (prompt.old&&layer.text2img_prompt&&layer.text2img_prompt.includes(prompt.old)) {
layer.text2img_prompt=layer.text2img_prompt.split(prompt.old).join(prompt.new);
}
});
negativePrompts.forEach(function(prompt) {
if (prompt.old&&layer.text2img_negative&&layer.text2img_negative.includes(prompt.old)) {
layer.text2img_negative=layer.text2img_negative.split(prompt.old).join(prompt.new);
}
});
});

uiLogger.debug("applyChanges","saveState");
saveState();
}

function closePromptChangeFloatingWindow() {
const window=document.querySelector('.floating-windowPromptClass');
document.body.removeChild(window);
}

// The floating window's buttons call these through inline onclick="..." in the template above.
window.applyChanges=applyChanges;
window.closePromptChangeFloatingWindow=closePromptChangeFloatingWindow;
