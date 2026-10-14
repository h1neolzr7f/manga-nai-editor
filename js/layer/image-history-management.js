/* exported confirmAllRemove, convertImageMapBlobUrls, initImageHistory, jumpToHistoryIndex, lastRedo, redo, removeByNotSave, saveStateByListener, setNotSave, setSave, undo */
const imageMap=new Map();
var stateStack=[];
var currentStateIndex=-1;
var isSaveHistory=true;
window.NaiHistoryLoading=false;


fabric.Object.prototype.toObject=(function (toObject) {
return function (propertiesToInclude) {
propertiesToInclude=(propertiesToInclude||[]).concat(["clipTo"]);
return toObject.apply(this,[propertiesToInclude]);
};
})(fabric.Object.prototype.toObject);

function isSave(){
return isSaveHistory;
}
function notSave(){
return!(isSave());
}

function setNotSave(activeObject){
activeObject.saveHistory=false;
return activeObject;
}
function setSave(activeObject){
activeObject.saveHistory=true;
return activeObject;
}
function isSaveObject(activeObject){
if(activeObject){
if(activeObject.saveHistory==true){
return true;
}
if(activeObject.saveHistory==false){
return false;
}
if(activeObject.target===undefined){
return true;
}

if(activeObject.target.saveHistory===undefined||activeObject.target.saveHistory==true){
return true;
}
return false;
}else{
return false;
}
}

function isNotSaveObject(activeObject){
return!(isSaveObject(activeObject)) ;
}

function changeDoNotSaveHistory(){
isSaveHistory=false;
}

function changeDoSaveHistory(){
isSaveHistory=true;
}

function removeByNotSave(obj){
if (obj) {
changeDoNotSaveHistory();
canvas.remove(obj);
changeDoSaveHistory();
}
}

function saveStateByListener(event,eventType) {
if(!event){
return;
}
if (notSave()) {
return;
}
if(eventType==='object:removed'){
//ok
}
if(isNotSaveObject(event)){
return;
}
saveState();
}

function saveStateByManual() {
saveState();
}

function generateHash(imageData) {
return CryptoJS.SHA256(imageData).toString(CryptoJS.enc.Hex);
}

async function blobUrlToDataUrl(blobUrl){
try{
const response=await fetch(blobUrl);
const blob=await response.blob();
return new Promise((resolve,reject)=>{
const reader=new FileReader();
reader.onloadend=()=>resolve(reader.result);
reader.onerror=reject;
reader.readAsDataURL(blob);
});
}catch(e){
layerLogger.error("Failed to convert blob URL:",blobUrl,e);
return null;
}
}

async function convertImageMapBlobUrls(){
const entries=Array.from(imageMap.entries());
for(const [hash,value] of entries){
if(typeof value==='string'&&value.startsWith('blob:')){
const dataUrl=await blobUrlToDataUrl(value);
if(dataUrl){
imageMap.set(hash,dataUrl);
}
}
}
}

function customToJSON() {
const json=canvas.toJSON(commonProperties);
json.objects=json.objects.map(obj=>{
if (obj.type==='image'&&obj.src&&typeof obj.src==='string'&&(obj.src.startsWith('data:')||obj.src.startsWith('blob:'))) {
const hash=generateHash(obj.src);
if (!imageMap.has(hash)) {
imageMap.set(hash,obj.src);
}
obj.src=hash;
}

if(obj.speechBubbleGrid&&typeof obj.speechBubbleGrid==='object'){
const gridStr=JSON.stringify(obj.speechBubbleGrid);
const hash=generateHash(gridStr);
if (!imageMap.has(hash)) {
imageMap.set(hash,gridStr);
}
obj.speechBubbleGrid="GUID:"+hash;
}

return obj;
});

return json;
}

function restoreImage(json) {
const parsedJson=JSON.parse(json);
parsedJson.objects=parsedJson.objects.map(obj=>{
if (obj.type==='image'&&imageMap.has(obj.src)) {
obj.src=imageMap.get(obj.src);
}
if (obj.speechBubbleGrid&&typeof obj.speechBubbleGrid==='string') {
const hash=obj.speechBubbleGrid.replace('GUID:','');
const gridData=imageMap.get(hash);
if(gridData){
if(typeof gridData==='string'){
try{
obj.speechBubbleGrid=JSON.parse(gridData);
}catch(e){
obj.speechBubbleGrid=gridData;
}
}else{
obj.speechBubbleGrid=gridData;
}
}
}
if (obj.textBaseline==='alphabetical') {
obj.textBaseline='alphabetic';
}
commonProperties.forEach(prop=>{
if (obj[prop]!==undefined) {
obj[prop]=obj[prop];
}
});
return obj;
});
return parsedJson;
}

