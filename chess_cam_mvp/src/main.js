import { Chess } from 'chess.js';
import { ChessEngine } from './engine.js';
import { CameraVision } from './vision.js';
import { TrainedChessVision } from './trained-vision.js';
import { inferCastling, findChessboardCorners, snapCorners, rgbaToGray } from '@scoriiu/fenshot';
import { profileSettings } from './vision-speed.js';
import { MovingBoardTracker,poseIsValid,loadOpenCV } from './moving-board-tracker.js';
import { CameraBoardMemory } from './board-memory.js';
import { PhysicalChessVision } from './physical-vision.js';

const $=id=>document.getElementById(id);
const game=new Chess();
let mySide='w',selected=null,pendingMove=null,analyzeLines=[],lastDepth=0,engineAlive=false;
let lastEngineFen=null,autoScan=false,stableKey='',stableHits=0,autoInterval=null;
let lastScanStatus='',lastReadAt=0,lastRecognizedAt=0,unmatchedSince=0;
let warningNoSync=false,pendingSince=0,cameraError='',unchangedWhilePending=0;
let lastAutomaticRefresh=0;
const glyph={w:{k:'♔',q:'♕',r:'♖',b:'♗',n:'♘',p:'♙'},b:{k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟︎'}};
const files='abcdefgh';
const arPieces={p:'بيدق',n:'حصان',b:'فيل',r:'قلعة',q:'وزير',k:'ملك'};
const sideLabel=s=>s==='w'?'الأبيض':'الأسود';

const vision=new CameraVision($('camera'),$('camera-overlay'),$('video-stage'),(message)=>$('vision-message').textContent=message);
const engine=new ChessEngine(engineEvent);
const trainedVision=new TrainedChessVision(vision);
const legacyTracker=new MovingBoardTracker(vision);
// Real boards use the persistent board map (keyframes + relocalization);
// the legacy pixel mode keeps the original frame-to-frame tracker.
const memoryTracker=new CameraBoardMemory(vision);
const boardTracker=new Proxy({},{get(_,key){
  const t=physicalMode()?memoryTracker:legacyTracker,v=t[key];
  return typeof v==='function'?v.bind(t):v;
}});
const physicalVision=new PhysicalChessVision(vision);
let trackingLoop=null,trackingLast=0,trackingPreparing=false,physicalRecovering=false,lastPhysicalRecover=0;
const physicalMode=()=>$('vision-mode').value==='physical';
function trackingWanted(){
  return !!vision.stream&&vision.sourceKind==='camera'&&
    $('motion-track').checked&&(physicalMode()||$('vision-mode').value==='legacy');
}
async function enableMotionTracking(){
  if(!trackingWanted()){boardTracker.stop();vision.poseValid=true;return;}
  if(trackingPreparing||boardTracker.active)return;
  trackingPreparing=true;
  $('tracker-state').textContent='تحميل OpenCV.js وتتبع الرقعة…';
  try{
    await boardTracker.start(loadOpenCV);
    boardTracker.reset();vision.poseValid=true;
    $('tracker-state').textContent='جاهز لتتبّع الرقعة. حدد زواياها ثم احفظ الوضع.';
  }catch(e){
    $('tracker-state').textContent='لم يعمل التتبع: '+String(e.message)+'. استخدم كاميرا ثابتة أو جرّب إعادة فتح الصفحة.';
    $('motion-track').checked=false;vision.poseValid=true;
  }finally{trackingPreparing=false;}
}
async function recoverPhysicalCorners({manual=false}={}){
  if(physicalRecovering||!physicalMode()||!vision.stream||vision.sourceKind!=='camera')return false;
  if(!manual&&Date.now()-lastPhysicalRecover<5000)return false;
  physicalRecovering=true;lastPhysicalRecover=Date.now();
  if(manual)$('tracker-state').textContent='البحث التلقائي عن مربعات الرقعة الحقيقية…';
  try{
    const found=await physicalVision.detectBoardCorners(game);
    if(!found)return false;
    // While the board map still tracks, a new detection only VOTES on the
    // map's square offset; it never replaces a working pose.
    if(physicalMode()&&memoryTracker.state==='tracking'&&found.H){
      const vote=memoryTracker.verify(found.H);
      $('tracker-state').textContent=vote.accepted?'تم تصحيح موضع الشبكة بمقدار '+vote.shift.join('،')+' مربع':
        'تحقق من الشبكة · الخريطة متطابقة';
      return true;
    }
    if(!manual&&vision.corners.length===4&&!poseIsValid(vision.corners,found.corners,
      vision.canvas.width,vision.canvas.height)&&found.quality?.aligned<30)return false;
    // A fully verified new 7x7 grid can reacquire the board even after the
    // phone rotated a large angle. Do not remain stuck on stale AR geometry.
    // Preserve the chess square order. The four corners follow the camera
    // image, while color-facing orientation is inferred independently.
    vision.corners=found.corners;
    vision.poseValid=true;vision.drawOverlay();
    resetModelTracking();
    if(boardTracker.active)boardTracker.reset();
    $('tracker-state').textContent='تمت استعادة الرقعة الكاملة · '+found.quality.aligned+
      ' نقطة شبكة متطابقة · '+Math.round((found.quality.coverage??1)*100)+
      '% من القطع داخل الإطار';
    return true;
  }catch(err){
    if(manual)$('vision-message').textContent='تعذر اكتشاف الرقعة: '+String(err.message);
    return false;
  }finally{physicalRecovering=false;}
}
function trackCameraPose(){
  if(!trackingWanted()||!boardTracker.active||!vision.corners.length||vision.calibrating||document.hidden)return;
  try{
    const result=boardTracker.observe(vision.frame());
    vision.poseValid=result.state==='tracking';
    if(result.state==='lost'){
      if(physicalMode()&&boardTracker.retries>=3)void recoverPhysicalCorners();
      $('tracker-state').textContent='فقدت معالم الرقعة ('+result.inliers+' نقاط). حافظ عليها داخل الكاميرا؛ أوقفنا السهم لتجنب موضع خاطئ.';
    }else if(result.state==='tracking'){
      $('tracker-state').textContent='تتبّع رقعة متحركة · '+result.inliers+' معالم متطابقة'+
        (result.visible!==undefined?' · '+Math.round(result.visible*100)+'% من الرقعة ظاهر · '+result.keyframes+' لقطات مرجعية':'');
      // Periodic independent verification of the mapped square offset.
      if(physicalMode()&&Date.now()-lastPhysicalRecover>4000)void recoverPhysicalCorners();
    }else $('tracker-state').textContent='معايرة متتبّع الرقعة…';
    vision.drawOverlay();
  }catch(e){vision.poseValid=false;$('tracker-state').textContent='مشكلة تتبع: '+String(e.message);}
}
let mlBusy=false,mlLastAt=0,mlCandidate='',mlAgreement=0,mlScanCount=0;
let frameVersion=0;
const profile=()=>profileSettings($('scan-speed').value);
let mlLastResult=null,mlLastPrediction=null;
const modelMode=()=>$('vision-mode').value==='model';
function resetModelTracking(){
  frameVersion++;mlCandidate='';mlAgreement=0;mlLastResult=null;mlLastPrediction=null;mlLastAt=0;
  trainedVision.resetTracking();physicalVision.reset();
}


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
  if(event.kind==='loading'){
    engineAlive=false;
    $('engine-health').textContent=event.mode==='full'?'جاري تجهيز Stockfish Full':'جاري تجهيز Stockfish Lite';
    $('analysis-state').textContent=event.mode==='full'?'تحميل المحرك الكامل (~94 MB)':'تهيئة';
  }
  if(event.kind==='ready'){
    engineAlive=true;$('engine-health').textContent='Stockfish '+(event.mode==='full'?'Full':'Lite')+' جاهز';$('connection-pill').querySelector('.dot').className='dot green-dot';
    $('analysis-state').textContent='جاهز';
  }
  if(event.kind==='thinking'){$('analysis-state').textContent='يحلّل الآن';}
  if(event.kind==='error'){
    engineAlive=false;$('engine-health').textContent='المحرك غير متاح';$('analysis-state').textContent='خطأ';
    $('best-detail').textContent=event.message;
  }
  if(event.kind==='fallback'){
    $('engine-mode').value='lite';
    $('engine-health').textContent='استخدام Lite احتياطيًا';
    $('best-detail').textContent=event.message;
  }
  if((event.kind==='analysis'||event.kind==='done') && event.fen===game.fen()){
    analyzeLines=event.lines;lastDepth=event.depth;lastEngineFen=event.fen;
    renderAnalysis();
    if(event.kind==='analysis'&&event.stage==='quick')
      $('analysis-state').textContent='أفضل نقلة أولية — سريع';
    if(event.kind==='analysis'&&event.stage==='deep')
      $('analysis-state').textContent='تحليل أعمق';
    if(event.kind==='done')$('analysis-state').textContent=`عمق ${lastDepth}`;
  }
}
// End-to-end latency: confirmed camera move -> first engine line -> arrow.
const latency={pending:null,samples:[]};
window.chessCamMetrics=latency;
function recordArrowLatency(){
  const p=latency.pending;
  if(!p||p.fen!==game.fen())return;
  const ms=Math.round(performance.now()-p.confirmedAt);
  latency.samples.push(ms);if(latency.samples.length>50)latency.samples.shift();
  latency.pending=null;
  const sorted=[...latency.samples].sort((a,b)=>a-b);
  $('engine-health').textContent='من تأكيد النقلة إلى السهم: '+ms+' مللي ثانية (الوسيط '+
    sorted[sorted.length>>1]+' · '+sorted.length+' قياس)';
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
  vision.setSuggestedMove(best.move);recordArrowLatency();
}
function setCameraButtons(){
  const on=!!vision.stream,ready=vision.corners.length===4,ref=!!vision.reference;
  const monitoring=on&&ref&&autoScan;
  const state=$('scan-indicator');
  const paused=monitoring&&document.hidden&&vision.sourceKind!=='screen';
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
  const facingName={w:'الأبيض أسفل',b:'الأسود أسفل',l:'الأبيض يسار',r:'الأبيض يمين'};
  $('camera-orientation').textContent='اتجاه الكاميرا: '+(facingName[vision.side]||'بانتظار التعرف');
  $('ai-vision-state').textContent=physicalMode()?
    (mlBusy?'LeYOLO يفحص القطع الحقيقية…':physicalVision.last?
      'LeYOLO · '+physicalVision.last.count+' قطعة · '+mlScanCount+' فحوصات':
      'الكاميرا الحقيقية · LeYOLO جاهز'):
    modelMode()?(mlBusy?'CNN يفحص الرقعة…':mlLastResult?
      'CNN · الثقة '+Math.round((mlLastResult.confidence||mlLastPrediction?.meanConfidence||0)*100)+'% · '+mlScanCount+' فحوصات':
      'نموذج الرقعة الإلكترونية جاهز'):
    'الوضع التقليدي القديم';
  $('ai-vision-state').classList.toggle('scanning',!!((modelMode()||physicalMode())&&monitoring&&!mlBusy));
  $('vision-performance').textContent=physicalMode()?
    (mlLastResult?'LeYOLO ONNX · '+mlScanCount+' فحوصات | '+boardTracker.state+' · '+boardTracker.inliers+' معالم':'نموذج القطع الحقيقية (LeYOLO) + تعقب OpenCV'):
    modelMode()?
    (trainedVision.stats.total?'قراءة '+trainedVision.stats.total+' مللي ثانية · ONNX '+
      trainedVision.stats.inference+' مللي ثانية · تخطّي '+trainedVision.skipped+
      ' صور ساكنة · '+trainedVision.backend:
      'النموذج ينتقل إلى عامل خلفي (Web Worker) عند توفره'):'فحص بصري تقليدي';
  $('auto-board').disabled=!on;
  $('ml-recover').disabled=physicalMode()||!mlLastPrediction||mlLastPrediction.meanConfidence<.75||
    !mlLastPrediction.placement.includes('K')||!mlLastPrediction.placement.includes('k');
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
    ' | آخر نقلات مؤكدة: '+(lastRecognizedAt?new Date(lastRecognizedAt).toLocaleTimeString('ar-JO'):'لا يوجد')+
    ' | تجديد تلقائي: '+(lastAutomaticRefresh?new Date(lastAutomaticRefresh).toLocaleTimeString('ar-JO'):'لم يحدث بعد');
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
    // Real-board LeYOLO recognizes PIECES, not old-frame pixel differences.
    // Legacy syncReference is invalid with a moving camera and used to
    // falsely stop scanning immediately after an otherwise correct move.
    const learnedMode=modelMode()||physicalMode();
    const sync=learnedMode?{ok:true}:vision.syncReference(game);
    warningNoSync=learnedMode?false:Boolean(sync?.model?.reliable&&sync.model.baselineMismatch>=5);
    mlCandidate='';mlAgreement=0;
    if(warningNoSync)autoScan=false;
    unmatchedSince=0;lastRecognizedAt=Date.now();
    latency.pending={fen:game.fen(),confirmedAt:performance.now(),source:'camera'};
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
async function readTrainedCamera({manual=false}={}){
  // A pending suggestion used to stop physical scanning entirely, so after
  // one detected move nothing more was recognized until it was tapped.
  if(mlBusy||(pendingMove&&!physicalMode())||!vision.stream||vision.corners.length!==4||vision.calibrating||game.isGameOver())return;
  mlBusy=true;mlLastAt=Date.now();
  const expectedFen=game.fen(),stream=vision.stream,version=frameVersion;
  const corners=vision.corners.map(p=>p.x+','+p.y).join(';');
  $('ai-vision-state').textContent='النموذج يفحص الفيديو في الخلفية…';
  try{
    const {result,decoded,skipped,stats,unstable,count}=physicalMode()?
      await physicalVision.recognize(game,{force:true}):await trainedVision.recognize(game,{
      force:manual||!!mlCandidate
    });
    // Discard any old AI output after reset, stream change or a new position.
    if(!(modelMode()||physicalMode())||vision.stream!==stream||version!==frameVersion||
      game.fen()!==expectedFen||
      (!physicalMode()&&vision.corners.map(p=>p.x+','+p.y).join(';')!==corners))return;
    if(physicalMode()&&result?.occluded){
      mlCandidate='';mlAgreement=0;
      $('vision-message').textContent='يد أو جسم يغطي جزءًا من الرقعة؛ ننتظر حتى تبتعد قبل اعتماد أي نقلة.';
      return;
    }
    if(unstable||(physicalMode()&&vision.poseValid===false)){
      mlCandidate='';mlAgreement=0;
      $('vision-message').textContent='الرقعة تتحرك بسرعة أو تغطي اليد القطع. ننتظر تتبعًا واضحًا قبل اعتماد الحركة.';
      return;
    }
    lastReadAt=Date.now();
    if(skipped){
      if(manual)$('vision-message').textContent='الوضعية لم تتغير بحسب الفحص البصري السريع.';
      return;
    }
    mlScanCount++;if(decoded)mlLastPrediction=decoded;mlLastResult=result;
    if(physicalMode() && count!==undefined){
      $('ai-vision-state').textContent='LeYOLO · '+count+' قطعة مرصودة · '+
        (stats?.inference??'—')+' مللي ثانية';
    }
    if(result.kind==='move'){
      if(result.key===mlCandidate)mlAgreement++;else{mlCandidate=result.key;mlAgreement=1;}
      const settings=profile();
      const highTrust=result.confidence>=settings.confidence&&
        result.margin>=settings.margin;
      $('vision-message').textContent='نقلة '+result.key+' · الثقة '+
        Math.round((physicalMode()?result.confidence:(decoded?.meanConfidence||0))*100)+'% · '+mlAgreement+'/'+
        settings.agreement+' تأكيد';
      if(highTrust&&mlAgreement>=settings.agreement){
        const seq=result.sequence.map(m=>({from:m.from,to:m.to,promotion:m.promotion||'q'}));
        mlCandidate='';mlAgreement=0;
        if($('auto-accept').checked){
          playCameraSequence(seq);
        }else if(!pendingMove||pendingMove.map(m=>m.from+m.to).join(' ')!==seq.map(m=>m.from+m.to).join(' ')){
          pendingMove=seq;pendingSince=Date.now();unchangedWhilePending=0;
          $('suggestion-title').textContent='قراءة نموذج CNN: '+result.key;
          $('suggestion-desc').textContent='راجع النقلات قبل الاعتماد على التحليل';
          $('vision-suggestion').hidden=false;
        }
      }else if(!highTrust)mlAgreement=0;
    }else{
      mlCandidate='';mlAgreement=0;
      const confidence=Math.round((decoded?.meanConfidence||0)*100);
      if(result.kind==='unchanged'){
        warningNoSync=false;
        // The board keeps matching the verified position: withdraw a stale
        // (likely phantom) suggestion instead of blocking on it.
        if(pendingMove&&physicalMode()&&++unchangedWhilePending>=3){
          hideSuggestion();$('vision-message').textContent='أُلغي الاقتراح: الرقعة ما زالت تطابق الوضعية المؤكدة.';
        }
        if(manual||mlScanCount%4===0)
          $('vision-message').textContent=physicalMode()?
            'LeYOLO يرى '+(count??physicalVision.last?.count??0)+' قطعة؛ لم تتأكد نقلة جديدة بعد.':
            'الوضعية المصورة تطابق اللوحة الحالية · ثقة '+confidence+'%.';
      }else if(manual||mlScanCount%2===0){
        $('vision-message').textContent=physicalMode()?
          'LeYOLO اكتشف '+(count??0)+' قطعة، لكن النقلة لم تتأكد. تأكد أن الإطار يغطي كل A–H و1–8 وأبعد اليد عن القطع.':
          result.kind==='unreliable'?
          'النموذج غير واثق من القطع ('+confidence+'%). قرّب الرقعة وثبّت الصورة.':
          'قراءة غير حاسمة ('+confidence+'%). جرّب تصحيح المزامنة بعد مراجعة الرقعة.';
      }
    }
  }catch(err){
    mlCandidate='';mlAgreement=0;
    $('ai-vision-state').textContent='خطأ قراءة النموذج: '+String(err.message).slice(0,160);
    $('vision-message').textContent='تعذر تشغيل CNN: '+String(err.message);
  }finally{mlBusy=false;setCameraButtons();}
}

function readCamera(silent=false){
  if(pendingMove){setCameraButtons();return;}
  if(game.isGameOver()||vision.calibrating)return;
  try{
    const result=vision.propose(game);
    lastReadAt=Date.now();
    cameraError='';
    if(!result.credible){
      // Safe periodic auto-recovery. This never discards real move evidence
      // unless the observed board still agrees with the digital position.
      const refreshed=vision.autoRefresh(game,result);
      if(refreshed.ok){
        lastAutomaticRefresh=Date.now();unmatchedSince=0;warningNoSync=false;
        stableKey='';stableHits=0;lastScanStatus='refresh';
        $('vision-message').textContent='تجديد المرجع تلقائيًا بعد التأكد من ثبات نفس وضعية القطع. استمرار المراقبة دون تدخل.';
        setCameraButtons();
        return;
      }
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
    if(vision.stream){boardTracker.stop();vision.poseValid=true;$('video-stage').classList.remove('expanded');document.body.classList.remove('camera-expanded');$('expand-video').textContent='تكبير الفيديو';vision.stop();autoScan=false;warningNoSync=false;lastReadAt=0;$('auto-scan').checked=false;hideSuggestion();$('vision-message').textContent='الكاميرا متوقفة.';}
    else {await vision.start();resetModelTracking();if(modelMode())trainedVision.warmUp();else if(physicalMode())physicalVision.warmUp();void enableMotionTracking();}
  }catch(err){$('vision-message').textContent='تعذر تشغيل الكاميرا: '+String(err.message);}
  finally{btn.disabled=false;setCameraButtons();}
});
$('start-screen').addEventListener('click',async()=>{
  const btn=$('start-screen');
  btn.disabled=true;
  try{
    if(vision.stream&&vision.sourceKind==='screen'){
      boardTracker.stop();vision.stop();
      autoScan=false;warningNoSync=false;lastReadAt=0;
      hideSuggestion();
      $('vision-message').textContent='تم إيقاف مشاركة نافذة الشطرنج.';
    }else{
      boardTracker.stop();await vision.startScreen();resetModelTracking();if(modelMode())trainedVision.warmUp();else if(physicalMode())physicalVision.warmUp();
      autoScan=false;warningNoSync=false;lastReadAt=0;
      hideSuggestion();
      $('vision-message').textContent='تم التقاط نافذة الكمبيوتر. حدّد زوايا الرقعة الظاهرة في الفيديو واحفظ الوضع قبل النقلات.';
    }
  }catch(err){
    $('vision-message').textContent='تعذّرت مشاركة النافذة: '+String(err.message);
  }finally{btn.disabled=false;setCameraButtons();}
});
$('calibrate').addEventListener('click',()=>{
  try{boardTracker.reset();vision.poseValid=true;vision.beginCalibration();autoScan=false;$('auto-scan').checked=false;hideSuggestion();setCameraButtons();}catch(e){$('vision-message').textContent=e.message;}
});
$('camera-overlay').addEventListener('click',e=>{
  if(!vision.calibrating)return;
  const r=e.currentTarget.getBoundingClientRect();
  vision.tap((e.clientX-r.left)*vision.canvas.width/r.width,(e.clientY-r.top)*vision.canvas.height/r.height);
  if(vision.corners.length===4&&boardTracker.active)boardTracker.reset();
  setCameraButtons();
});
$('baseline').addEventListener('click',()=>{
  try{
    const model=vision.saveReference(game);hideSuggestion();
    if(boardTracker.active)boardTracker.reset();
    stableHits=0;stableKey='';lastScanStatus='';
    autoScan=true;warningNoSync=(modelMode()||physicalMode())?false:Boolean(model?.reliable&&model.baselineMismatch>=5);
    unmatchedSince=0;lastReadAt=0;lastRecognizedAt=0;
    resetModelTracking();if(modelMode())trainedVision.warmUp();else if(physicalMode())physicalVision.warmUp();
    setCameraButtons();
    $('vision-message').textContent=modelMode()?
      'تم تشغيل Fenshot للرقعة الإلكترونية.':
      physicalMode()?'تشغيل LeYOLO للرقعة الحقيقية. أبقِ الرقعة داخل الصورة وانتظر ثبات التتبع قبل النقلات.':
      warningNoSync?'توجد مشكلة توافق؛ صحح الرقعة ثم أعد المعايرة.':
      'تم حفظ مرجع الحركة التقليدي.';
  }catch(e){$('vision-message').textContent=e.message;}
});
$('detect').addEventListener('click',()=>{
  if(modelMode()||physicalMode())void readTrainedCamera({manual:true});
  else readCamera(false);
});
$('scan-speed').addEventListener('change',()=>{
  mlCandidate='';mlAgreement=0;
  const mode=$('scan-speed').selectedOptions[0]?.textContent;
  $('vision-message').textContent='تم تفعيل '+mode+'. يتغير عدد مرات الفحص ومعيار الثقة.';
});
$('engine-mode').addEventListener('change',()=>{
  const requested=$('engine-mode').value;
  $('engine-health').textContent=requested==='full'?
    'تحميل Stockfish Full (94 ميجابايت تقريبًا)…':'تحميل Stockfish Lite…';
  engineAlive=false;resetAnalysis();
  engine.setMode(requested,game.fen());
});
$('auto-board').addEventListener('click',async()=>{
  const btn=$('auto-board');btn.disabled=true;
  try{
    if(!vision.stream)throw new Error('شغّل الكاميرا أو مشاركة النافذة أولًا.');
    if(physicalMode()){
      const ok=await recoverPhysicalCorners({manual:true});
      if(!ok)throw new Error('لم أجد نقاط الشبكة؛ قرّب الرقعة أو حدد الزوايا يدويًا.');
      vision.reference=null;autoScan=false;hideSuggestion();setCameraButtons();
      $('vision-message').textContent='تم تحديد الرقعة الحقيقية تلقائيًا باستخدام نموذج نقاط الشبكة؛ احفظ الوضع الحالي بعد ترتيب القطع.';
      return;
    }
    $('vision-message').textContent='جارٍ البحث عن رقعة مربعة آليًا…';
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const frame=vision.frame(),gray=rgbaToGray(frame.data,frame.width,frame.height);
    const first=findChessboardCorners(gray);
    if(!first)throw new Error('لم أجد رقعة واضحة. كبّرها أو استخدم تحديد الزوايا يدويًا.');
    const box=snapCorners(gray,first);
    const w=box.x1-box.x0,h=box.y1-box.y0;
    if(w<96||h<96||Math.abs(w-h)/Math.max(w,h)>.22||
      box.x0<0||box.y0<0||box.x1>frame.width||box.y1>frame.height)
      throw new Error('التحديد الآلي غير موثوق. اختر الزوايا يدويًا.');
    vision.corners=[{x:box.x0,y:box.y0},{x:box.x1,y:box.y0},
      {x:box.x1,y:box.y1},{x:box.x0,y:box.y1}];
    vision.reference=null;vision.calibrating=false;vision.frozenFrame=null;
    vision.stage.classList.remove('calibrating');vision.drawOverlay();
    autoScan=false;hideSuggestion();resetModelTracking();
    setCameraButtons();
    $('vision-message').textContent='تم العثور على الرقعة تلقائيًا. تأكد من حدودها الأربعة ثم اضغط «حفظ الوضع الحالي».';
  }catch(err){$('vision-message').textContent=String(err.message);}
  finally{btn.disabled=!vision.stream;setCameraButtons();}
});
$('vision-mode').addEventListener('change',()=>{
  void enableMotionTracking();resetModelTracking();hideSuggestion();
  warningNoSync=false;mlScanCount=0;
  if(modelMode()){trainedVision.warmUp();$('auto-accept').checked=true;}
  else if(physicalMode()){physicalVision.warmUp();$('auto-accept').checked=false;}
  setCameraButtons();
  $('vision-message').textContent=modelMode()?
    'قراءة الرقع الإلكترونية بواسطة Fenshot ONNX.':
    physicalMode()?'الرقعة الحقيقية: LeYOLO + OpenCV لتتبع حركة الهاتف. بعد المعايرة احفظ الوضع وراجع قراءات النقلات.':
    'الوضع التقليدي القديم؛ دقته أقل.';
  void enableMotionTracking();
});
$('ml-recover').addEventListener('click',()=>{
  try{
    const read=mlLastPrediction;
    if(!read||read.meanConfidence<.75)throw new Error('لا توجد صورة موثوقة بما يكفي لتصحيح الوضعية.');
    const board=read.placement,turn=$('ml-turn').value;
    const castling=inferCastling(board);
    const target=new Chess(board+' '+turn+' '+castling+' - 0 1');
    if(!window.confirm('سوف يتم استبدال لوحة ChessCam بالقطع التي قرأها النموذج ومسح سجل النقلات. راجع القطع أولًا. متابعة؟'))return;
    game.load(target.fen());selected=null;hideSuggestion();warningNoSync=false;
    resetModelTracking();beginAnalysis();autoScan=true;
    $('vision-message').textContent='تم استيراد الوضعية المعروفة للنموذج، لكن حقوق التبييت والأخذ بالتجاوز لا يمكن معرفتها من الصورة وحدها. تابع تدريبك مع التحقق منها.';
    setCameraButtons();
  }catch(err){$('vision-message').textContent='تعذر تصحيح الوضعية: '+String(err.message);}
});
$('auto-scan').addEventListener('change',e=>{
  autoScan=e.target.checked&&!!vision.reference;
  stableHits=0;stableKey='';lastScanStatus='';mlCandidate='';mlAgreement=0;
  $('vision-message').textContent=autoScan?'المراقبة تعمل الآن. جرّب تحريك قطعة واحدة، ثم انتظر حتى يستقر الفيديو.':'تم إيقاف قراءة النقلات تلقائيًا.';
  setCameraButtons();
});
$('ar-overlay').addEventListener('change',e=>vision.setArEnabled(e.target.checked));
$('motion-track').addEventListener('change',()=>{
  if($('motion-track').checked)void enableMotionTracking();
  else {boardTracker.stop();vision.poseValid=true;vision.drawOverlay();}
});
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
$('camera-facing').addEventListener('change',()=>{
  vision.side=$('camera-facing').value==='auto'?mySide:$('camera-facing').value;
  resetModelTracking();
  vision.drawOverlay();
  $('vision-message').textContent='تم تغيير اتجاه الرقعة. الوضع الحقيقي يدعم الأبيض أعلى/أسفل/يسار/يمين الصورة.';
  setCameraButtons();
});
$('my-side').addEventListener('change',e=>{
  mySide=e.target.value;
  vision.side=$('camera-facing').value==='auto'?mySide:$('camera-facing').value;
  resetModelTracking();
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
    autoScan=true;warningNoSync=modelMode()?false:Boolean(model?.reliable&&model.baselineMismatch>=5);
    resetModelTracking();if(modelMode())trainedVision.warmUp();else if(physicalMode())physicalVision.warmUp();unmatchedSince=0;
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
  if(autoScan&&vision.stream&&vision.reference&&(!pendingMove||physicalMode())&&!vision.calibrating&&(!document.hidden||vision.sourceKind==='screen')){
    if(modelMode()||physicalMode()){
      if(!mlBusy&&Date.now()-mlLastAt>=Math.max(profile().interval,physicalMode()?800:0))void readTrainedCamera();
    }else readCamera(true);
  }
  setCameraButtons();
},170);
// Adaptive pose-tracking cadence: up to 20 Hz, but keep the synchronous
// OpenCV work under ~40% of the main thread so video and UI stay smooth.
let trackingCost=40;
trackingLoop=setInterval(()=>{
  if(Date.now()-trackingLast>Math.max(50,trackingCost*2.5)&&trackingWanted()&&!trackingPreparing){
    trackingLast=Date.now();
    const t=performance.now();trackCameraPose();
    trackingCost=trackingCost*.8+(performance.now()-t)*.2;
  }
},25);
window.addEventListener('pagehide',()=>{
  boardTracker.stop();if(trackingLoop)clearInterval(trackingLoop);
  vision.stop();trainedVision.close();physicalVision.close();engine.close();
  if(autoInterval)clearInterval(autoInterval);
});
renderBoard();setCameraButtons();resetAnalysis();engine.init();engine.analyze(game.fen());
