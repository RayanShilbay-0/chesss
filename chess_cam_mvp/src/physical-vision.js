import {inferMovesFromModel,decodedPosition,chooseVisualOrientation} from './model-moves.js';
import {decodeYolo,mapPhysicalDetections} from './physical-geometry.js';
export class PhysicalChessVision{
  constructor(camera){
    this.camera=camera;this.worker=null;this.initPromise=null;
    this.pending=new Map();this.request=0;this.last=null;
    this.lastTime=0;this.filtered=null;this.lastBoard=null;this.backend='LeYOLO ONNX';this.orientation=null;
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
    this.filtered=null;this.lastBoard=null;this.last=null;this.lastTime=0;this.orientation=null;
  }
  close(){this.worker?.terminate();this.worker=null;this.initPromise=null;
    for(const p of this.pending.values())p.reject(Error('Camera stopped'));
    this.pending.clear();
  }
  async detectBoardCorners(){
    if(!this.camera.stream)throw Error('شغّل كاميرا الرقعة الحقيقية أولًا');
    await this.setup();
    const image=this.camera.frame(),id=++this.request;
    const future=new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}));
    const rgba=new Uint8ClampedArray(image.data);
    this.worker.postMessage({type:'corner-detect',id,
      modelUrl:(import.meta.env.BASE_URL||'/')+'models/chesscam-physical-corners.onnx',
      rgba,width:image.width,height:image.height},[rgba.buffer]);
    const data=await future;
    return this.decodeCorners(data,image.width,image.height);
  }
  decodeCorners(data,width,height){
    const {raw,shape,scale,offX,offY}=data;
    if(shape?.[0]!==1||shape?.[1]!==5)return null;
    const n=shape[2],points=[];
    for(let i=0;i<n;i++){
      const confidence=raw[4*n+i];
      if(confidence<.35)continue;
      const x=(raw[i]-offX)/scale,y=(raw[n+i]-offY)/scale;
      if(x<-20||x>width+20||y<-20||y>height+20)continue;
      if(points.some(p=>Math.hypot(p.x-x,p.y-y)<8))continue;
      points.push({x,y,confidence});
    }
    if(points.length<15)return null;
    // Four extreme internal 7x7 chess grid intersections. Extrapolate to
    // the outer 8x8 corners; optical flow handles the subsequent frames.
    const ranked=points.filter(p=>p.confidence>=.45);
    const pool=ranked.length>=12?ranked:points;
    const tl=pool.reduce((a,b)=>a.x+a.y<b.x+b.y?a:b);
    const tr=pool.reduce((a,b)=>a.x-a.y>b.x-b.y?a:b);
    const br=pool.reduce((a,b)=>a.x+a.y>b.x+b.y?a:b);
    const bl=pool.reduce((a,b)=>a.y-a.x>b.y-b.x?a:b);
    const span=Math.hypot(tr.x-tl.x,tr.y-tl.y);
    if(span<70||new Set([tl,tr,br,bl]).size!==4)return null;
    const expand=(p,horiz,vert)=>({
      x:p.x+horiz.x/6+vert.x/6,y:p.y+horiz.y/6+vert.y/6
    });
    const q=[
      expand(tl,{x:tl.x-tr.x,y:tl.y-tr.y},{x:tl.x-bl.x,y:tl.y-bl.y}),
      expand(tr,{x:tr.x-tl.x,y:tr.y-tl.y},{x:tr.x-br.x,y:tr.y-br.y}),
      expand(br,{x:br.x-bl.x,y:br.y-bl.y},{x:br.x-tr.x,y:br.y-tr.y}),
      expand(bl,{x:bl.x-br.x,y:bl.y-br.y},{x:bl.x-tl.x,y:bl.y-tl.y})
    ];
    if(q.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||
       p.x<-.25*width||p.y<-.25*height||p.x>1.25*width||p.y>1.25*height))
      return null;
    return {corners:q,points:pool.length,ms:data.ms};
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
    const inferred=chooseVisualOrientation(game,mapped.probabilities,this.orientation||this.camera.side);
    if(manual==='auto'&&(!this.orientation||inferred.verified&&inferred.margin>14))
      this.orientation=inferred.side;
    const side=manual==='auto'?(this.orientation||this.camera.side):manual;
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
