// Replays the app's physical recognition logic over real video scans:
// board pose from track-video.mjs, piece boxes from crop_pieces.py.
// The user's video contains NO chess moves: every accepted move is a phantom.
// usage: node tools/bench/recognize-video.mjs <crop_pieces.json> [--fen <fen>]
import {readFile} from 'node:fs/promises';
import {Chess} from 'chess.js';
import {mapPhysicalDetections} from '../../src/physical-geometry.js';
import {orientationFromPosition,tileToBoardIndex} from '../../src/physical-orientation.js';
import {SquareEvidence,inferPhysicalMoves,observedSquares,OcclusionGuard,OrientationLock} from '../../src/physical-evidence.js';
import {applyH} from '../../src/homography.js';
import {profileSettings} from '../../src/vision-speed.js';
const scans=JSON.parse(await readFile(process.argv[2],'utf8'));
const game=new Chess();
const chars=game.board().flat().map(p=>p?(p.color==='w'?p.type.toUpperCase():p.type):'1');
const ev=new SquareEvidence();
const tally={scans:0,move:0,uncertain:0,unchanged:0,unreliable:0,occluded:0,accepted:0,
  mapped:0,occupied:0,color:0,exact:0,orientation:{}};
let side=null,candidate='',agreement=0;const guard=new OcclusionGuard(),lock=new OrientationLock();const settings=profileSettings('balanced');
for(const s of scans){
  tally.scans++;
  const point=(u,v)=>{const q=applyH(s.H,u,v);return {x:q.x,y:q.y};};
  const mapped=mapPhysicalDetections(s.pieces,point);
  if(mapped.count<7||mapped.count>35){tally.unreliable++;continue;}
  const vote=orientationFromPosition(mapped.detections,chars);
  side=lock.update(vote);
  if(!side){tally.unreliable++;continue;}
  tally.orientation[side]=(tally.orientation[side]||0)+1;
  for(const d of mapped.detections){
    const t=chars[tileToBoardIndex(d.tile,side)];tally.mapped++;
    if(t!=='1'){tally.occupied++;if((t===t.toUpperCase())===(d.className===d.className.toUpperCase()))tally.color++;if(t===d.className)tally.exact++;}
  }
  const visible=new Set();
  for(let tile=0;tile<64;tile++){
    const r=7-Math.floor(tile/8),c=tile%8,p=point((c+.5)/8,(r+.5)/8);
    if(p.x>s.width*.03&&p.y>s.height*.03&&p.x<s.width*.97&&p.y<s.height*.97)visible.add(tileToBoardIndex(tile,side));
  }
  const occluded=guard.update(mapped.count).occluded;
  ev.add(game.fen(),observedSquares(mapped.detections,side),occluded?new Set():visible);
  const snap=ev.snapshot();
  const r=occluded?{kind:'occluded'}:inferPhysicalMoves(game,[],{observed:snap.seen,empty:snap.empty});
  tally[r.kind]=(tally[r.kind]||0)+1;
  if(r.kind==='move'){
    if(r.key===candidate)agreement++;else{candidate=r.key;agreement=1;}
    if(r.confidence>=settings.confidence&&r.margin>=settings.margin&&agreement>=settings.agreement){
      tally.accepted++;console.log('PHANTOM accepted at frame',s.i,r.key);candidate='';agreement=0;
    }
  }else{candidate='';agreement=0;}
}
const pct=(a,b)=>b?(100*a/b).toFixed(1)+'%':'n/a';
console.log(JSON.stringify({...tally,square_occupancy_precision:pct(tally.occupied,tally.mapped),
  color_precision:pct(tally.color,tally.mapped),exact_piece_precision:pct(tally.exact,tally.mapped)},null,1));
