// Real-video board tracking benchmark: new BoardMemory vs shipped
// MovingBoardTracker, both driven by the app's OpenCV.js build.
// usage: node tools/bench/track-video.mjs <dump_dir> [--perturb] [--out report.json]
//   dump_dir: output of tools/bench/dump_video.py (private, outside repo)
//   --perturb: adds synthetic stress: 20 blank frames (board lost), a 2x
//              digital zoom segment (partial board) and a 90-degree rotation
//              segment, to test loss/relocalization on the same footage.
import {readFile,open,writeFile} from 'node:fs/promises';
import cvModule from '@techstark/opencv-js';
import {BoardMemory} from '../../src/board-memory.js';
import {MovingBoardTracker} from '../../src/moving-board-tracker.js';
import {detectBoardFromCorners} from '../../src/board-lattice.js';
import {applyH,boardToImageH,invertH} from '../../src/homography.js';

const args=process.argv.slice(2);
const dir=args.find(a=>!a.startsWith('--'));
const perturb=args.includes('--perturb');
const noVerify=args.includes('--no-verify');
const outPath=args.includes('--out')?args[args.indexOf('--out')+1]:null;
const cv=await (cvModule.then?cvModule:new Promise(r=>{cvModule.onRuntimeInitialized=()=>r(cvModule)}));
const meta=JSON.parse(await readFile(dir+'/detections.json','utf8'));
const W=meta.width,Hh=meta.height,N=meta.frames.length;
const START=('rnbqkbnr'+'pppppppp'+'1'.repeat(32)+'PPPPPPPP'+'RNBQKBNR').split('');
const fh=await open(dir+'/gray.raw');

// Synthetic stress transforms (applied identically to pixels and detections).
const zoom=(i)=>perturb&&i>=300&&i<340;           // 2x zoom on the centre
const blank=(i)=>perturb&&i>=200&&i<220;          // board/camera lost
const rot=(i)=>perturb&&i>=360&&i<420;            // 90 deg image rotation (square crop)
function transformFor(i){
  if(zoom(i)){const s=2,cx=W/2,cy=Hh/2;return [s,0,cx-s*cx,0,s,cy-s*cy,0,0,1];}
  if(rot(i)){const cx=W/2,cy=Hh/2;return [0,-1,cx+cy,1,0,cy-cx,0,0,1];}
  return [1,0,0,0,1,0,0,0,1];
}
async function frameGray(i){
  const buf=Buffer.alloc(W*Hh);
  await fh.read(buf,0,W*Hh,i*W*Hh);
  const src=new Uint8Array(buf.buffer,buf.byteOffset,W*Hh);
  if(blank(i))return new Uint8Array(W*Hh).fill(18);
  const T=transformFor(i);
  if(T[0]===1&&T[1]===0&&T[2]===0&&T[5]===0)return src;
  const inv=invertH(T),out=new Uint8Array(W*Hh);
  for(let y=0;y<Hh;y++)for(let x=0;x<W;x++){
    const p=applyH(inv,x,y),xx=Math.round(p.x),yy=Math.round(p.y);
    out[y*W+x]=xx>=0&&yy>=0&&xx<W&&yy<Hh?src[yy*W+xx]:0;
  }
  return out;
}
const mapPts=(T,pts)=>pts.map(p=>({...p,...(({x,y})=>({x,y}))(applyH(T,p.x,p.y))}));
function mapBox(T,b){const p=applyH(T,b.cx,b.cy);const s=Math.sqrt(Math.abs(T[0]*T[4]-T[1]*T[3]));
  const r=Math.abs(T[1])>.5;return {...b,cx:p.x,cy:p.y,w:(r?b.h:b.w)*s,h:(r?b.w:b.h)*s};}

// Reference pose per frame: independent lattice detection + start position.
function reference(i,gray){
  if(blank(i))return null;
  const f=meta.frames[i],T=transformFor(i);
  const inside=p=>p.x>=0&&p.y>=0&&p.x<W&&p.y<Hh;
  const pts=mapPts(T,f.xcorners.map(p=>({x:p.x,y:p.y,confidence:p.conf}))).filter(inside);
  const res=detectBoardFromCorners(pts,{gray,width:W,height:Hh,
    pieces:f.pieces.map(b=>mapBox(T,b)),position:START,minInliers:14});
  return res.ok&&res.quality.inliers>=25&&!res.quality.ambiguous?res:null;
}
// The 8 symmetries of the unit board: p -> centre + R (p - centre).
const D4=[[1,0,0,1],[0,-1,1,0],[-1,0,0,-1],[0,1,-1,0],[1,0,0,-1],[-1,0,0,1],[0,1,1,0],[0,-1,-1,0]];
const sym=D4.map(([a,b,c,d])=>[a,b,.5-.5*a-.5*b,c,d,.5-.5*c-.5*d,0,0,1]);
function poseError(H,ref){
  let best=Infinity;
  for(const S of sym){
    let e=0,n=0;
    for(let r=1;r<8;r++)for(let c=1;c<8;c++){
      const q=applyH(ref.H,c/8,r/8);
      if(q.x<0||q.y<0||q.x>=W||q.y>=Hh)continue;
      const s=applyH(S,c/8,r/8),p=applyH(H,s.x,s.y);
      // square size around this point in the reference
      const q2=applyH(ref.H,c/8+1/8,r/8),q3=applyH(ref.H,c/8,r/8+1/8);
      const sq=Math.sqrt(Math.abs((q2.x-q.x)*(q3.y-q.y)-(q2.y-q.y)*(q3.x-q.x)));
      e+=Math.hypot(p.x-q.x,p.y-q.y)/sq;n++;
    }
    if(n>=6)best=Math.min(best,e/n);
  }
  return best;
}
const quantile=(a,q)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(q*(s.length-1)+.5))];};

