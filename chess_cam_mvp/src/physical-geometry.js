// Homography-aware 2D square assignment for a moving, tilted real chessboard.
export function invertBoardPoint(point,u,v){
  const q=point(u,v);return q;
}
export function imageToBoard(point,x,y){
  let u=.5,v=.5;
  for(let i=0;i<12;i++){
    const p=point(u,v),pU=point(u+.001,v),pV=point(u,v+.001);
    const dx=x-p.x,dy=y-p.y;
    const a=(pU.x-p.x)*1000,b=(pV.x-p.x)*1000;
    const c=(pU.y-p.y)*1000,d=(pV.y-p.y)*1000;
    const det=a*d-b*c;
    if(!Number.isFinite(det)||Math.abs(det)<1e-9)return null;
    const du=(d*dx-b*dy)/det,dv=(-c*dx+a*dy)/det;
    u+=Math.max(-.3,Math.min(.3,du));v+=Math.max(-.3,Math.min(.3,dv));
    if(Math.abs(du)+Math.abs(dv)<.00005)break;
  }
  if(!Number.isFinite(u)||!Number.isFinite(v))return null;
  return {u,v};
}
export const PHYSICAL_PIECES='bknpqrBKNPQR';
export const toVisualTile=(r,c)=>(7-r)*8+c;
export function mapPhysicalDetections(detections,point,{
  threshold=.26,upperPadding=.05
}={}){
  // Like CameraChessWeb, use the piece's foot rather than bounding-box
  // centre; tall kings would otherwise be mapped to the rank behind.
  const state=new Float32Array(64*13);
  const squares=new Map();
  for(const box of detections){
    if(box.confidence<threshold)continue;
    const anchorX=box.cx,anchorY=box.cy+box.h*.5-box.w/3;
    const projected=imageToBoard(point,anchorX,anchorY);
    if(!projected||projected.u<-.04||projected.v<-.04||
        projected.u>1.04||projected.v>1.04)continue;
    const c=Math.max(0,Math.min(7,Math.floor(projected.u*8)));
    const r=Math.max(0,Math.min(7,Math.floor(projected.v*8)));
    const tile=toVisualTile(r,c);
    const prev=squares.get(tile);
    if(!prev||box.confidence>prev.confidence)
      squares.set(tile,{...box,r,c,tile});
  }
  for(let i=0;i<64;i++){
    const match=squares.get(i);
    const off=i*13;
    for(let k=0;k<13;k++)state[off+k]=.015;
    if(match){
      const best=PHYSICAL_PIECES.indexOf(match.className);
      if(best<0)continue;
      // Detections are weighted against empty-square probability.
      state[off]=Math.max(.02,1-match.confidence);
      for(let k=0;k<12;k++)
        state[off+'1KQRBNPkqrbnp'.indexOf(PHYSICAL_PIECES[k])]=
          k===best?Math.max(.3,match.confidence):.015;
    }else state[off]=.94;
  }
  return {probabilities:state,count:squares.size,detections:[...squares.values()]};
}
// Deterministic YOLOv8/LeYOLO output decoding, without fragile assumptions
// about total number of anchors. Expected [1,16,N] and 12 piece classes.
export function decodeYolo(raw,shape,{confidence=.23,maxDetections=130}={}){
  if(shape.length!==3||shape[0]!==1||shape[1]!==16)return [];
  const n=shape[2],out=[];
  for(let i=0;i<n;i++){
    let best=0,id=-1;
    for(let k=0;k<12;k++){
      const p=raw[(k+4)*n+i];
      if(p>best){best=p;id=k;}
    }
    if(id<0||best<confidence)continue;
    const cx=raw[i],cy=raw[n+i],w=raw[2*n+i],h=raw[3*n+i];
    if(![cx,cy,w,h].every(Number.isFinite)||w<2||h<2)continue;
    out.push({cx,cy,w,h,className:PHYSICAL_PIECES[id],confidence:best});
  }
  // Keep only reasonably confident detections, limit clutter/duplicates.
  return out.sort((a,b)=>b.confidence-a.confidence).slice(0,maxDetections);
}
