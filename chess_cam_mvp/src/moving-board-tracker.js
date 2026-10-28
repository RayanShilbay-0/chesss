// Mobile perspective tracking: pyramidal Lucas–Kanade optical flow +
// RANSAC homography. OpenCV.js (Apache-2.0) is loaded only for a real camera.
// Never guess a pose when insufficient inlier features survive.
export const quadArea=q=>Math.abs(q.reduce((s,p,i)=>{
  const n=q[(i+1)%q.length];
  return s+p.x*n.y-n.x*p.y;
},0))/2;
export function poseIsValid(before,after,width,height){
  if(before.length!==4||after.length!==4)return false;
  if(after.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||
      p.x<-.12*width||p.x>1.12*width||p.y<-.12*height||p.y>1.12*height))
    return false;
  const a=quadArea(before),b=quadArea(after);
  if(a<1200||b<1200||b/a<.50||b/a>2.05)return false;
  let sign=0;
  for(let i=0;i<4;i++){
    const p=after[i],q=after[(i+1)%4],r=after[(i+2)%4];
    const cross=(q.x-p.x)*(r.y-q.y)-(q.y-p.y)*(r.x-q.x);
    if(Math.abs(cross)<1)return false;
    if(sign&&cross*sign<=0)return false;
    sign=cross;
  }
  return true;
}
export function stabilizeCorners(current,target,alpha=.72){
  return current.map((p,i)=>({
    x:p.x*(1-alpha)+target[i].x*alpha,
    y:p.y*(1-alpha)+target[i].y*alpha
  }));
}
let cvPending=null;
export async function loadOpenCV(){
  if(cvPending)return cvPending;
  cvPending=new Promise((resolve,reject)=>{
    const current=globalThis.cv;
    if(current?.Mat){resolve(current);return;}
    const script=document.createElement('script');
    script.src=(import.meta.env.BASE_URL||'/')+'opencv/opencv.js';
    script.async=true;
    script.onload=async()=>{
      try{
        const exported=globalThis.cv;
        if(exported?.then)resolve(await exported);
        else if(exported?.Mat)resolve(exported);
        else{
          exported.onRuntimeInitialized=()=>resolve(exported);
          setTimeout(()=>{if(!exported.Mat)reject(new Error('OpenCV loading timeout'))},17000);
        }
      }catch(err){reject(err)}
    };
    script.onerror=()=>reject(new Error('Could not download OpenCV.js'));
    document.head.appendChild(script);
  }).catch(err=>{cvPending=null;throw err});
  return cvPending;
}
const cleanup=(...items)=>items.forEach(item=>{try{item?.delete?.()}catch{}});
export class MovingBoardTracker{
  constructor(camera,callback=()=>{}){
    this.camera=camera;this.callback=callback;this.cv=null;this.prevGray=null;
    this.prevPts=null;this.active=false;this.state='idle';this.lastTime=0;
    this.inliers=0;this.retries=0;this.busy=false;this.frameVersion=0;
  }
  async start(){
    if(this.active)return;
    this.cv=await loadOpenCV();
    if(!this.cv?.calcOpticalFlowPyrLK||!this.cv?.findHomography)
      throw Error('This OpenCV.js build does not include optical flow or homography.');
    this.active=true;this.reset();
    this.callback('جاهز: تتبّع منظور الرقعة بالكاميرا أثناء الحركة');
  }
  reset(){
    cleanup(this.prevGray,this.prevPts);
    this.prevGray=null;this.prevPts=null;this.state='initializing';
    this.inliers=0;this.lastTime=0;this.retries=0;this.frameVersion++;
  }
  stop(){
    this.active=false;this.reset();this.state='idle';this.cv=null;
  }
  // Use a mask around the board, excluding square centers where pieces move.
  regionMask(gray){
    const cv=this.cv,corners=this.camera.corners;
    const mask=cv.Mat.zeros(gray.rows,gray.cols,cv.CV_8UC1);
    if(corners.length!==4)return mask;
    const minX=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.x))));
    const maxX=Math.min(gray.cols,Math.ceil(Math.max(...corners.map(p=>p.x))));
    const minY=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.y))));
    const maxY=Math.min(gray.rows,Math.ceil(Math.max(...corners.map(p=>p.y))));
    // Interior stripes around the true grid intersections favor stationary
    // board texture over movable pieces.
    for(let r=1;r<8;r++)for(let c=1;c<8;c++){
      const pt=this.camera.point(c/8,r/8);
      const x=Math.round(pt.x),y=Math.round(pt.y);
      const size=Math.max(5,Math.round(Math.sqrt(quadArea(corners))/55));
      for(let yy=Math.max(minY,y-size);yy<Math.min(maxY,y+size);yy++)
        for(let xx=Math.max(minX,x-size);xx<Math.min(maxX,x+size);xx++)
          mask.ucharPtr(yy,xx)[0]=255;
    }
    // Also enable outer edges and board corners.
    for(let r=0;r<=8;r++)for(let c=0;c<=8;c++){
      if(r!==0&&r!==8&&c!==0&&c!==8)continue;
      const pt=this.camera.point(c/8,r/8),x=Math.round(pt.x),y=Math.round(pt.y);
      for(let yy=Math.max(0,y-5);yy<Math.min(gray.rows,y+6);yy++)
        for(let xx=Math.max(0,x-5);xx<Math.min(gray.cols,x+6);xx++)
          mask.ucharPtr(yy,xx)[0]=255;
    }
    return mask;
  }
  seed(gray){
    const cv=this.cv,mask=this.regionMask(gray),pts=new cv.Mat();
    try{
      cv.goodFeaturesToTrack(gray,pts,180,.012,4,mask,5,false,.04);
      if(pts.rows<10){
        this.state='lost';this.inliers=pts.rows;return false;
      }
      cleanup(this.prevPts);
      this.prevPts=pts.clone();
      this.state='tracking';this.inliers=pts.rows;
      return true;
    }finally{cleanup(pts,mask);}
  }
  observe(frame){
    if(!this.active||!this.cv||this.busy||this.camera.calibrating||
        this.camera.corners.length!==4)return {state:this.state};
    this.busy=true;
    const cv=this.cv;
    let rgba=null,gray=null,next=null,status=null,errors=null,src=null,dst=null,H=null,inlierMask=null;
    try{
      rgba=cv.matFromImageData(frame);gray=new cv.Mat();
      cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);
      if(!this.prevGray||!this.prevPts||this.prevPts.rows<10){
        this.seed(gray);
        cleanup(this.prevGray);this.prevGray=gray.clone();
        return {state:this.state,inliers:this.inliers};
      }
      next=new cv.Mat();status=new cv.Mat();errors=new cv.Mat();
      cv.calcOpticalFlowPyrLK(this.prevGray,gray,this.prevPts,next,status,errors,
        new cv.Size(21,21),3,
        new cv.TermCriteria(cv.TermCriteria_COUNT+cv.TermCriteria_EPS,22,.018));
      const a=[],b=[];
      for(let i=0;i<status.rows;i++){
        if(!status.data[i])continue;
        const x=this.prevPts.data32F[2*i],y=this.prevPts.data32F[2*i+1];
        const xx=next.data32F[2*i],yy=next.data32F[2*i+1];
        if(!Number.isFinite(xx)||!Number.isFinite(yy))continue;
        if(Math.hypot(xx-x,yy-y)>Math.max(frame.width,frame.height)*.24)continue;
        a.push(x,y);b.push(xx,yy);
      }
      if(a.length<10){this.state='lost';this.inliers=a.length;this.retries++;return {state:this.state,inliers:a.length};}
      src=cv.matFromArray(a.length/2,1,cv.CV_32FC2,a);
      dst=cv.matFromArray(b.length/2,1,cv.CV_32FC2,b);
      inlierMask=new cv.Mat();H=cv.findHomography(src,dst,cv.RANSAC,3.5,inlierMask);
      let count=0;
      for(let i=0;i<inlierMask.rows;i++)count+=inlierMask.data[i]?1:0;
      if(H.empty()||count<9||count/a.length<.43){
        this.state='lost';this.inliers=count;this.retries++;
        return {state:this.state,inliers:count};
      }
      const d=H.data64F?.length>=9?H.data64F:H.data32F;
      if(!d||d.length<9)throw Error('Invalid homography transform.');
      const mapped=this.camera.corners.map(p=>{
        const z=d[6]*p.x+d[7]*p.y+d[8];
        return {x:(d[0]*p.x+d[1]*p.y+d[2])/z,
          y:(d[3]*p.x+d[4]*p.y+d[5])/z};
      });
      if(!poseIsValid(this.camera.corners,mapped,frame.width,frame.height)){
        this.state='lost';this.retries++;return {state:this.state,inliers:count};
      }
      this.camera.corners=stabilizeCorners(this.camera.corners,mapped);
      this.camera.drawOverlay();
      this.state='tracking';this.inliers=count;this.retries=0;
      cleanup(this.prevPts,this.prevGray);
      this.prevPts=dst.clone();
      this.prevGray=gray.clone();
      // Refresh stationary grid features periodically, otherwise tracking
      // only a small subset can drift after many seconds of hand-held motion.
      if(Date.now()-this.lastTime>1300){this.seed(gray);this.lastTime=Date.now();}
      return {state:this.state,inliers:this.inliers};
    }catch(e){
      this.state='lost';this.retries++;
      return {state:this.state,error:String(e),inliers:this.inliers};
    }finally{
      cleanup(rgba,gray,next,status,errors,src,dst,H,inlierMask);
      this.busy=false;
    }
  }
}
