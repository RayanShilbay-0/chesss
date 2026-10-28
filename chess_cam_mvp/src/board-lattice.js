// Fit the chessboard's 7x7 internal-corner lattice to LeYOLO x-corner
// detections, then locate the 8x8 board inside that lattice.
//
// The previous heuristic took the four extreme detections and extrapolated
// one square outward. On the user's real photos the x-corner model rarely
// finds the complete 7x7 grid, so that quad covered ~6x6 squares and every
// piece was mapped to the wrong square. Here a RANSAC lattice hypothesis
// assigns integer grid coordinates to every detection, and the board's
// position along each axis is chosen by checkerboard contrast (inside the
// board) versus the plain wooden frame (just outside it).
import {applyH,invertH,solveHomography,multiplyH} from './homography.js';
import {pieceFoot,imageToBoard} from './physical-geometry.js';

const near=(pts,a,k)=>pts.map(p=>({p,d:Math.hypot(p.x-a.x,p.y-a.y)}))
  .filter(o=>o.d>4).sort((x,y)=>x.d-y.d).slice(0,k).map(o=>o.p);

function scoreLattice(H,points,tolerance){
  const inv=invertH(H);
  if(!inv)return {count:0,score:0,members:[]};
  let count=0,score=0;const members=[];
  for(const p of points){
    const g=applyH(inv,p.x,p.y);
    if(!(g.z>0)||!Number.isFinite(g.x)||!Number.isFinite(g.y)||Math.abs(g.x)>14||Math.abs(g.y)>14)continue;
    const i=Math.round(g.x),j=Math.round(g.y),err=Math.hypot(g.x-i,g.y-j);
    if(err<tolerance){count++;score+=1-err/tolerance;members.push({p,i,j,err});}
  }
  return {count,score,members};
}
function refit(members){
  const best=new Map();
  for(const m of members){
    const key=m.i+','+m.j,old=best.get(key);
    if(!old||old.err>m.err)best.set(key,m);
  }
  const list=[...best.values()];
  if(list.length<5)return null;
  return solveHomography(list.map(m=>({x:m.i,y:m.j})),list.map(m=>m.p));
}
// Points: [{x,y,confidence}] image coordinates of internal x-corners.
export function fitLatticeHomography(points,{tolerance=.2,maxSeeds=60}={}){
  const pts=points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(pts.length<6)return null;
  const seeds=[...pts].sort((a,b)=>(b.confidence??1)-(a.confidence??1)).slice(0,maxSeeds);
  let best=null;
  for(const a of seeds){
    const nb=near(pts,a,7);
    for(const b of nb)for(const c of nb){
      if(b===c)continue;
      const v1={x:b.x-a.x,y:b.y-a.y},v2={x:c.x-a.x,y:c.y-a.y};
      const l1=Math.hypot(v1.x,v1.y),l2=Math.hypot(v2.x,v2.y);
      const cross=v1.x*v2.y-v1.y*v2.x;
      if(cross<=0||cross/(l1*l2)<.45||l1/l2>2.6||l2/l1>2.6)continue;
      const t={x:b.x+c.x-a.x,y:b.y+c.y-a.y};
      let d=null,dd=Infinity;
      for(const p of pts){const q=Math.hypot(p.x-t.x,p.y-t.y);if(q<dd){dd=q;d=p;}}
      if(!d||dd>.32*Math.min(l1,l2)||d===a||d===b||d===c)continue;
      const H=solveHomography([{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1}],[a,b,c,d]);
      if(!H)continue;
      const s=scoreLattice(H,pts,tolerance);
      // Any unimodular basis (e.g. a diagonal one) fits the same points;
      // among near-equal fits keep the reduced (shortest-vector) basis.
      // Scale-free, and unlike an aspect-ratio test it is not fooled by
      // foreshortened cells on a tilted board.
      const shape=(l1+l2)/Math.sqrt(cross);
      if(!best||s.score>best.score+.5||(s.score>best.score-.5&&shape<best.shape))best={H,...s,shape};
    }
  }
  if(!best||best.count<6)return null;
  best=reduceBasis(best,pts,tolerance);
  // Iterative least-squares refinement on all lattice members.
  for(let k=0;k<4;k++){
    const H=refit(best.members);
    if(!H)break;
    const s=scoreLattice(H,pts,tolerance);
    if(s.count<best.count)break;
    best={H,...s};
  }
  return best;
}
// Gauss lattice reduction at the members' centroid: replace a sheared basis
// (e.g. one square + one diagonal) by the shortest pair of grid vectors.
// Any unimodular basis explains the same detections equally well, so the
// RANSAC score alone cannot tell them apart on real, noisy frames.
export function reduceBasis(fit,pts,tolerance){
  const n=fit.members.length;
  const ci=fit.members.reduce((s,m)=>s+m.i,0)/n,cj=fit.members.reduce((s,m)=>s+m.j,0)/n;
  const o=applyH(fit.H,ci,cj),pi=applyH(fit.H,ci+1,cj),pj=applyH(fit.H,ci,cj+1);
  let a={x:pi.x-o.x,y:pi.y-o.y},b={x:pj.x-o.x,y:pj.y-o.y};
  // Track M (2x2 integer, columns = new basis in old lattice coordinates).
  let M=[1,0,0,1];
  const len=v=>v.x*v.x+v.y*v.y;
  for(let k=0;k<12;k++){
    if(len(a)>len(b)){[a,b]=[b,a];M=[M[1],M[0],M[3],M[2]];}
    const mu=Math.round((a.x*b.x+a.y*b.y)/len(a));
    if(!mu)break;
    b={x:b.x-mu*a.x,y:b.y-mu*a.y};
    M=[M[0],M[1]-mu*M[0],M[2],M[3]-mu*M[2]];
  }
  if(M[0]===1&&M[1]===0&&M[2]===0&&M[3]===1)return fit;
  // Keep a right-handed basis so corner ordering logic is unchanged.
  if(M[0]*M[3]-M[1]*M[2]<0)M=[M[0],-M[1],M[2],-M[3]];
  const Hm=[M[0],M[1],0,M[2],M[3],0,0,0,1];
  const H=multiplyH(fit.H,Hm);
  const s=scoreLattice(H,pts,tolerance);
  return s.count>=fit.count*.9?{H,...s,shape:fit.shape}:fit;
}
// Sample an image intensity around a board-plane location; null if outside.
function cellValue(H,gray,width,height,c,r){
  const values=[];
  for(const [du,dv] of [[.22,.22],[.78,.22],[.22,.78],[.78,.78],[.5,.5]]){
    const p=applyH(H,c+du,r+dv);
    const x=Math.round(p.x),y=Math.round(p.y);
    if(!(p.z>0)||x<1||y<1||x>=width-1||y>=height-1)continue;
    let s=0;
    for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++)s+=gray[(y+yy)*width+x+xx];
    values.push(s/9);
  }
  if(values.length<3)return null;
  values.sort((a,b)=>a-b);
  return values[values.length>>1];
}
// Board placement along the lattice: board squares span [bx,bx+8]x[by,by+8]
// in lattice units. The x-corner model also fires on the outer border
// intersections, so detections may lie ON the board edge (index 0 or 8).
// `pieces` are detected piece boxes {cx,cy,w,h,confidence}: every real piece
// stands on the board, which disambiguates the offset when the outer ranks
// are covered by pieces (e.g. the starting position).
export function locateBoard(fit,{gray,width,height,pieces=[],position=null}={}){
  const point=(u,v)=>{const q=applyH(fit.H,u,v);return {x:q.x,y:q.y};};
  const feet=[];
  for(const box of pieces){
    if(!Number.isFinite(box.w))continue;
    const f=pieceFoot(box,point),g=imageToBoard(point,f.x,f.y);
    if(g&&Math.abs(g.u)<20&&Math.abs(g.v)<20)
      feet.push({x:g.u,y:g.v,w:box.confidence??1,cls:box.className});
  }
  const is=fit.members.map(m=>m.i),js=fit.members.map(m=>m.j);
  const minI=Math.min(...is),maxI=Math.max(...is),minJ=Math.min(...js),maxJ=Math.max(...js);
  const xs=[],ys=[];
  // Windows that contain every lattice member; if spurious off-board
  // detections widen the lattice beyond 9 lines, slide over all windows and
  // penalise excluded members instead.
  const range=(lo,hi)=>{const r=[];for(let k=Math.min(lo,hi);k<=Math.max(lo,hi);k++)r.push(k);return r;};
  xs.push(...range(maxI-8,minI));ys.push(...range(maxJ-8,minJ));
  if(maxI-minI>12||maxJ-minJ>12)return null;
  const cache=new Map();
  const value=(c,r)=>{
    const key=c+','+r;
    if(!cache.has(key))cache.set(key,gray?cellValue(fit.H,gray,width,height,c,r):null);
    return cache.get(key);
  };
  const candidates=[];
  for(const bx of xs)for(const by of ys){
    let inside=0,insideN=0,ring=0,ringN=0;
    for(let c=bx-1;c<=bx+8;c++)for(let r=by-1;r<=by+8;r++){
      const v=value(c,r);if(v===null)continue;
      for(const [dc,dr] of [[1,0],[0,1]]){
        const c2=c+dc,r2=r+dr;
        if(c2>bx+8||r2>by+8)continue;
        const w=value(c2,r2);if(w===null)continue;
        const inA=c>=bx&&c<bx+8&&r>=by&&r<by+8,inB=c2>=bx&&c2<bx+8&&r2>=by&&r2<by+8;
        const d=Math.abs(v-w);
        if(inA&&inB){inside+=d;insideN++;}
        else if(!inA&&!inB){ring+=d;ringN++;}
      }
    }
    // Mean checker contrast inside vs the frame ring (means, so a window is
    // not favoured just because more of it is visible), plus piece support.
    const contrast=insideN?inside/insideN:0,ringContrast=ringN>=4?ring/ringN:contrast*.5;
    let outside=0;
    for(const f of feet){
      const du=Math.max(bx-f.x,f.x-(bx+8),0),dv=Math.max(by-f.y,f.y-(by+8),0);
      if(du>.3||dv>.3)outside+=f.w;
    }
    const excluded=fit.members.filter(m=>m.i<bx||m.i>bx+8||m.j<by||m.j>by+8).length;
    const score=(contrast-ringContrast)/Math.max(8,contrast)-outside*.35-excluded*.08;
    candidates.push({bx,by,score,visualScore:score,insideN,ringN,contrast,ringContrast,outside});
  }
  candidates.sort((a,b)=>b.score-a.score);
  if(position)rescoreWithPosition(fit,candidates,feet,position);
  const top=candidates[0],second=candidates[1];
  const unique=candidates.length===1;
  const margin=unique?Infinity:top.score-second.score;
  return {...top,ambiguous:!unique&&(!gray||margin<.1),margin,candidates:candidates.length,
    span:{i:maxI-minI,j:maxJ-minJ}};
}
// The verified chess position (64 chars, rank 8 first, '1' = empty) is
// strong evidence for WHERE the board lies along the lattice and which way
// it faces: detected pieces must stand on occupied squares of the right
// colour. Without it, partial views whose outer ranks are off-screen are
// genuinely ambiguous (only checker texture is available).
const ROT=[ // lattice cell (c,r) inside the window -> board index for 4 rotations
  (c,r)=>r*8+c,(c,r)=>(7-r)*8+7-c,(c,r)=>(7-c)*8+r,(c,r)=>c*8+7-r];
