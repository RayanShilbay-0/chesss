import {inferMovesFromModel,decodedPosition,chooseVisualOrientation} from './model-moves.js';
import {decodeYolo,mapPhysicalDetections} from './physical-geometry.js';
export class PhysicalChessVision{
  constructor(camera){
    this.camera=camera;this.worker=null;this.initPromise=null;
    this.pending=new Map();this.request=0;this.last=null;
    this.lastTime=0;this.filtered=null;this.lastBoard=null;this.backend='LeYOLO ONNX';
  }
  async setup(){
    if(this.initPromise)return this.initPromise;
    this.initPromise=new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./physical-vision-worker.js',import.meta.url),{type:'module'});
      this.worker=worker;
      const timeout=setTimeout(()=>reject(new Error('Physical model download timed out')),45000);
      worker.onmessage=e=>{
        const m=e.data;
        if(m.type==='ready'){clearTimeout(timeout);resolve(true);return;}
        if(m.type==='init-error'){clearTimeout(timeout);reject(new Error(m.error));return;}
        const p=this.pending.get(m.id);
        if(!p)return;
        this.pending.delete(m.id);
        if(m.type==='result')p.resolve(m);
        else p.reject(new Error(m.error));
      };
      worker.onerror=e=>{clearTimeout(timeout);reject(new Error(e.message||'LeYOLO Worker error'))};
      worker.postMessage({type:'init',
        modelUrl:(import.meta.env.BASE_URL||'/')+'models/chesscam-physical-pieces.onnx'});
    }).catch(err=>{
      this.worker?.terminate();this.worker=null;this.initPromise=null;throw err;
    });
    return this.initPromise;
  }
  warmUp(){void this.setup().catch(()=>{});}
  reset(){
    this.filtered=null;this.lastBoard=null;this.last=null;this.lastTime=0;
  }
  close(){this.worker?.terminate();this.worker=null;this.initPromise=null;
    for(const p of this.pending.values())p.reject(Error('Camera stopped'));
    this.pending.clear();
  }
  async recognize(game,{force=false}={}){
    if(!this.camera.stream||this.camera.corners.length!==4)
      throw Error('حدد أربع زوايا للرقعة أولًا');
    if(this.camera.poseValid===false)
      return {result:{kind:'unstable'},decoded:null,unstable:true};
    await this.setup();
    const frame=this.camera.frame(),id=++this.request;
    // Keep a frame-local board pose: the phone can move while ONNX infers.
    const corners=this.camera.corners.map(p=>({...p}));
    const point=(u,v)=>{
      const [a,b,c,d]=corners;
      const dx1=b.x-c.x,dx2=d.x-c.x,dx3=a.x-b.x+c.x-d.x;
      const dy1=b.y-c.y,dy2=d.y-c.y,dy3=a.y-b.y+c.y-d.y;
      const det=dx1*dy2-dx2*dy1;
      if(Math.abs(det)<1e-7)return {
        x:a.x*(1-u)*(1-v)+b.x*u*(1-v)+c.x*u*v+d.x*(1-u)*v,
        y:a.y*(1-u)*(1-v)+b.y*u*(1-v)+c.y*u*v+d.y*(1-u)*v
      };
      const g=(dx3*dy2-dx2*dy3)/det,h=(dx1*dy3-dx3*dy1)/det;
      const z=g*u+h*v+1;
      return {x:((b.x-a.x+g*b.x)*u+(d.x-a.x+h*d.x)*v+a.x)/z,
        y:((b.y-a.y+g*b.y)*u+(d.y-a.y+h*d.y)*v+a.y)/z};
    };
    const prediction=new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}));
    const copied=new Uint8ClampedArray(frame.data);
    this.worker.postMessage({type:'infer',id,rgba:copied,
      width:frame.width,height:frame.height},[copied.buffer]);
    const output=await prediction;
    const rawDetections=decodeYolo(output.raw,output.shape);
    // Undo 480x288 letterbox before projection to the moving board plane.
    const detections=rawDetections.map(d=>({
      ...d,cx:(d.cx-output.offX)/output.scale,
      cy:(d.cy-output.offY)/output.scale,
      w:d.w/output.scale,h:d.h/output.scale
    }));
    const mapped=mapPhysicalDetections(detections,point);
    if(mapped.count<7||mapped.count>35)
      return {result:{kind:'unreliable',reason:'insufficient-physical-pieces'},
        decoded:null,detections:mapped.detections,count:mapped.count,
        stats:{inference:output.ms,backend:this.backend}};
    if(this.filtered?.length===832){
      for(let i=0;i<mapped.probabilities.length;i++)
        mapped.probabilities[i]=this.filtered[i]*.38+mapped.probabilities[i]*.62;
    }
    this.filtered=mapped.probabilities;
    const manual=document.getElementById('camera-facing')?.value||'auto';
    const inferred=chooseVisualOrientation(game,mapped.probabilities,this.camera.side);
    const side=manual==='auto'?inferred.side:manual;
    if(this.camera.side!==side){this.camera.side=side;this.camera.drawOverlay();}
    const whiteBottom=side==='w';
    const result=inferMovesFromModel(game,mapped.probabilities,{whiteBottom});
    const decoded=decodedPosition(mapped.probabilities,whiteBottom);
    this.last={result,decoded,time:Date.now(),count:mapped.count,detections:mapped.detections};
    return {result,decoded,count:mapped.count,detections:mapped.detections,
      stats:{inference:output.ms,total:output.ms,backend:this.backend},
      unstable:false};
  }
}
