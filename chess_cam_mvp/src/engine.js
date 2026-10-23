export class ChessEngine {
  constructor(onUpdate){
    this.onUpdate=onUpdate;
    this.worker=null;
    this.ready=false;
    this.activeFen=null;
    this.queuedFen=null;
    this.lines=new Map();
    this.depth=0;
    this.lastFen=null;
  }
  init(){
    try {
      // Using a same-origin worker is important: the accompanying WASM is loaded relative to it.
      const base=import.meta.env.BASE_URL || '/';
      this.worker=new Worker(`${base}engine/stockfish-19-lite-single.js`);
      this.worker.onmessage=(event)=>this.receive(String(event.data));
      this.worker.onerror=(e)=>this.onUpdate({kind:'error',message:'تعذر تشغيل المحرك. تأكد من وجود ملفات Stockfish بعد بناء الموقع.'});
      this.worker.postMessage('uci');
      this.onUpdate({kind:'loading'});
    } catch(err){this.onUpdate({kind:'error',message:String(err.message)});}
  }
  receive(line){
    if(line.includes('uciok')){
      this.worker.postMessage('setoption name MultiPV value 3');
      this.worker.postMessage('isready');
      return;
    }
    if(line.includes('readyok')){
      this.ready=true;
      this.onUpdate({kind:'ready'});
      this.pump();
      return;
    }
    if(line.startsWith('info ') && this.activeFen){
      const dp=Number(line.match(/\bdepth (\d+)/)?.[1]||0);
      const pv=Number(line.match(/\bmultipv (\d+)/)?.[1]||1);
      const move=line.match(/\bpv ([a-h][1-8][a-h][1-8][qrbn]?)/)?.[1];
      const cp=line.match(/\bscore cp (-?\d+)/)?.[1];
      const mate=line.match(/\bscore mate (-?\d+)/)?.[1];
      if(move && (cp!==undefined||mate!==undefined)){
        this.lines.set(pv,{move,cp:cp!==undefined?Number(cp):null,mate:mate!==undefined?Number(mate):null,depth:dp});
        this.depth=Math.max(this.depth,dp);
        if(this.activeFen===this.lastFen && dp>=5){
          this.onUpdate({kind:'analysis',fen:this.activeFen,lines:[...this.lines.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]),depth:dp});
        }
      }
    }
    if(line.startsWith('bestmove')){
      const fin=this.activeFen;
      this.activeFen=null;
      if(fin===this.lastFen && !this.queuedFen){
        this.onUpdate({kind:'done',fen:fin,lines:[...this.lines.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]),depth:this.depth});
      }
      this.pump();
    }
  }
  analyze(fen){
    this.lastFen=fen;
    this.queuedFen=fen;
    if(this.activeFen && this.activeFen!==fen) this.worker?.postMessage('stop');
    this.pump();
  }
  pump(){
    if(!this.ready || this.activeFen || !this.queuedFen)return;
    const fen=this.queuedFen;
    this.queuedFen=null;
    this.activeFen=fen;
    this.lines.clear();this.depth=0;
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage('go movetime 1200');
    this.onUpdate({kind:'thinking'});
  }
  close(){this.worker?.terminate();this.worker=null;}
}
