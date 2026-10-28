import { boardToTiles } from '@scoriiu/fenshot';
import { inferMovesFromModel, decodedPosition, chooseVisualOrientation } from './model-moves.js';
import ortJsUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import ortWasmUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
export function wasmAssetUrls(){return {mjs:new URL(ortJsUrl,location.href).href,wasm:new URL(ortWasmUrl,location.href).href};}
import { boardSignature, signatureDifference } from './vision-speed.js';
const MODEL_REFRESH_MS=5500;


const OUT_SIZE=256;
export class TrainedChessVision {
  constructor(camera){this.camera=camera;this.sessionPromise=null;this.cache=null;this.lastOutput=null;this.signature=null;this.signatureTime=0;this.worker=null;this.workerReady=null;this.requests=new Map();this.reqId=0;this.fallback=false;this.backend='غير مهيّأ';this.skipped=0;this.stats={prep:0,inference:0,total:0};this.orientation=null;}
  async session(){
    if(!this.sessionPromise){
      this.sessionPromise=(async()=>{
        const ort=await import('onnxruntime-web/wasm');
        ort.env.wasm.wasmPaths=wasmAssetUrls();
        ort.env.wasm.numThreads=1;
        const session=await ort.InferenceSession.create(
          (import.meta.env.BASE_URL||'/')+'models/chess-tiles-v2.onnx',
          {executionProviders:['wasm']}
        );
        return {ort,session};
      })().catch(e=>{this.sessionPromise=null;throw e});
    }
    return this.sessionPromise;
  }
  async setupWorker(){
    if(this.fallback||typeof Worker==='undefined')return false;
    if(this.workerReady)return this.workerReady;
    let worker;
    try{
      worker=new Worker(new URL('./vision-worker.js',import.meta.url),{type:'module'});
      this.worker=worker;
    }catch{this.fallback=true;return false;}
    const rejectAll=e=>{
      this.fallback=true;this.backend='WASM — الوضع الاحتياطي';
      for(const p of this.requests.values())p.reject(e instanceof Error?e:new Error(String(e)));
      this.requests.clear();
      worker.terminate();if(this.worker===worker)this.worker=null;
    };
    this.workerReady=new Promise(resolve=>{
      const deadline=setTimeout(()=>{rejectAll(new Error('Worker load timeout'));resolve(false)},12000);
      worker.onmessage=event=>{
        const msg=event.data;
        if(msg.type==='ready'){
          clearTimeout(deadline);this.backend='CNN Worker + WASM SIMD';resolve(true);return;
        }
        if(msg.type==='init-failed'){
          clearTimeout(deadline);rejectAll(new Error(msg.error));resolve(false);return;
        }
        const p=this.requests.get(msg.id);
        if(!p)return;
        this.requests.delete(msg.id);
        if(msg.type==='result')p.resolve(msg);
        else p.reject(new Error(msg.error||'Worker failure'));
      };
      worker.onerror=e=>{clearTimeout(deadline);rejectAll(new Error(e.message||'Worker failure'));resolve(false)};
      worker.postMessage({type:'init',modelUrl:(import.meta.env.BASE_URL||'/')+'models/chess-tiles-v2.onnx'});
    });
    return this.workerReady;
  }
  warmUp(){
    void this.setupWorker().then(ok=>{
      if(!ok)void this.session().catch(()=>{});
    });
  }
  async probabilities(input){
    if(await this.setupWorker()){
      const id=++this.reqId;
      const result=new Promise((resolve,reject)=>this.requests.set(id,{resolve,reject}));
      try{
        this.worker.postMessage({type:'infer',id,input},[input.buffer]);
        const response=await result;
        return {data:response.probabilities,modelMs:response.ms,backend:this.backend};
      }catch(e){
        this.fallback=true;this.worker?.terminate();this.worker=null;
        // The sent Float32Array may have been detached. Rebuild it in caller.
        throw e;
      }
    }
    return this.probabilitiesMain(input);
  }
  async probabilitiesMain(input){
    const {ort,session}=await this.session();
    const t=performance.now();
    const raw=await session.run({tiles:new ort.Tensor('float32',input,[64,1024])});
    this.backend='CNN + WASM SIMD';
    return {data:raw.probs?.data,modelMs:performance.now()-t,backend:this.backend};
  }
  resetTracking(){
    this.signature=null;this.signatureTime=0;this.skipped=0;this.lastOutput=null;this.orientation=null;
  }
  close(){
    this.worker?.terminate();this.worker=null;this.workerReady=null;
    for(const p of this.requests.values())p.reject(new Error('Worker closed'));
    this.requests.clear();
  }
  // Geometry is cached until the user changes camera, resolution or corners.
  geometry(width,height){
    const corners=this.camera.corners;
    if(corners.length!==4)throw new Error('حدد زوايا الرقعة الأربعة');
    const key=width+':'+height+':'+corners.map(p=>p.x.toFixed(2)+','+p.y.toFixed(2)).join(';');
    if(this.cache?.key===key)return this.cache;
    const xy=new Float32Array(OUT_SIZE*OUT_SIZE*2);
    for(let y=0;y<OUT_SIZE;y++)for(let x=0;x<OUT_SIZE;x++){
      const pt=this.camera.point((x+.5)/OUT_SIZE,(y+.5)/OUT_SIZE),i=(y*OUT_SIZE+x)*2;
      xy[i]=Math.max(0,Math.min(width-1.001,pt.x));
      xy[i+1]=Math.max(0,Math.min(height-1.001,pt.y));
    }
    this.cache={key,xy};return this.cache;
  }
  normalizedBoard(frame){
    const {width:w,height:h,data}=frame,{xy}=this.geometry(w,h);
    const norm=new Float32Array(OUT_SIZE*OUT_SIZE);
    for(let i=0;i<norm.length;i++){
      const x=xy[2*i],y=xy[2*i+1],x0=Math.floor(x),y0=Math.floor(y);
      const fx=x-x0,fy=y-y0,x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1);
      const offset=(a,b)=>(b*w+a)*4;
      const a=offset(x0,y0),b=offset(x1,y0),c=offset(x0,y1),d=offset(x1,y1);
      const l=k=>.299*data[k]+.587*data[k+1]+.114*data[k+2];
      const u=l(a)*(1-fx)+l(b)*fx,v=l(c)*(1-fx)+l(d)*fx;
      norm[i]=(u*(1-fy)+v*fy)/255;
    }
    return norm;
  }
  async recognize(game,{force=false}={}){
    if(!this.camera.stream||this.camera.corners.length!==4)throw new Error('شغّل الكاميرا وحدد الزوايا');
    const started=performance.now(),now=Date.now();
    const frame=this.camera.frame();
    const pixels=this.normalizedBoard(frame);
    const signature=boardSignature(pixels);
    const difference=this.signature?signatureDifference(this.signature,signature):null;
    // Independent, cheap texture monitor. Every ~5.5s we force a full
    // inference, even if the thumbnail signal remained low.
    const unchanged=!force&&this.signature&&difference?.changed===0&&
      now-this.signatureTime<MODEL_REFRESH_MS;
    if(unchanged){
      this.skipped++;
      return {result:{kind:'unchanged',reason:'fast-texture-same'},decoded:this.lastOutput?.decoded||
        {placement:game.fen().split(' ')[0],meanConfidence:1,minConfidence:1},
        skipped:true,stats:{...this.stats,skipped:this.skipped,backend:this.backend},signature};
    }
    const prep=performance.now()-started;
    let output;
    try{output=await this.probabilities(boardToTiles(pixels))}
    catch(err){
      // Worker failure must not permanently kill move reading. The
      // model is retried on the main thread with a fresh tile tensor.
      if(!this.fallback)throw err;
      output=await this.probabilitiesMain(boardToTiles(pixels));
    }
    const probabilities=output.data;
    if(!probabilities||probabilities.length!==832)throw new Error('ناتج النموذج ليس 64×13');
    const mode=document.getElementById('camera-facing')?.value||'auto';
    let side=mode==='auto'?this.orientation?.side||this.camera.side||'w':mode;
    let orientation=null;
    if(mode==='auto'){
      orientation=chooseVisualOrientation(game,probabilities,side);
      // Once orientation is strongly established, retain it until new
      // calibration; weak screenshots must not flip the AR coordinates.
      if(orientation.verified||!this.orientation){
        side=orientation.side;
        this.orientation={side,verified:orientation.verified};
      }
    }else this.orientation={side,verified:true};
    this.camera.side=side;
    this.camera.drawOverlay?.();
    const whiteBottom=side!=='b';
    const result=inferMovesFromModel(game,probabilities,{whiteBottom});
    const decoded=decodedPosition(probabilities,whiteBottom);
    this.signature=signature;this.signatureTime=now;
    this.stats={prep:Math.round(prep),inference:Math.round(output.modelMs),
      total:Math.round(performance.now()-started),skipped:this.skipped,backend:output.backend,
      changeSquares:difference?.changed??0};
    this.lastOutput={result,decoded,time:now};
    return {result,decoded,skipped:false,stats:this.stats,signature};
  }
}
