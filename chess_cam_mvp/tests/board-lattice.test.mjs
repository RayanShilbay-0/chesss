import test from 'node:test';
import assert from 'node:assert/strict';
import {solveHomography,applyH,invertH,boardToImageH} from '../src/homography.js';
import {detectBoardFromCorners,fitLatticeHomography} from '../src/board-lattice.js';
import {decodeYolo,pieceFoot,mapPhysicalDetections,nmsBoxes} from '../src/physical-geometry.js';

// A tilted board: unit board (u,v) -> image through a perspective homography.
const CORNERS=[{x:300,y:180},{x:900,y:200},{x:1080,y:640},{x:150,y:610}];
const Hb=boardToImageH(CORNERS);
const board=(u,v)=>{const p=applyH(Hb,u,v);return {x:p.x,y:p.y};};
function render(width=1280,height=760){
  const gray=new Uint8Array(width*height).fill(40);
  const inv=invertH(Hb);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const g=applyH(inv,x,y);
    if(g.z<0)continue;
    if(g.x>=-.06&&g.x<=1.06&&g.y>=-.06&&g.y<=1.06){
      if(g.x<0||g.x>=1||g.y<0||g.y>=1){gray[y*width+x]=120;continue;} // plain frame
      const c=Math.floor(g.x*8),r=Math.floor(g.y*8);
      gray[y*width+x]=(c+r)%2?90:210;
    }
  }
  return {gray,width,height};
}
const internal=(skip=()=>false)=>{
  const pts=[];
  for(let r=1;r<8;r++)for(let c=1;c<8;c++)if(!skip(c,r))pts.push({...board(c/8,r/8),confidence:.8});
  return pts;
};
const close=(a,b,tol)=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<tol,JSON.stringify([a,b]));

test('homography round-trip from four and many points',()=>{
  const src=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1},{x:.5,y:.3}];
  const H=solveHomography(src,src.map(p=>board(p.x,p.y)));
  for(const p of src)close(applyH(H,p.x,p.y),board(p.x,p.y),1e-6);
});

test('full 7x7 lattice recovers the true outer board corners',()=>{
  const img=render();
  const res=detectBoardFromCorners(internal(),img);
  assert.equal(res.ok,true);
  res.corners.forEach((p,i)=>close(p,CORNERS[i],3));
});

test('missing x-corners no longer shrink the board (old extreme-point bug)',()=>{
  // Real LeYOLO output: whole outer ring of internal corners missing.
  const img=render();
  const pts=internal((c,r)=>c===1||c===7||r===1||r===7);
  const res=detectBoardFromCorners(pts,img);
  assert.equal(res.ok,true);
  res.corners.forEach((p,i)=>close(p,CORNERS[i],4));
});

test('spurious off-board detections do not break the lattice fit',()=>{
  const pts=[...internal(),{x:40,y:40,confidence:.9},{x:1200,y:700,confidence:.9},{x:640,y:20,confidence:.6}];
  const fit=fitLatticeHomography(pts);
  assert.ok(fit.count>=49);
});

test('known game position picks the board offset when edge ranks are hidden',()=>{
  // Only the four rows nearest the black pieces are detected; position
  // evidence (pieces on ranks 7-8) must decide where the board is.
  const pts=internal((c,r)=>r>4);
  const pieces=[];
  for(let c=0;c<8;c++)for(const [r,cls] of [[0,'rnbqkbnr'[c]],[1,'p']]){
    const f=board((c+.5)/8,(r+.5)/8);
    pieces.push({cx:f.x,cy:f.y-30,w:40,h:60,className:cls,confidence:.9});
  }
  const position=('rnbqkbnr'+'pppppppp'+'1'.repeat(32)+'PPPPPPPP'+'RNBQKBNR').split('');
  const res=detectBoardFromCorners(pts,{...render(),pieces,position});
  assert.equal(res.ok,true);
  res.corners.forEach((p,i)=>close(p,CORNERS[i],6));
});

test('NMS removes duplicate anchors before the detection cap',()=>{
  const boxes=[];
  for(let k=0;k<200;k++)boxes.push({cx:100+k%3,cy:100,w:30,h:60,confidence:.9-k*1e-4,className:'p'});
  boxes.push({cx:400,cy:100,w:30,h:60,confidence:.5,className:'P'});
  const kept=nmsBoxes(boxes);
  assert.equal(kept.length,2);
  // decodeYolo end to end: 300 duplicated anchors + one distinct piece.
  const n=301,raw=new Float32Array(16*n);
  for(let i=0;i<n;i++){
    raw[i]=i<300?100:400;raw[n+i]=100;raw[2*n+i]=30;raw[3*n+i]=60;
    raw[(4+(i<300?3:9))*n+i]=i<300?.9:.5;
  }
  const dets=decodeYolo(raw,[1,16,n]);
  assert.deepEqual(dets.map(d=>d.className).sort(),['P','p']);
});

test('piece foot accounts for board tilt',()=>{
  // From straight above, the box centre is the base centre.
  const top=(u,v)=>({x:u*800,y:v*800});
  const f=pieceFoot({cx:150,cy:150,w:100,h:100},top);
  assert.ok(Math.abs(f.y-150)<1e-6);
  // Strong tilt: the base centre is close to the bottom edge of the box.
  const tilted=(u,v)=>({x:u*800,y:v*200});
  const g=pieceFoot({cx:150,cy:150,w:100,h:160},tilted);
  assert.ok(g.y>215&&g.y<230,String(g.y));
  const mapped=mapPhysicalDetections([{cx:150,cy:90,w:100,h:160,confidence:.9,className:'k'}],tilted);
  assert.equal(mapped.count,1);
});
