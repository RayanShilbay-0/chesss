import { Chess } from 'chess.js';
import { ChessEngine } from './engine.js';
import { CameraVision } from './vision.js';

const $=id=>document.getElementById(id);
const game=new Chess();
let mySide='w',selected=null,pendingMove=null,analyzeLines=[],lastDepth=0,engineAlive=false;
let lastEngineFen=null,autoScan=false,stableKey='',stableHits=0,autoInterval=null;
let lastScanStatus='',lastReadAt=0,lastRecognizedAt=0,unmatchedSince=0;
let warningNoSync=false,pendingSince=0,cameraError='';
const glyph={w:{k:'♔',q:'♕',r:'♖',b:'♗',n:'♘',p:'♙'},b:{k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟︎'}};
const files='abcdefgh';
const arPieces={p:'بيدق',n:'حصان',b:'فيل',r:'قلعة',q:'وزير',k:'ملك'};
const sideLabel=s=>s==='w'?'الأبيض':'الأسود';

const vision=new CameraVision($('camera'),$('camera-overlay'),$('video-stage'),(message)=>$('vision-message').textContent=message);
const engine=new ChessEngine(engineEvent);

function moveSAN(uci,fen=game.fen()){
  const copy=new Chess(fen);
  try{
    const move=copy.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]||'q'});
    return move?.san||uci;
  }catch{return uci;}
}
function turnStatus(){
  let status=game.isCheckmate()?`كش مات · فاز ${sideLabel(game.turn()==='w'?'b':'w')}`:
    game.isDraw()?'انتهت المباراة بالتعادل':`الدور ${sideLabel(game.turn())}${game.isCheck()?' · كش':''}`;
  $('turn-status').textContent=status;
  $('move-count').textContent=`النقلة ${Math.floor(game.history().length/2)+1}`;
}
function renderBoard(){
  const board=$('board');board.innerHTML='';
  const verbose=selected?game.moves({square:selected,verbose:true}):[];
  const targets=new Set(verbose.map(m=>m.to));
  const best=analyzeLines[0]?.move;
  const ranks=mySide==='w'?[8,7,6,5,4,3,2,1]:[1,2,3,4,5,6,7,8];
  const cols=mySide==='w'?[...files]:[...files].reverse();
  for(const rank of ranks)for(const file of cols){
    const square=file+rank,piece=game.get(square);
    const isLight=(files.indexOf(file)+rank)%2===0;
    const el=document.createElement('button');
    el.type='button';el.className=`square ${isLight?'light':'dark'}`;
    if(selected===square)el.classList.add('selected');
    if(targets.has(square))el.classList.add('legal-target');
    if(best&&(best.slice(0,2)===square||best.slice(2,4)===square))el.classList.add(best.slice(0,2)===square?'best-from':'best-to');
    el.setAttribute('aria-label',`${square}: ${piece?arPieces[piece.type]+' '+sideLabel(piece.color):'فارغ'}`);
    if(piece){const span=document.createElement('span');span.className='piece '+(piece.color==='w'?'white':'black');span.textContent=glyph[piece.color][piece.type];el.appendChild(span);}
    if(rank===ranks[7]){const small=document.createElement('span');small.className='coord';small.textContent=file;el.appendChild(small);}
    el.addEventListener('click',()=>handleSquare(square));board.appendChild(el);
  }
  turnStatus();
}
function handleSquare(square){
  if(game.isGameOver())return;
  const p=game.get(square);
  if(p?.color===game.turn()){
    selected=selected===square?null:square;renderBoard();return;
  }
  if(!selected)return;
  const choices=game.moves({square:selected,verbose:true}).filter(m=>m.to===square);
  if(choices.length){
    let promotion='q';
    if(choices.length>1){
      const option=(window.prompt('ترقية البيدق: q وزير، r قلعة، b فيل، n حصان','q')||'q').toLowerCase().trim();
      promotion=['q','r','b','n'].includes(option)?option:'q';
    }
    playMove({from:selected,to:square,promotion},'manual');
  }else{ selected=null;renderBoard(); }
}
function resetAnalysis(){
  vision.setSuggestedMove(null);
  analyzeLines=[];lastDepth=0;lastEngineFen=null;
  $('eval-number').textContent='—';$('eval-side').textContent='—';$('best-move').textContent='—';
  $('best-detail').textContent='جارٍ البحث عن أفضل نقلة';$('top-lines').innerHTML='<div class="empty-line">جارٍ التحليل…</div>';
  $('eval-fill').style.width='50%';
}
function beginAnalysis(){
  resetAnalysis();renderBoard();
  if(game.isGameOver()){$('analysis-state').textContent='انتهت المباراة';$('best-detail').textContent='لا نقلة بعد نهاية المباراة';return;}
  $('analysis-state').textContent=engineAlive?'يحلّل':'انتظار المحرك';
  engine.analyze(game.fen());
}
function playMove(move,source){
  if(game.isGameOver())return;
  try{
    const played=game.move(move);
    if(!played)return;
    selected=null;pendingMove=null;hideSuggestion();stableHits=0;stableKey='';lastScanStatus='';
    beginAnalysis();
    if(source==='camera'){
      try{vision.syncReference(game);}catch{};
      $('vision-message').textContent=`تم اعتماد ${played.san} من الكاميرا وتحديث صورة الرقعة.`;
    }else if(vision.reference){
      $('vision-message').textContent='سُجّلت نقلة على اللوحة الرقمية. إذا تغيّرت الرقعة الحقيقية أيضًا، أعد حفظ الوضع الحالي قبل قراءة النقلة التالية.';
      autoScan=false;$('auto-scan').checked=false;
      warningNoSync=true;
      setCameraButtons();
    }
  }catch(e){$('vision-message').textContent='نقلة غير قانونية: '+String(e.message);}
}
function engineEvent(event){
  if(event.kind==='loading'){$('engine-health').textContent='المحرك قيد التشغيل';$('analysis-state').textContent='تهيئة';}
  if(event.kind==='ready'){
    engineAlive=true;$('engine-health').textContent='Stockfish متصل';$('connection-pill').querySelector('.dot').className='dot green-dot';
    $('analysis-state').textContent='جاهز';
  }
  if(event.kind==='thinking'){$('analysis-state').textContent='يحلّل الآن';}
  if(event.kind==='error'){
    engineAlive=false;$('engine-health').textContent='المحرك غير متاح';$('analysis-state').textContent='خطأ';
    $('best-detail').textContent=event.message;
  }
  if((event.kind==='analysis'||event.kind==='done') && event.fen===game.fen()){
    analyzeLines=event.lines;lastDepth=event.depth;lastEngineFen=event.fen;
    renderAnalysis();
    if(event.kind==='done')$('analysis-state').textContent=`عمق ${lastDepth}`;
  }
}
function renderAnalysis(){
  const valid=analyzeLines.filter(x=>x.move && (x.cp!==null||x.mate!==null));
  if(!valid.length)return;
  const best=valid[0], t=game.turn();
  const rawScore=best.mate!==null?Math.sign(best.mate)*999:best.cp;
  const whiteScore=(t==='w'?1:-1)*rawScore;
  const winner=whiteScore>0?'الأبيض':whiteScore<0?'الأسود':'التعادل';
  const text=best.mate!==null?`M${Math.abs(best.mate)}`:(Math.abs(best.cp)/100).toFixed(2);
  $('eval-side').textContent=winner;
  $('eval-number').textContent=text;
  $('eval-fill').style.width=`${Math.max(5,Math.min(95,50+50*(2/Math.PI)*Math.atan(whiteScore/210)))}%`;
  $('best-move').textContent=moveSAN(best.move);
  $('best-detail').textContent=`من ${best.move.slice(0,2)} إلى ${best.move.slice(2,4)} · عمق ${lastDepth}`;
  $('top-lines').innerHTML='';
  valid.forEach((line,i)=>{
    const row=document.createElement('div');row.className='line-item';
    const name=document.createElement('b');name.textContent=`${i+1}. ${moveSAN(line.move)}`;
    const score=document.createElement('span');score.textContent=line.mate!==null?`مات ${line.mate}`:`${(line.cp/100).toFixed(2)}`;
    row.append(name,score);$('top-lines').appendChild(row);
  });
  renderBoard();
  vision.setSuggestedMove(best.move);
}
function setCameraButtons(){
  const on=!!vision.stream,ready=vision.corners.length===4,ref=!!vision.reference;
  const monitoring=on&&ref&&autoScan;
  const state=$('scan-indicator');
  const paused=monitoring&&document.hidden;
  const stale=monitoring&&lastReadAt&&Date.now()-lastReadAt>7000;
  const pending=!!pendingMove;
  state.textContent=!on?'الكاميرا متوقفة':!ready?'بانتظار معايرة الرقعة':!ref?'بانتظار حفظ صورة مرجعية':
    pending?'قراءة بانتظار الاعتماد أو الإلغاء — الفحص مؤقتًا متوقف':
    paused?'المراقبة متوقفة مؤقتًا لأن الصفحة بالخلفية':
    warningNoSync?'الرقعتان قد تكونان غير متزامنتين — استخدم استعادة المزامنة':
    stale?'لم تصل قراءة من الكاميرا مؤخرًا':
    monitoring?'المراقبة نشطة: تبحث عن النقلات':'المراقبة متوقفة';
  state.classList.toggle('scanning',!!(monitoring&&!paused&&!pending&&!warningNoSync&&!stale));
  state.classList.toggle('attention',!!(pending||warningNoSync||stale));
  $('auto-scan').checked=monitoring;
  $('start-camera').textContent=on?'إيقاف الكاميرا':'تشغيل الكاميرا';
  $('camera-state').textContent=on?(vision.sourceKind==='screen'?'نافذة الكمبيوتر مباشرة':'الكاميرا مباشرة'):'الكاميرا متوقفة';
  $('start-screen').textContent=on&&vision.sourceKind==='screen'?'إيقاف مشاركة النافذة':'مشاركة نافذة الشطرنج';
  $('start-screen').hidden=!navigator.mediaDevices?.getDisplayMedia;
  $('calibrate').disabled=!on;$('baseline').disabled=!on||!ready;
  $('detect').disabled=!on||!ref;$('auto-scan').disabled=!on||!ref;
  $('expand-video').disabled=!on;
  $('auto-accept').disabled=!on||!ref;
  $('resync').disabled=!on||!ready;
  $('capture-status').textContent=!on?'الكاميرا غير متصلة':
    'آخر فحص: '+(lastReadAt?new Date(lastReadAt).toLocaleTimeString('ar-JO'):'لم يبدأ')+
    ' | آخر نقلات مؤكدة: '+(lastRecognizedAt?new Date(lastRecognizedAt).toLocaleTimeString('ar-JO'):'لا يوجد');
}
function hideSuggestion(){$('vision-suggestion').hidden=true;pendingMove=null;pendingSince=0;}
function playCameraSequence(sequence){
  if(!sequence?.length||game.isGameOver())return;
  let applied=0;
  try{
    const names=[];
    for(const m of sequence){
      const move=game.move(m);
      if(!move)throw Error('نقلة غير قانونية');
      applied++;names.push(move.san);
    }
    selected=null;stableHits=0;stableKey='';lastScanStatus='';
    hideSuggestion();
    const sync=vision.syncReference(game);
    warningNoSync=Boolean(sync?.model?.reliable&&sync.model.baselineMismatch>=5);
    if(warningNoSync)autoScan=false;
    unmatchedSince=0;lastRecognizedAt=Date.now();
    beginAnalysis();setCameraButtons();
    $('vision-message').textContent=warningNoSync?
      'سجّلت '+applied+' نقلة، لكن قطع الصورة لا تطابق الرقعة الرقمية حاليًا. أوقفت المراقبة مؤقتًا لتصحيح الوضعية.':
      'تم تسجيل '+applied+' نقلة من الكاميرا: '+names.join('، ')+'.';
  }catch(err){
    while(applied-->0)game.undo();
    vision.reference=null;autoScan=false;warningNoSync=true;setCameraButtons();beginAnalysis();
    $('vision-message').textContent='تعذر اعتماد القراءة: '+String(err.message);
  }
}
function readCamera(silent=false){
  if(pendingMove){setCameraButtons();return;}
  if(game.isGameOver()||vision.calibrating)return;
  try{
    const result=vision.propose(game);
    lastReadAt=Date.now();
    cameraError='';
    if(!result.credible){
      stableHits=0;stableKey='';
      if((result.changed||0)>=2){
        vision.setSuggestedMove(null);
        if(!unmatchedSince)unmatchedSince=Date.now();
        if(Date.now()-unmatchedSince>7000)warningNoSync=true;
      }else if((result.changed||0)===0 && !result.unstable)unmatchedSince=0;
      if(!silent||result.unstable||lastScanStatus!==result.reason)
        $('vision-message').textContent=result.message+(result.changed!==undefined?' | مربعات تغيّرت: '+result.changed:'');
      lastScanStatus=result.reason||'unknown';
      setCameraButtons();return;
    }
    const seq=result.top.sequence.map(x=>({from:x.from,to:x.to,promotion:x.promotion||'q'}));
    const key=seq.map(x=>x.from+x.to+x.promotion).join(' ');
    if(silent){
      stableHits=stableKey===key?stableHits+1:1;stableKey=key;
      if(stableHits<2){
        $('vision-message').textContent='تم رصد '+seq.length+' نقلة محتملة. جارٍ التحقق من ثبات القراءة…';
        setCameraButtons();return;
      }
    }
    stableHits=0;stableKey='';lastScanStatus='';unmatchedSince=0;
    if(silent&&$('auto-accept').checked){
      playCameraSequence(seq);return;
    }
    pendingMove=seq;pendingSince=Date.now();
    $('suggestion-title').textContent='النقلات المحتملة: '+result.top.sequence.map(x=>x.san).join('، ');
    $('suggestion-desc').textContent=result.top.key+' · تأكد من صحة النقلات قبل اعتمادها.';
    $('vision-suggestion').hidden=false;
    $('vision-message').textContent=result.message+' راجع الاقتراح أسفل الكاميرا؛ الفحص متوقف إلى أن تختار اعتماد أو إلغاء.';
    setCameraButtons();
  }catch(err){
    cameraError=String(err.message);warningNoSync=true;
    $('vision-message').textContent='خطأ في قراءة الكاميرا: '+cameraError;
    setCameraButtons();
  }
}