// --- run ---
let init=null;
for(let i=0;i<N&&!init;i++){const g=await frameGray(i);const r=reference(i,g);if(r&&!r.quality.ambiguous)init={i,r,g};}
if(!init)throw Error('no acquisition frame');
const memory=new BoardMemory(cv);
memory.acquire({gray:init.g,width:W,height:Hh},init.r.H);
const camera={corners:init.r.corners.map(p=>({...p})),calibrating:false,drawOverlay(){},
  point(u,v){const H=boardToImageH(this.corners);const p=applyH(H,u,v);return {x:p.x,y:p.y};}};
const legacy=new MovingBoardTracker(camera);legacy.cv=cv;legacy.active=true;legacy.reset();
legacy.lastTime=0;
const rows=[],stats={memory:{valid:0,err:[],wrong:0,ms:[]},legacy:{valid:0,err:[],wrong:0,ms:[]},refs:0};
for(let i=init.i+1;i<N;i++){
  const gray=await frameGray(i);
  let t=performance.now();
  const m=memory.track({gray,width:W,height:Hh});
  stats.memory.ms.push(performance.now()-t);
  const rgba=new Uint8ClampedArray(W*Hh*4);
  for(let k=0;k<W*Hh;k++){rgba[4*k]=rgba[4*k+1]=rgba[4*k+2]=gray[k];rgba[4*k+3]=255;}
  t=performance.now();
  // The app calls observe() every ~180 ms; emulate that cadence (every 5th frame at 30 fps).
  let l={state:legacy.state};
  if(i%5===0){legacy.busy=false;l=legacy.observe({data:rgba,width:W,height:Hh});}
  stats.legacy.ms.push(performance.now()-t);
  const legacyValid=l.state==='tracking';
  const ref=reference(i,gray);
  const row={i,H:m.poseValid?m.H:null,refH:ref?ref.H:null,memory:m.state,inliers:m.inliers,visible:+m.visible.toFixed(2),legacy:l.state,ref:!!ref};
  if(m.poseValid)stats.memory.valid++;
  if(legacyValid)stats.legacy.valid++;
  if(ref){
    stats.refs++;
    if(m.poseValid&&!noVerify)row.verify=memory.observeBoardDetection(ref.H);
    if(m.poseValid){const e=poseError(m.H,ref);row.memErr=+e.toFixed(3);stats.memory.err.push(e);if(e>.5)stats.memory.wrong++;}
    if(legacyValid){const e=poseError(boardToImageH(camera.corners),ref);row.legErr=+e.toFixed(3);stats.legacy.err.push(e);if(e>.5)stats.legacy.wrong++;}
  }
  rows.push(row);
}
const frames=N-init.i-1;
const summary=name=>{const s=stats[name];return {
  valid_pose_frames:s.valid,valid_pose_rate:+(s.valid/frames).toFixed(3),
  ref_frames_scored:s.err.length,
  err_squares_median:quantile(s.err,.5),err_p90:quantile(s.err,.9),err_p95:quantile(s.err,.95),
  confidently_wrong_frames_gt_half_square:s.wrong,
  ms_median:quantile(s.ms,.5),ms_p90:quantile(s.ms,.9),ms_p95:quantile(s.ms,.95)};};
const report={video:{width:W,height:Hh,frames:N,acquired_at:init.i,acquireH:init.r.H,perturb},
  reference_frames:stats.refs,memory:summary('memory'),legacy:summary('legacy'),
  keyframes:memory.keyframes.length,corrections:memory.corrections||0,verify:!noVerify,
  segments:perturb?{blank:'200-219',zoom2x:'300-339',rot90:'360-419'}:null};
console.log(JSON.stringify(report,null,1));
if(outPath)await writeFile(outPath,JSON.stringify({report,rows},null,1));
await fh.close();
