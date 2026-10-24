import { Chess } from 'chess.js';
import { ChessEngine } from './engine.js';
import { CameraVision } from './vision.js';

const $=id=>document.getElementById(id);
const game=new Chess();
let mySide='w',selected=null,pendingMove=null,analyzeLines=[],lastDepth=0,engineAlive=false;
let lastEngineFen=null,autoScan=false,stableKey='',stableHits=0,autoInterval=null;
let lastScanStatus='';
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
      try{vision.syncReference();}catch{};
      $('vision-message').textContent=`تم اعتماد ${played.san} من الكاميرا وتحديث صورة الرقعة.`;
    }else if(vision.reference){
      $('vision-message').textContent='سُجّلت نقلة على اللوحة الرقمية. إذا تغيّرت الرقعة الحقيقية أيضًا، أعد حفظ الوضع الحالي قبل قراءة النقلة التالية.';
      autoScan=false;$('auto-scan').checked=false;
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
  state.textContent=!on?'الكاميرا متوقفة':!ready?'بانتظار معايرة الرقعة':!ref?'بانتظار حفظ الوضع المرجعي':monitoring?'المراقبة تعمل تلقائيًا':'المراقبة متوقفة';
  state.classList.toggle('scanning',monitoring);
  $('auto-scan').checked=monitoring;
  $('start-camera').textContent=on?'إيقاف الكاميرا':'تشغيل الكاميرا';
  $('camera-state').textContent=on?'بث مباشر':'الكاميرا متوقفة';
  $('calibrate').disabled=!on;$('baseline').disabled=!on||!ready;
  $('detect').disabled=!on||!ref;$('auto-scan').disabled=!on||!ref;
  $('expand-video').disabled=!on;
  $('auto-accept').disabled=!on||!ref;
}
function hideSuggestion(){$('vision-suggestion').hidden=true;pendingMove=null;}
function readCamera(silent=false){
  if(pendingMove||game.isGameOver()||vision.calibrating)return;
  try{
    const result=vision.propose(game);
    if(!result.credible){
      stableHits=0;stableKey='';
      if(!silent||result.unstable){
        $('vision-message').textContent=result.message;
      } else if(lastScanStatus!=='watching'){
        $('vision-message').textContent='المراقبة نشطة؛ حرّك قطعة على الرقعة المصوّرة، وأكمل الحركة قبل انتظار القراءة.';
      }
      lastScanStatus=result.unstable?'unstable':'watching';
      return;
    }
    const m=result.top;
    const key=m.from+m.to+(m.promotion||'');
    if(silent){
      stableHits=stableKey===key?stableHits+1:1;stableKey=key;
      if(stableHits<2){
        if(lastScanStatus!==key){
          $('vision-message').textContent=`تم رصد حركة محتملة ${m.san}. جارٍ التحقق من ثبات الصورة…`;
          lastScanStatus=key;
        }
        return;
      }
    }
    stableHits=0;stableKey='';lastScanStatus='';
    const candidate={from:m.from,to:m.to,promotion:m.promotion||'q'};
    if(silent&&$('auto-accept').checked){
      playMove(candidate,'camera');
      return;
    }
    pendingMove=candidate;
    $('suggestion-title').textContent=`نقلة محتملة: ${m.san}`;
    $('suggestion-desc').textContent=`من ${m.from} إلى ${m.to} · يجب تأكيدها لأن القراءة بالكاميرا تجريبية.`;
    $('vision-suggestion').hidden=false;
    $('vision-message').textContent=result.message;
  }catch(err){if(!silent)$('vision-message').textContent=err.message;}
}

$('start-camera').addEventListener('click',async()=>{
  const btn=$('start-camera');btn.disabled=true;
  try{
    if(vision.stream){$('video-stage').classList.remove('expanded');document.body.classList.remove('camera-expanded');$('expand-video').textContent='تكبير الفيديو';vision.stop();autoScan=false;$('auto-scan').checked=false;hideSuggestion();$('vision-message').textContent='الكاميرا متوقفة.';}
    else await vision.start();
  }catch(err){$('vision-message').textContent='تعذر تشغيل الكاميرا: '+String(err.message);}
  finally{btn.disabled=false;setCameraButtons();}
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
    vision.saveReference();hideSuggestion();
    stableHits=0;stableKey='';lastScanStatus='';
    autoScan=true;
    setCameraButtons();
    $('vision-message').textContent='تم حفظ الصورة وبدأت المراقبة تلقائيًا. حرّك قطعة واحدة ثم اترك الشاشة ثابتة نحو ثانيتين. لتطبيق النقلة دون تأكيد، فعّل «اعتماد النقلات تلقائيًا».';
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
$('accept-suggestion').addEventListener('click',()=>{if(pendingMove){const move=pendingMove;playMove(move,'camera');}});
$('reject-suggestion').addEventListener('click',()=>{hideSuggestion();$('vision-message').textContent='تم تجاهل الاقتراح. يمكنك إعادة قراءة النقلة أو تصحيحها من اللوحة.';});
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
autoInterval=setInterval(()=>{
  if(autoScan&&vision.stream&&vision.reference&&!pendingMove&&!vision.calibrating&&!document.hidden)readCamera(true);
},850);
window.addEventListener('pagehide',()=>{vision.stop();engine.close();if(autoInterval)clearInterval(autoInterval);});
renderBoard();setCameraButtons();resetAnalysis();engine.init();engine.analyze(game.fen());