// UI hydration assigns these fields without changing the visible document.
function historyVisualSignature(state){
return JSON.stringify(state,function(key,value){return key==='name'||key==='guid'||key==='guids'?undefined:value;});
}

function saveState() {
if(notSave()){
return ;
}
canvas.renderAll();
const state=customToJSON();
const json=JSON.stringify(state);
if(currentStateIndex>=0&&historyVisualSignature(JSON.parse(stateStack[currentStateIndex]))===historyVisualSignature(state)){
stateStack[currentStateIndex]=json;
return false;
}
if (currentStateIndex<stateStack.length-1)stateStack.splice(currentStateIndex+1);
stateStack.push(json);
currentStateIndex++;
updateLayerPanel();
return true;
}

function hydratePageStudioAfterLoad(){
if(window.NaiPageStudio&&typeof window.NaiPageStudio.hydrateAll==='function'){
window.NaiPageStudio.hydrateAll();
}
}

const FAST_PATCH_SAFE_PROPS={
left:true,top:true,scaleX:true,scaleY:true,angle:true,skewX:true,skewY:true,
flipX:true,flipY:true,opacity:true,visible:true,selectable:true,evented:true,
fill:true,stroke:true,strokeWidth:true,text:true,fontSize:true,fontFamily:true,
fontWeight:true,fontStyle:true,textAlign:true,lineHeight:true,charSpacing:true,
textBackgroundColor:true,underline:true,linethrough:true,overline:true,
width:true,height:true,rx:true,ry:true,name:true
};

function canApplyFastHistoryPatch(liveObjects,targetObjects,allowPageLoad){
if(allowPageLoad||!Array.isArray(liveObjects)||!Array.isArray(targetObjects))return false;
if(liveObjects.length===0||liveObjects.length!==targetObjects.length)return false;
for(let i=0;i<liveObjects.length;i++){
const live=liveObjects[i],target=targetObjects[i];
if(!live||!target||typeof live.set!=='function'||typeof live.toObject!=='function')return false;
if(!live.guid||!target.guid||live.guid!==target.guid)return false;
if(live.type!==target.type)return false;
if(target.clipPath||live.clipPath||target.objects||live.objects)return false;
if(live.type==='image'){
const liveSrc=typeof live.getSrc==='function'?live.getSrc():live.src;
if(liveSrc&&target.src&&liveSrc!==target.src)return false;
}
const liveSnap=live.toObject(typeof commonProperties!=='undefined'?commonProperties:[]);
const keys=new Set(Object.keys(liveSnap).concat(Object.keys(target)));
for(const key of keys){
if(key==='version'||key==='src')continue;
if(JSON.stringify(liveSnap[key])!==JSON.stringify(target[key])){
if(!FAST_PATCH_SAFE_PROPS[key])return false;
}
}
}
return true;
}

function applyFastHistoryPatch(liveObjects,targetObjects){
const activeGuid=canvas.getActiveObject&&canvas.getActiveObject()&&canvas.getActiveObject().guid;
let nextActive=null;
for(let i=0;i<liveObjects.length;i++){
const live=liveObjects[i],target=targetObjects[i];
const patch={};
for(const key of Object.keys(target)){
if(FAST_PATCH_SAFE_PROPS[key]&&target[key]!==undefined){
patch[key]=target[key];
}
}
live.set(patch);
if(typeof live.initDimensions==='function'&&(patch.text!==undefined||patch.fontSize!==undefined||patch.fontFamily!==undefined)){
try{live.initDimensions();}catch(_e){/* ignore */}
}
if(typeof live.setCoords==='function')live.setCoords();
if(activeGuid&&live.guid===activeGuid)nextActive=live;
}
if(nextActive&&typeof canvas.setActiveObject==='function'){
try{canvas.setActiveObject(nextActive);}catch(_e){/* ignore */}
}
}