const REFLECT=[(c,r)=>r*8+7-c,(c,r)=>(7-r)*8+c,(c,r)=>c*8+r,(c,r)=>(7-c)*8+7-r];
export function positionAgreement(cells,position,map){
  let s=0;
  for(const {c,r,cls,w} of cells){
    const t=position[map(c,r)];
    if(t==='1')s-=w;
    else if(t===cls)s+=w;
    else if((t===t.toUpperCase())===(cls===cls.toUpperCase()))s+=.6*w;
    else s-=.5*w;
  }
  return s;
}
function rescoreWithPosition(fit,candidates,feet,position){
  for(const cand of candidates){
    const cells=feet.filter(f=>f.cls&&f.x>=cand.bx&&f.y>=cand.by&&f.x<cand.bx+8&&f.y<cand.by+8)
      .map(f=>({c:Math.floor(f.x-cand.bx),r:Math.floor(f.y-cand.by),cls:f.cls,w:f.w}));
    // The lattice handedness is not known, so test reflections as well.
    let best=-Infinity,rot=0,mirror=false;
    [...ROT,...REFLECT].forEach((map,k)=>{
      const a=positionAgreement(cells,position,map);
      if(a>best){best=a;rot=k%4;mirror=k>=4;}
    });
    cand.positionScore=best;cand.rotation=rot;cand.mirror=mirror;
    cand.score=cand.visualScore+best*.25;
  }
  candidates.sort((a,b)=>b.score-a.score);
}
// Order image corners TL,TR,BR,BL (clockwise on screen, y down) as used by
// CameraVision.point(u,v). Returns the permutation index for each.
export function orderClockwise(corners){
  const cx=corners.reduce((s,p)=>s+p.x,0)/4,cy=corners.reduce((s,p)=>s+p.y,0)/4;
  const withAngle=corners.map((p,k)=>({p,k,a:Math.atan2(p.y-cy,p.x-cx)}));
  withAngle.sort((a,b)=>a.a-b.a); // increasing angle = clockwise when y points down
  let start=0;
  for(let k=1;k<4;k++)
    if(withAngle[k].p.x+withAngle[k].p.y<withAngle[start].p.x+withAngle[start].p.y)start=k;
  return [0,1,2,3].map(k=>withAngle[(start+k)%4]);
}
export function grayFromRgba(rgba,width,height){
  const gray=new Uint8Array(width*height);
  for(let i=0,j=0;i<gray.length;i++,j+=4)
    gray[i]=(rgba[j]*77+rgba[j+1]*150+rgba[j+2]*29)>>8;
  return gray;
}
// Complete detection: x-corners -> lattice -> 8x8 board homography.
// Returns {corners (TL,TR,BR,BL image points, may lie outside the frame),
// H (unit board (u,v) -> image), quality}.
export function detectBoardFromCorners(points,{gray,width,height,pieces=[],position=null,minInliers=12}={}){
  const fit=fitLatticeHomography(points);
  if(!fit||fit.count<minInliers)return {ok:false,reason:'lattice',inliers:fit?.count||0};
  const placed=locateBoard(fit,{gray,width,height,pieces,position});
  if(!placed)return {ok:false,reason:'lattice-too-wide',inliers:fit.count};
  const raw=[[0,0],[8,0],[8,8],[0,8]].map(([c,r])=>{
    const p=applyH(fit.H,placed.bx+c,placed.by+r);return {x:p.x,y:p.y,c,r};
  });
  if(raw.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return {ok:false,reason:'degenerate'};
  // Reject near-degenerate fits: the whole 9x9 grid must lie in front of the
  // camera, form a convex quad and keep plausible cell-size variation.
  const sizes=[];
  for(let r=0;r<8;r+=7)for(let c=0;c<8;c+=7){
    const a=applyH(fit.H,placed.bx+c,placed.by+r),b=applyH(fit.H,placed.bx+c+1,placed.by+r+1);
    if(!(a.z>0)||!(b.z>0))return {ok:false,reason:'behind-camera',inliers:fit.count};
    sizes.push(Math.hypot(b.x-a.x,b.y-a.y));
  }
  if(Math.max(...sizes)/Math.max(1e-6,Math.min(...sizes))>6)
    return {ok:false,reason:'degenerate-perspective',inliers:fit.count};
  let sign=0;
  for(let k=0;k<4;k++){
    const p=raw[k],q=raw[(k+1)%4],t=raw[(k+2)%4];
    const cross=(q.x-p.x)*(t.y-q.y)-(q.y-p.y)*(t.x-q.x);
    if(sign&&cross*sign<=0)return {ok:false,reason:'non-convex',inliers:fit.count};
    sign=cross;
  }
  const ordered=orderClockwise(raw);
  const corners=ordered.map(o=>({x:o.p.x,y:o.p.y}));
  // Unit-square homography in the corner order the rest of the app uses.
  const H=solveHomography([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],corners);
  const residual=fit.members.reduce((s,m)=>s+m.err,0)/fit.members.length;
  return {ok:true,corners,H,latticeH:fit.H,
    quality:{inliers:fit.count,detections:points.length,residual,
      span:placed.span,ambiguous:placed.ambiguous,margin:placed.margin,
      contrast:placed.contrast,ringContrast:placed.ringContrast,
      positionScore:placed.positionScore??null,usedPosition:!!position}};
}
export {multiplyH};