$('start-camera').addEventListener('click',async()=>{
  const btn=$('start-camera');btn.disabled=true;
  try{
    if(vision.stream){$('video-stage').classList.remove('expanded');document.body.classList.remove('camera-expanded');$('expand-video').textContent='تكبير الفيديو';vision.stop();autoScan=false;warningNoSync=false;lastReadAt=0;$('auto-scan').checked=false;hideSuggestion();$('vision-message').textContent='الكاميرا متوقفة.';}
    else await vision.start();
  }catch(err){$('vision-message').textContent='تعذر تشغيل الكاميرا: '+String(err.message);}
  finally{btn.disabled=false;setCameraButtons();}
});
$('start-screen').addEventListener('click',async()=>{
  const btn=$('start-screen');
  btn.disabled=true;
  try{
    if(vision.stream&&vision.sourceKind==='screen'){
      vision.stop();
      autoScan=false;warningNoSync=false;lastReadAt=0;
      hideSuggestion();
      $('vision-message').textContent='تم إيقاف مشاركة نافذة الشطرنج.';
    }else{
      await vision.startScreen();
      autoScan=false;warningNoSync=false;lastReadAt=0;
      hideSuggestion();
      $('vision-message').textContent='تم التقاط نافذة الكمبيوتر. حدّد زوايا الرقعة الظاهرة في الفيديو واحفظ الوضع قبل النقلات.';
    }
  }catch(err){
    $('vision-message').textContent='تعذّرت مشاركة النافذة: '+String(err.message);
  }finally{btn.disabled=false;setCameraButtons();}
});
$('calibrate').addEventListener('click',()=>{
  try{vision.beginCalibration();autoScan=false;$('auto-scan').checked=false;hideSuggestion();setCameraButtons();}catch(e){$('vision-message').textContent=e.message;}
});
$('camera-overlay').addEventListener('click',e=>{
  if(!vision.calibrating)return;
  const r=e.currentTarget.getBoundingClientRect();
  vision.tap((e.clientX-r.left)*vision.canvas.width/r.width,(e.clientY-r.top)*vision.canvas.height/r.height);
  setCameraButtons();
});
$('baseline').addEventListener('click',()=>{
  try{
    const model=vision.saveReference(game);hideSuggestion();
    stableHits=0;stableKey='';lastScanStatus='';
    autoScan=true;warningNoSync=Boolean(model?.reliable&&model.baselineMismatch>=5);unmatchedSince=0;lastReadAt=0;lastRecognizedAt=0;
    setCameraButtons();
    $('vision-message').textContent=warningNoSync?
      'تحذير: توزيع القطع داخل الكاميرا لا يطابق اللوحة الرقمية. صحّحها أو استورد FEN، ثم أعد حفظ الوضع.':
      'تم حفظ المرجع وتشغيل قراءة القطع ونقلات الأبيض والأسود. ابدأ التجربة من الوضعية المتطابقة.';
  }catch(e){$('vision-message').textContent=e.message;}
});
$('detect').addEventListener('click',()=>readCamera(false));
$('auto-scan').addEventListener('change',e=>{
  autoScan=e.target.checked&&!!vision.reference;
  stableHits=0;stableKey='';lastScanStatus='';
  $('vision-message').textContent=autoScan?'المراقبة تعمل الآن. جرّب تحريك قطعة واحدة، ثم انتظر حتى يستقر الفيديو.':'تم إيقاف قراءة النقلات تلقائيًا.';
  setCameraButtons();
});
$('ar-overlay').addEventListener('change',e=>vision.setArEnabled(e.target.checked));
$('expand-video').addEventListener('click',()=>{
  const expanded=$('video-stage').classList.toggle('expanded');
  $('expand-video').textContent=expanded?'تصغير الفيديو':'تكبير الفيديو';
  document.body.classList.toggle('camera-expanded',expanded);
});
$('accept-suggestion').addEventListener('click',()=>{if(pendingMove)playCameraSequence(pendingMove);});
$('reject-suggestion').addEventListener('click',()=>{
  hideSuggestion();stableHits=0;stableKey='';warningNoSync=true;
  $('vision-message').textContent='تم تجاهل القراءة. إذا تغيّرت الرقعة بالفعل، صحح لوحة ChessCam أولًا ثم استخدم استعادة المزامنة.';
  setCameraButtons();
});
$('my-side').addEventListener('change',e=>{
  mySide=e.target.value;vision.side=mySide;
  vision.reference=null;autoScan=false;$('auto-scan').checked=false;hideSuggestion();
  $('vision-message').textContent='تغيّر اتجاه الرقعة. أعد حفظ الصورة المرجعية بعد ضبط الكاميرا.';
  setCameraButtons();renderBoard();
});
$('undo').addEventListener('click',()=>{
  if(game.history().length){game.undo();selected=null;beginAnalysis();}
  vision.reference=null;autoScan=false;$('auto-scan').checked=false;hideSuggestion();setCameraButtons();
  $('vision-message').textContent='تم التراجع. احفظ صورة مرجعية جديدة للرقعة إذا كنت تستخدم الكاميرا.';
});
$('reset').addEventListener('click',()=>{
  if(game.history().length&&!window.confirm('بدء مباراة جديدة ومسح النقلات السابقة؟'))return;
  game.reset();selected=null;beginAnalysis();vision.reference=null;
  autoScan=false;$('auto-scan').checked=false;hideSuggestion();setCameraButtons();
  $('vision-message').textContent='تمت إعادة اللعبة للبداية. رتّب الرقعة ثم احفظ وضعًا مرجعيًا جديدًا.';
});
$('copy-pgn').addEventListener('click',async()=>{
  const notation=game.pgn()||'(لا توجد نقلات بعد)';
  try{await navigator.clipboard.writeText(notation);$('vision-message').textContent='تم نسخ سجل المباراة (PGN).';}
  catch{window.prompt('انسخ النقلات:',notation);}
});
$('resync').addEventListener('click',()=>{
  try{
    if(!vision.stream||vision.corners.length!==4)throw Error('شغّل الكاميرا وحدد الزوايا أولًا.');
    if(!window.confirm('هل لوحة ChessCam الرقمية مطابقة تمامًا للرقعة الظاهرة الآن بالكاميرا؟ إذا كانت مختلفة، صحّح النقلات أولًا أو استورد FEN.'))return;
    hideSuggestion();
    const model=vision.saveReference(game);
    autoScan=true;warningNoSync=Boolean(model?.reliable&&model.baselineMismatch>=5);unmatchedSince=0;
    lastReadAt=0;lastScanStatus='';stableHits=0;stableKey='';
    lastRecognizedAt=Date.now();
    setCameraButtons();beginAnalysis();
    $('vision-message').textContent=warningNoSync?
      'لا تزال صورة القطع تبدو مختلفة عن الرقعة الرقمية. صحح الوضعية قبل الاعتماد على قراءة جديدة.':
      'تم حفظ مرجع جديد وإعادة تشغيل قراءة نقلات الأبيض والأسود.';
  }catch(err){$('vision-message').textContent='لم تنجح استعادة المزامنة: '+String(err.message);}
});
$('import-fen').addEventListener('click',()=>{
  try{
    const fen=$('fen-input').value.trim();
    if(!fen)throw Error('ألصق نص FEN أولًا.');
    const candidate=new Chess(fen);
    if(!window.confirm('سيتم استبدال وضعية ChessCam الحالية ومسح سجل النقلات. متابعة؟'))return;
    game.load(candidate.fen());
    selected=null;hideSuggestion();
    vision.reference=null;autoScan=false;
    warningNoSync=false;unmatchedSince=0;lastReadAt=0;
    beginAnalysis();setCameraButtons();
    $('vision-message').textContent='تم استيراد FEN. تأكد أن قطع الرقعة الرقمية تطابق الكاميرا، ثم اضغط استعادة المزامنة.';
  }catch(err){$('vision-message').textContent='وضعية FEN غير صالحة: '+String(err.message);}
});
document.addEventListener('visibilitychange',()=>{
  setCameraButtons();
  if(!document.hidden&&vision.stream&&autoScan) $('vision-message').textContent='عادت الكاميرا إلى الواجهة؛ المراقبة تتحقق من الوضعية الآن.';
});
autoInterval=setInterval(()=>{
  if(autoScan&&vision.stream&&vision.reference&&!pendingMove&&!vision.calibrating&&!document.hidden)readCamera(true);
  setCameraButtons();
},1100);
window.addEventListener('pagehide',()=>{vision.stop();engine.close();if(autoInterval)clearInterval(autoInterval);});
renderBoard();setCameraButtons();resetAnalysis();engine.init();engine.analyze(game.fen());
