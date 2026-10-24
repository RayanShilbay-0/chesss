import { boardToTiles } from '@scoriiu/fenshot';
import { inferMovesFromModel, decodedPosition } from './model-moves.js';
import ortJsUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import ortWasmUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
export function wasmAssetUrls(){return {mjs:new URL(ortJsUrl,location.href).href,wasm:new URL(ortWasmUrl,location.href).href};}

const OUT_SIZE=256;
export class TrainedChessVision {
  constructor(camera){this.camera=camera;this.sessionPromise=null;this.cache=null;this.lastOutput=null;}
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
  warmUp(){void this.session().catch(()=>{});}
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
  async recognize(game){
    if(!this.camera.stream||this.camera.corners.length!==4)throw new Error('شغّل الكاميرا وحدد الزوايا');
    const {ort,session}=await this.session();
    const frame=this.camera.frame();
    const pixels=this.normalizedBoard(frame);
    const input=boardToTiles(pixels);
    const raw=await session.run({tiles:new ort.Tensor('float32',input,[64,1024])});
    const probabilities=raw.probs?.data;
    if(!probabilities||probabilities.length!==832)throw new Error('ناتج نموذج القطع ليس 64×13');
    const whiteBottom=this.camera.side!=='b';
    const result=inferMovesFromModel(game,probabilities,{whiteBottom});
    const decoded=decodedPosition(probabilities,whiteBottom);
    this.lastOutput={result,decoded,time:Date.now()};
    return {result,decoded};
  }
}
