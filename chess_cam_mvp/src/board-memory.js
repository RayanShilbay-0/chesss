// Persistent planar board map: tracks the board pose as a homography from
// canonical board coordinates (u,v in [0,1], frame border slightly outside)
// to the current image, and relocalizes from stored keyframes after loss.
//
// Differences from MovingBoardTracker (kept for the legacy mode):
//  * every tracked point keeps its BOARD coordinates, and the pose is solved
//    board->image each frame. The old tracker chained frame-to-frame
//    homographies onto EMA-smoothed corners, so 28% of every motion step was
//    discarded and the overlay drifted behind a moving phone;
//  * the board corners may leave the image (zoom, partial view): validity is
//    decided by inliers and reprojection error, not by corner positions;
//  * ORB keyframes with board coordinates allow relocalization from a
//    partial view after the board was lost, without a new 4-corner click;
//  * only features on the board plane (board + frame) are mapped, so the
//    table background cannot produce a confident but wrong pose.
// Losing the pose never touches the chess game state.
import {applyH,invertH,solveHomography,multiplyH as multiply} from './homography.js';

const del=(...mats)=>mats.forEach(m=>{try{m?.delete?.()}catch{}});
const MARGIN=.11; // frame border around the 8x8 squares, in board units

export const DEFAULTS={
  minInliers:12,minRatio:.45,maxRms:3.2,
  maxPoints:260,reseedBelow:90,reseedEvery:8,
  keyframeEvery:12,maxKeyframes:14,keyframeNovelty:.22,
  relocEvery:2,relocMinInliers:18,relocRatio:.8,orbFeatures:700,
  maxScaleStep:1.7
};
function frameHomographyFromCv(H){
  const d=H.data64F?.length>=9?H.data64F:H.data32F;
  if(!d||d.length<9)return null;
  const s=d[8];
  return Array.from(d,x=>x/s);
}
// Polygon of the board (+frame) in the image, clipped to points in front.
function boardPolygon(H,margin=MARGIN,steps=8){
  const out=[];
  const edge=(u0,v0,u1,v1)=>{
    for(let k=0;k<steps;k++){
      const t=k/steps,p=applyH(H,u0+(u1-u0)*t,v0+(v1-v0)*t);
      if(p.z>0&&Number.isFinite(p.x)&&Number.isFinite(p.y))out.push(p);
    }
  };
  const a=-margin,b=1+margin;
  edge(a,a,b,a);edge(b,a,b,b);edge(b,b,a,b);edge(a,b,a,a);
  return out;
}
export function visibleBoardFraction(H,width,height,samples=12){
  let n=0;
  for(let i=0;i<samples;i++)for(let j=0;j<samples;j++){
    const p=applyH(H,(i+.5)/samples,(j+.5)/samples);
    if(p.z>0&&p.x>=0&&p.y>=0&&p.x<width&&p.y<height)n++;
  }
  return n/(samples*samples);
}
const scaleOf=H=>{
  const a=applyH(H,.5,.5),b=applyH(H,.625,.5),c=applyH(H,.5,.625);
  return Math.sqrt(Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)));
};
export class BoardMemory{
  constructor(cv,options={}){
    this.cv=cv;this.o={...DEFAULTS,...options};
    this.keyframes=[];this.reset();
  }
  reset(){
    del(this.prevGray);
    this.prevGray=null;this.pts=[];this.H=null;this.state='empty';
    this.frame=0;this.sinceSeed=0;this.sinceKeyframe=0;this.lostFrames=0;
    this.inliers=0;this.rms=0;this.lastGood=null;this.votes=new Map();
  }
  clear(){this.reset();for(const k of this.keyframes)del(k.descriptors);this.keyframes=[];}
  get mapped(){return this.keyframes.length>0;}
  toGray(image){
    const cv=this.cv;
    if(image.gray){
      const m=new cv.Mat(image.height,image.width,cv.CV_8UC1);
      m.data.set(image.gray);return m;
    }
    const rgba=cv.matFromImageData(image),gray=new cv.Mat();
    cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);del(rgba);
    return gray;
  }
  mask(gray,H){
    const cv=this.cv,mask=cv.Mat.zeros(gray.rows,gray.cols,cv.CV_8UC1);
    const poly=boardPolygon(H);
    if(poly.length<3)return mask;
    const flat=[];
    for(const p of poly)flat.push(Math.max(-4*gray.cols,Math.min(5*gray.cols,Math.round(p.x))),
      Math.max(-4*gray.rows,Math.min(5*gray.rows,Math.round(p.y))));
    const pts=cv.matFromArray(poly.length,1,cv.CV_32SC2,flat),vec=new cv.MatVector();
    vec.push_back(pts);
    cv.fillPoly(mask,vec,new cv.Scalar(255));
    del(pts,vec);
    return mask;
  }
  // Initial acquisition (or a verified re-detection): H maps board -> image.
  acquire(image,H,{keyframe=true}={}){
    const gray=this.toGray(image);
    try{
      this.H=H;this.state='tracking';this.lostFrames=0;this.lastGood=H;
      this.seed(gray,true);
      if(keyframe)this.addKeyframe(gray,H,true);
      del(this.prevGray);this.prevGray=gray.clone();
      return this.status(image);
    }finally{del(gray);}
  }
  seed(gray,replace=false){
    const cv=this.cv,mask=this.mask(gray,this.H),corners=new cv.Mat();
    try{
      const want=this.o.maxPoints-(replace?0:this.pts.length);
      if(want<20)return;
      cv.goodFeaturesToTrack(gray,corners,want,.01,6,mask,5,false,.04);
      const inv=invertH(this.H);if(!inv)return;
      const fresh=[];
      for(let i=0;i<corners.rows;i++){
        const x=corners.data32F[2*i],y=corners.data32F[2*i+1],g=applyH(inv,x,y);
        if(g.z<=0||g.x<-MARGIN||g.y<-MARGIN||g.x>1+MARGIN||g.y>1+MARGIN)continue;
        if(!replace&&this.pts.some(p=>Math.abs(p.x-x)+Math.abs(p.y-y)<5))continue;
        fresh.push({x,y,u:g.x,v:g.y,age:0});
      }
      this.pts=replace?fresh:this.pts.concat(fresh);
      this.sinceSeed=0;
    }finally{del(mask,corners);}
  }
  addKeyframe(gray,H,force=false){
    const cv=this.cv;
    if(!force){
      // Only store views that differ from existing keyframes.
      const c=applyH(H,.5,.5),s=scaleOf(H),angle=Math.atan2(applyH(H,1,.5).y-c.y,applyH(H,1,.5).x-c.x);
      const novel=this.keyframes.every(k=>{
        const dc=Math.hypot(k.center.x-c.x,k.center.y-c.y)/Math.max(s,k.scale)/8;
        const ds=Math.abs(Math.log(s/k.scale)),da=Math.abs(Math.atan2(Math.sin(angle-k.angle),Math.cos(angle-k.angle)));
        return dc+ds+da>this.o.keyframeNovelty;
      });
      if(!novel)return false;
    }
    const orb=new cv.ORB(this.o.orbFeatures),kps=new cv.KeyPointVector(),desc=new cv.Mat();
    const mask=this.mask(gray,H);
    try{
      orb.detectAndCompute(gray,mask,kps,desc);
      const inv=invertH(H);
      if(!inv||kps.size()<30){del(desc);return false;}
      const board=[];
      for(let i=0;i<kps.size();i++){
        const p=kps.get(i).pt,g=applyH(inv,p.x,p.y);
        board.push({u:g.x,v:g.y});
      }
      const c=applyH(H,.5,.5),e=applyH(H,1,.5);
      this.keyframes.push({descriptors:desc,board,frame:this.frame,center:c,scale:scaleOf(H),
        angle:Math.atan2(e.y-c.y,e.x-c.x),pinned:force&&this.keyframes.length===0});
      if(this.keyframes.length>this.o.maxKeyframes){
        const k=this.keyframes.findIndex(k=>!k.pinned);
        del(this.keyframes[k].descriptors);this.keyframes.splice(k,1);
      }
      this.sinceKeyframe=0;
      return true;
    }finally{del(orb,kps,mask);}
  }
  // Progressive verification. A later, independent board detection (x-corner
  // lattice) is compared with the map: if both describe the same lattice but
  // the 8x8 window differs by whole squares, vote for that shift. When a
  // shift clearly out-votes "no change", re-anchor the map (all stored
  // points and keyframes keep their physical location). Rotations between
  // labelings are ignored here: chess orientation is resolved separately.
  observeBoardDetection(Hdet,weight=1){
    if(!this.H||!Hdet)return {accepted:false,reason:'no-pose'};
    const inv=invertH(this.H);if(!inv)return {accepted:false,reason:'singular'};
    const T=multiply(inv,Hdet),c=applyH(T,.5,.5);
    const s={x:c.x-.5,y:c.y-.5};
    const corners=[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>applyH(T,u,v));
    const target=[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>({x:u+s.x,y:v+s.y}));
    const fits=corners.every(p=>target.some(t=>Math.hypot(p.x-t.x,p.y-t.y)<.07));
    const kx=Math.round(s.x*8),ky=Math.round(s.y*8);
    if(!fits||Math.abs(s.x*8-kx)>.3||Math.abs(s.y*8-ky)>.3||Math.abs(kx)>4||Math.abs(ky)>4)
      return {accepted:false,reason:'inconsistent'};
    const key=kx+','+ky;
    this.votes=this.votes||new Map();
    this.votes.set(key,(this.votes.get(key)||0)+weight);
    const same=this.votes.get('0,0')||0,mine=this.votes.get(key);
    if(key!=='0,0'&&mine>=3*weight&&mine>=same+2*weight){
      const sh=[1,0,kx/8,0,1,ky/8,0,0,1],back={x:-kx/8,y:-ky/8};
      this.H=multiply(this.H,sh);this.lastGood=this.H;
      for(const p of this.pts){p.u+=back.x;p.v+=back.y;}
      for(const k of this.keyframes)for(const b of k.board){b.u+=back.x;b.v+=back.y;}
      this.votes=new Map([['0,0',mine]]);
      this.corrections=(this.corrections||0)+1;
      return {accepted:true,shift:[kx,ky]};
    }
    return {accepted:false,vote:key};
  }
  status(image){
    const width=image.width,height=image.height;
    const ok=this.state==='tracking'||this.state==='relocalized';
    return {state:this.state,poseValid:ok,H:ok?this.H:null,inliers:this.inliers,rms:this.rms,
      visible:ok?visibleBoardFraction(this.H,width,height):0,keyframes:this.keyframes.length,
      points:this.pts.length,lostFrames:this.lostFrames};
  }
  plausible(H,prev,width,height){
    if(!H||!H.every(Number.isFinite))return false;
    // Board centre must be in front of the camera and the 4 board corners too.
    for(const [u,v] of [[0,0],[1,0],[1,1],[0,1],[.5,.5]])if(!(applyH(H,u,v).z>0))return false;
    const s=scaleOf(H);
    if(!(s>3)||s>Math.max(width,height))return false; // a square of >3 px
    if(prev){
      const r=s/scaleOf(prev);
      if(r>this.o.maxScaleStep||r<1/this.o.maxScaleStep)return false;
    }
    return visibleBoardFraction(H,width,height,8)>0;
  }
  solve(board,image,threshold=3){
    const cv=this.cv,n=board.length;
    if(n<4)return null;
    const src=cv.matFromArray(n,1,cv.CV_32FC2,board.flatMap(p=>[p.u*1000,p.v*1000]));
    const dst=cv.matFromArray(n,1,cv.CV_32FC2,image.flatMap(p=>[p.x,p.y]));
    const mask=new cv.Mat();let Hm=null;
    try{
      Hm=cv.findHomography(src,dst,cv.RANSAC,threshold,mask,2000,.995);
      if(Hm.empty())return null;
      const H0=frameHomographyFromCv(Hm);
      if(!H0)return null;
      // Undo the x1000 board scaling (kept for RANSAC numerical stability).
      const H=[H0[0]*1000,H0[1]*1000,H0[2],H0[3]*1000,H0[4]*1000,H0[5],H0[6]*1000,H0[7]*1000,H0[8]];
      const inl=[];let err=0;
      for(let i=0;i<n;i++)if(mask.data[i]){
        inl.push(i);const p=applyH(H,board[i].u,board[i].v);
        err+=(p.x-image[i].x)**2+(p.y-image[i].y)**2;
      }
      return {H,inliers:inl,rms:Math.sqrt(err/Math.max(1,inl.length))};
    }finally{del(src,dst,mask,Hm);}
  }
  // Per video frame. Returns status; H (board->image) only when trustworthy.
  track(image){
    const cv=this.cv;this.frame++;
    if(!this.H&&!this.mapped)return this.status(image);
    const gray=this.toGray(image);
    try{
      if(this.state==='tracking'||this.state==='relocalized'){
        if(this.flow(gray,image))this.maintain(gray);
        else{this.state='lost';this.lostFrames=1;}
      }else{
        this.lostFrames++;
        if(this.mapped&&this.lostFrames%this.o.relocEvery===0)this.relocalize(gray,image);
      }
      del(this.prevGray);this.prevGray=gray.clone();
      return this.status(image);
    }finally{del(gray);}
  }
  flow(gray,image){
    const cv=this.cv;
    if(!this.prevGray||this.pts.length<this.o.minInliers)return false;
    const n=this.pts.length;
    const prev=cv.matFromArray(n,1,cv.CV_32FC2,this.pts.flatMap(p=>[p.x,p.y]));
    const next=new cv.Mat(),status=new cv.Mat(),err=new cv.Mat();
    const back=new cv.Mat(),status2=new cv.Mat(),err2=new cv.Mat();
    try{
      const win=new cv.Size(21,21),crit=new cv.TermCriteria(cv.TermCriteria_COUNT+cv.TermCriteria_EPS,20,.03);
      cv.calcOpticalFlowPyrLK(this.prevGray,gray,prev,next,status,err,win,3,crit);
      cv.calcOpticalFlowPyrLK(gray,this.prevGray,next,back,status2,err2,win,3,crit);
      const kept=[];
      for(let i=0;i<n;i++){
        if(!status.data[i]||!status2.data[i])continue;
        const x=next.data32F[2*i],y=next.data32F[2*i+1];
        // Forward-backward consistency rejects drifting/occluded points.
        if(Math.hypot(back.data32F[2*i]-this.pts[i].x,back.data32F[2*i+1]-this.pts[i].y)>1.2)continue;
        if(x<0||y<0||x>=image.width||y>=image.height)continue;
        kept.push({...this.pts[i],x,y,age:this.pts[i].age+1});
      }
      if(kept.length<this.o.minInliers)return false;
      const sol=this.solve(kept,kept);
      if(!sol)return false;
      const ratio=sol.inliers.length/kept.length;
      if(sol.inliers.length<this.o.minInliers||ratio<this.o.minRatio||sol.rms>this.o.maxRms||
        !this.plausible(sol.H,this.H,image.width,image.height))return false;
      this.H=sol.H;this.lastGood=sol.H;this.inliers=sol.inliers.length;this.rms=sol.rms;
      this.pts=sol.inliers.map(i=>kept[i]);
      if(this.state==='relocalized'&&this.inliers>=2*this.o.minInliers)this.state='tracking';
      return true;
    }finally{del(prev,next,status,err,back,status2,err2);}
  }
  maintain(gray){
    this.sinceSeed++;this.sinceKeyframe++;
    if(this.pts.length<this.o.reseedBelow||this.sinceSeed>=this.o.reseedEvery){
      // Re-anchor long-lived points to the current pose to bound drift.
      this.seed(gray,false);
    }
    if(this.sinceKeyframe>=this.o.keyframeEvery&&this.inliers>=40&&this.rms<1.6)
      this.addKeyframe(gray,this.H);
  }
  relocalize(gray,image){
    const cv=this.cv;
    const orb=new cv.ORB(this.o.orbFeatures),kps=new cv.KeyPointVector(),desc=new cv.Mat();
    const matcher=new cv.BFMatcher(cv.NORM_HAMMING,false),none=new cv.Mat();
    try{
      orb.detectAndCompute(gray,none,kps,desc);
      if(kps.size()<30)return false;
      let best=null;
      // Match each keyframe separately: one consistent view beats a mix.
      for(const kf of this.keyframes){
        const matches=new cv.DMatchVectorVector();
        try{
          matcher.knnMatch(desc,kf.descriptors,matches,2);
          const board=[],img=[];
          for(let i=0;i<matches.size();i++){
            const m=matches.get(i);
            if(m.size()<2)continue;
            const a=m.get(0),b=m.get(1);
            if(a.distance>this.o.relocRatio*b.distance||a.distance>64)continue;
            const p=kps.get(a.queryIdx).pt;
            board.push(kf.board[a.trainIdx]);img.push({x:p.x,y:p.y});
          }
          if(board.length<this.o.relocMinInliers)continue;
          const sol=this.solve(board,img,4);
          if(!sol||sol.inliers.length<this.o.relocMinInliers)continue;
          if(!best||sol.inliers.length>best.inliers.length)best=sol;
        }finally{del(matches);}
      }
      if(!best||!this.plausible(best.H,null,image.width,image.height)||best.rms>3.5)return false;
      this.H=best.H;this.state='relocalized';this.inliers=best.inliers.length;this.rms=best.rms;
      this.lostFrames=0;this.seed(gray,true);
      return true;
    }finally{del(orb,kps,desc,matcher,none);}
  }
}
export {MARGIN as BOARD_FRAME_MARGIN,solveHomography};