function restoreHistoryState(index,guid=null,allowPageLoad=false){
if(window.NaiHistoryLoading||(window.NaiPageLoading&&!allowPageLoad))return false;
if(!Number.isInteger(index)||index<0||index>=stateStack.length)return false;
const activeBefore=canvas&&typeof canvas.getActiveObject==='function'?canvas.getActiveObject():null;
const activeBeforeGuid=activeBefore&&activeBefore.guid?activeBefore.guid:null;
const state=restoreImage(stateStack[index]);
const wasSaving=isSaveHistory;
window.NaiHistoryLoading=true;
changeDoNotSaveHistory();
return new Promise((resolve,reject)=>{
try{
const liveObjects=canvas&&typeof canvas.getObjects==='function'?canvas.getObjects():[];
if(canApplyFastHistoryPatch(liveObjects,state.objects,allowPageLoad)){
try{
applyFastHistoryPatch(liveObjects,state.objects);
currentStateIndex=index;
reSetSpeechBubbleText();
setCanvasGUID(guid||state.canvasGuid);
hydratePageStudioAfterLoad();
canvas.renderAll();
updateLayerPanel();
resetEventHandlers();
customSpeechBubbleAllRelocation();
isSaveHistory=wasSaving;
window.NaiHistoryLoading=false;
resolve(true);
return;
}catch(_fastErr){
// Fallback to full loadFromJSON if in-place patch hits any edge case
}
}
clearJSTSGeometry();
canvas.loadFromJSON(state,function(){
try{
currentStateIndex=index;
state.objects.forEach((stateObj,objectIndex)=>{
const canvasObj=canvas.getObjects()[objectIndex];
if(canvasObj&&stateObj.selectable!==undefined)canvasObj.selectable=stateObj.selectable;
});
reSetSpeechBubbleText();
setCanvasGUID(guid||state.canvasGuid);
hydratePageStudioAfterLoad();
if(activeBeforeGuid&&typeof canvas.setActiveObject==='function'){
const restoredActive=canvas.getObjects().find(o=>o&&o.guid===activeBeforeGuid&&o.selectable!==false);
if(restoredActive){
try{canvas.setActiveObject(restoredActive);}catch(_e){/* ignore */}
}
}
canvas.renderAll();
updateLayerPanel();
resetEventHandlers();
customSpeechBubbleAllRelocation();
resolve(true);
}catch(error){
reject(error);
}finally{
isSaveHistory=wasSaving;
window.NaiHistoryLoading=false;
}
});
}catch(error){
isSaveHistory=wasSaving;
window.NaiHistoryLoading=false;
reject(error);
}
});
}

function undo(){
if(currentStateIndex>=1)return restoreHistoryState(currentStateIndex-1);
return false;
}

function jumpToHistoryIndex(index){
return restoreHistoryState(index);
}

function redo(){
return restoreHistoryState(currentStateIndex+1);
}

function lastRedo(guid=null,allowPageLoad=false){
return restoreHistoryState(stateStack.length-1,guid,allowPageLoad);
}

function reSetSpeechBubbleText(){
canvas.getObjects().forEach(obj=>{
if(isSpeechBubbleSVG(obj)||isFreehandBubblePath(obj)){
const childObjects=canvas.getObjects().filter((childObj)=>obj.guids.includes(childObj.guid));
childObjects.forEach(childObject=>{
childObject.targetObject=obj;
});
}
});
}


function allRemove() {
changeDoNotSaveHistory();
canvas.clear();
var bgColorInput=$("bg-color");
canvas.backgroundColor=bgColorInput.value;
changeDoSaveHistory();
saveStateByManual();
updateLayerPanel();
currentImage=null;

imageMap.clear();
stateStack=[];
currentStateIndex=-1;
}
// Menu entry "清空画布": allRemove() also wipes the undo history, so a misclick
// would lose the page for good. Ask first when the page holds user content.
function confirmAllRemove(){
var hasContent=(typeof pageHasUserContent==='function')?pageHasUserContent():
(typeof canvas!=='undefined'&&canvas&&canvas.getObjects().length>0);
if(hasContent){
var message=(typeof getText==='function'&&getText('allRemoveConfirm')&&getText('allRemoveConfirm')!=='allRemoveConfirm')?
getText('allRemoveConfirm'):'清空当前页上的全部内容？此操作无法撤销。需要保留的话请先「保存项目」(Ctrl+S)。';
if(!window.confirm(message))return false;
}
allRemove();
return true;
}
function initImageHistory(){
allRemove();
imageMap.clear();
stateStack=[];
currentStateIndex=-1;
}

document.addEventListener('DOMContentLoaded',function() {
saveState();
});



function resetEventHandlers() {
const objectMap={};
canvas.getObjects().forEach(obj=>{
if (obj.guid) {
objectMap[obj.guid]=obj;
}
});
canvas.getObjects().forEach(obj=>{
if(isSpeechBubbleSVG(obj)||isFreehandBubblePath(obj)){
return;
}
if (obj.guids) {
obj.guids.forEach(guid=>{
if (objectMap[guid]) {
moveSettings(objectMap[guid],obj);
}
});
}
});
}
