// Two-phase UCI search: a quick first move, then deeper MultiPV analysis.
// Stockfish 19 Full single-threaded is the default; Lite is a fallback.
export class ChessEngine {
  constructor(onUpdate){
    this.onUpdate=onUpdate;
    this.worker=null;this.ready=false;this.activeFen=null;this.queuedFen=null;
    this.lines=new Map();this.depth=0;this.lastFen=null;
    this.mode='full';this.stage=null;this.startTime=0;this.startupTimer=null;
  }
  init(){
    try{
      const base=import.meta.env.BASE_URL||'/';
      const filename=this.mode==='full'?'stockfish-19-single.js':'stockfish-19-lite-single.js';
      const worker=new Worker(base+'engine/'+filename);
      this.worker=worker;this.ready=false;this.activeFen=null;this.stage=null;
      // A slow or unsupported Full WASM initialization must not leave an
      // invisible permanent spinner. Allow initial 94 MB download first.
      this.startupTimer=setTimeout(()=>{
        if(this.worker!==worker||this.ready)return;
        if(this.mode==='full'){
          this.setMode('lite',this.lastFen);
          this.onUpdate({kind:'fallback',message:'تعذر تجهيز Stockfish Full خلال دقيقتين، تم تشغيل Lite تلقائيًا.'});
        }else this.onUpdate({kind:'error',message:'انتهت مهلة تحميل محرك Stockfish Lite.'});
      },120000);
      worker.onmessage=e=>{if(this.worker===worker)this.receive(String(e.data));};
      worker.onerror=()=>{
        if(this.worker!==worker)return;
        this.onUpdate({kind:'error',message:'تعذر تشغيل Stockfish '+this.mode});
        if(this.mode==='full'){
          this.setMode('lite',this.lastFen);
          this.onUpdate({kind:'fallback',message:'تعذر تحميل المحرك العميق؛ رجعنا إلى Lite تلقائيًا.'});
        }
      };
      worker.postMessage('uci');
      this.onUpdate({kind:'loading',mode:this.mode});
    }catch(e){this.onUpdate({kind:'error',message:String(e.message)})}
  }
  setMode(mode,fen){
    if(mode!=='full'&&mode!=='lite')throw new Error('Invalid engine mode');
    if(this.mode===mode&&this.worker)return;
    this.close();this.mode=mode;
    this.queuedFen=fen||this.lastFen;this.lastFen=this.queuedFen;
    this.init();
  }
  receive(line){
    if(line.includes('uciok')){
      this.worker.postMessage('setoption name Hash value 32');
      this.worker.postMessage('setoption name MultiPV value 1');
      this.worker.postMessage('isready');return;
    }
    if(line.includes('readyok')){
      if(this.startupTimer){clearTimeout(this.startupTimer);this.startupTimer=null;}
      this.ready=true;this.onUpdate({kind:'ready',mode:this.mode});
      this.pump();return;
    }
    if(line.startsWith('info ')&&this.activeFen){
      const dp=Number(line.match(/\bdepth (\d+)/)?.[1]||0);
      const pv=Number(line.match(/\bmultipv (\d+)/)?.[1]||1);
      const move=line.match(/\bpv ([a-h][1-8][a-h][1-8][qrbn]?)/)?.[1];
      const cp=line.match(/\bscore cp (-?\d+)/)?.[1];
      const mate=line.match(/\bscore mate (-?\d+)/)?.[1];
      if(move&&(cp!==undefined||mate!==undefined)){
        this.lines.set(pv,{move,cp:cp===undefined?null:Number(cp),
          mate:mate===undefined?null:Number(mate),depth:dp});
        this.depth=Math.max(this.depth,dp);
        if(this.activeFen===this.lastFen&&dp>=4)
          this.onUpdate({kind:'analysis',fen:this.activeFen,
            lines:this.orderedLines(),depth:dp,stage:this.stage});
      }
    }
    if(line.startsWith('bestmove')){
      const finished=this.activeFen;
      if(this.queuedFen && this.queuedFen!==finished){
        this.activeFen=null;this.stage=null;this.pump();return;
      }
      if(this.stage==='quick'&&finished===this.lastFen){
        this.onUpdate({kind:'analysis',fen:finished,lines:this.orderedLines(),
          depth:this.depth,stage:'quick'});
        this.stage='deep';this.depth=0;this.lines.clear();
        this.worker.postMessage('setoption name MultiPV value 3');
        this.worker.postMessage('position fen '+finished);
        this.worker.postMessage('go movetime '+(this.mode==='full'?1700:880));
        return;
      }
      this.activeFen=null;this.stage=null;
      if(finished===this.lastFen&&!this.queuedFen)
        this.onUpdate({kind:'done',fen:finished,lines:this.orderedLines(),depth:this.depth});
      this.pump();
    }
  }
  orderedLines(){return [...this.lines.entries()].sort((a,b)=>a[0]-b[0]).map(e=>e[1])}
  analyze(fen){
    this.lastFen=fen;this.queuedFen=fen;
    if(this.activeFen&&this.activeFen!==fen)this.worker?.postMessage('stop');
    this.pump();
  }
  pump(){
    if(!this.ready||this.activeFen||!this.queuedFen||!this.worker)return;
    const fen=this.queuedFen;this.queuedFen=null;this.activeFen=fen;this.stage='quick';
    this.lines.clear();this.depth=0;this.startTime=Date.now();
    this.worker.postMessage('setoption name MultiPV value 1');
    this.worker.postMessage('position fen '+fen);
    this.worker.postMessage('go movetime '+(this.mode==='full'?280:180));
    this.onUpdate({kind:'thinking',mode:this.mode});
  }
  close(){
    if(this.startupTimer){clearTimeout(this.startupTimer);this.startupTimer=null;}
    this.worker?.terminate();this.worker=null;this.ready=false;
    this.activeFen=null;this.stage=null;
  }
}
