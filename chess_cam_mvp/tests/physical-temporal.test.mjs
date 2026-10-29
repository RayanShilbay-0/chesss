import test from 'node:test';
import assert from 'node:assert/strict';
import {Chess} from 'chess.js';
import {SquareEvidence,inferPhysicalMoves,observedSquares} from '../src/physical-evidence.js';

const SQ=s=>(8-Number(s[1]))*8+'abcdefgh'.indexOf(s[0]); // board index, rank 8 first
const tileOf=i=>(7-Math.floor(i/8))*8+i%8;                // inverse of tileToBoardIndex(...,'w')
const chars=g=>g.board().flat().map(p=>p?(p.color==='w'?p.type.toUpperCase():p.type):'1');
// Sparse, realistic observation: only `keep` of the occupied squares are seen.
function observe(position,{keep=.6,seed=1,extra=[]}={}){
  let x=seed;const rnd=()=>(x=(x*16807)%2147483647)/2147483647;
  const dets=[];
  position.forEach((p,i)=>{if(p!=='1'&&rnd()<keep)dets.push({tile:tileOf(i),className:p,confidence:.7+.25*rnd()});});
  return dets.concat(extra.map(([sq,cls,c])=>({tile:tileOf(SQ(sq)),className:cls,confidence:c})));
}
function scan(evidence,game,dets,visible=new Set([...Array(64).keys()])){
  evidence.add(game.fen(),observedSquares(dets,'w'),visible);
  const snap=evidence.snapshot();
  return inferPhysicalMoves(game,[],{observed:snap.seen,empty:snap.empty});
}
function after(game,move){const g=new Chess(game.fen());g.move(move);return chars(g);}

test('consecutive white and black moves keep being recognized',()=>{
  const game=new Chess(),ev=new SquareEvidence();
  const moves=['e4','e5','Nf3','Nc6','Bb5','a6'];
  moves.forEach((san,k)=>{
    const target=after(game,san),probe=new Chess(game.fen()),mv=probe.move(san);
    let result;
    // The moved piece is in view; everything else is sparsely detected.
    for(let s=0;s<3;s++)result=scan(ev,game,observe(target.map((p,i)=>i===SQ(mv.to)?'1':p),
      {seed:10+k*7+s,extra:s?[[mv.to,target[SQ(mv.to)],.8]]:[]}));
    assert.equal(result.kind,'move',`move ${k+1} (${san}) not recognized: ${result.reason}`);
    const played=game.move({from:result.sequence[0].from,to:result.sequence[0].to,promotion:result.sequence[0].promotion});
    assert.equal(played.san,san);
  });
  assert.equal(game.history().length,6);
});

test('camera motion without any chess move never yields a move',()=>{
  const game=new Chess(),ev=new SquareEvidence();
  game.move('e4');game.move('c5');
  for(let s=0;s<40;s++){
    // Different subsets of pieces visible each frame (pan / zoom / partial view).
    const visible=new Set([...Array(64).keys()].filter(i=>((i+s)%8)<5));
    const position=chars(game).map((p,i)=>visible.has(i)?p:'1');
    const r=scan(ev,game,observe(position,{keep:.7,seed:s+3}),visible);
    assert.notEqual(r.kind,'move',`phantom move at scan ${s}: ${r.key}`);
  }
});

test('a single-frame misdetection decays instead of becoming a move',()=>{
  const game=new Chess(),ev=new SquareEvidence();
  const base=chars(game);
  scan(ev,game,observe(base,{seed:5,extra:[['e3','P',.6]]}));
  let r;
  for(let s=0;s<3;s++)r=scan(ev,game,observe(base,{seed:20+s}));
  assert.notEqual(r.kind,'move');
});

test('missing detections are not empty squares',()=>{
  const game=new Chess(),ev=new SquareEvidence();
  // Only black pieces seen for many scans (white half out of view).
  const visible=new Set([...Array(32).keys()]);
  let r;
  for(let s=0;s<6;s++)r=scan(ev,game,observe(chars(game).map((p,i)=>i<32?p:'1'),{seed:s}),visible);
  assert.equal(r.kind,'unchanged');
});

test('vacated source square evidence supports the real move over a rival',()=>{
  const game=new Chess();game.move('e4');game.move('e5');
  const ev=new SquareEvidence();
  // Knight appears on f3; g1 visibly empty for several scans.
  const target=after(game,'Nf3');
  let r;
  for(let s=0;s<3;s++)r=scan(ev,game,observe(target,{keep:.8,seed:40+s}));
  assert.equal(r.kind,'move');
  assert.equal(r.key,'g1f3');
});

import {OcclusionGuard,OrientationLock} from '../src/physical-evidence.js';
test('occlusion guard compares with recent counts for this view, not the full position',()=>{
  const g=new OcclusionGuard();
  for(const n of [14,15,13,14])assert.equal(g.update(n).occluded,false); // recall ~45% is normal
  assert.equal(g.update(5).occluded,true);   // a hand hides most of them
  assert.equal(g.update(14).occluded,false);
});
test('orientation lock ignores weak contrary votes but follows strong sustained ones',()=>{
  const l=new OrientationLock();
  l.update({verified:true,side:'w',margin:9});
  for(let k=0;k<6;k++)assert.equal(l.update({verified:true,side:'b',margin:2}),'w');
  for(let k=0;k<3;k++)l.update({verified:true,side:'l',margin:6});
  assert.equal(l.update({verified:true,side:'l',margin:6}),'l');
});

test('occlusion guard resets its baseline when zooming to a partial board',()=>{
 const g=new OcclusionGuard();
 for(const n of [18,19,18,17])assert.equal(g.update(n,1).occluded,false);
 assert.equal(g.update(8,.48).occluded,false);
 for(const n of [8,7,8,9])assert.equal(g.update(n,.48).occluded,false);
 assert.equal(g.update(3,.48).occluded,true,'a hand still obstructs a stable view');
 assert.equal(g.update(8,.48).occluded,false,'hand removal restores tracking');
});
test('occlusion guard recovers after sustained stable lower model recall',()=>{
 const g=new OcclusionGuard({rebaseAfter:5});
 for(const n of [18,18,17,19])g.update(n);
 for(let i=0;i<4;i++)assert.equal(g.update(7).occluded,true);
 assert.equal(g.update(7).occluded,false,'a sustained changed view must not block forever');
 assert.equal(g.update(8).occluded,false);
});
test('white moves remain recognized when LeYOLO consistently mistakes white pawn for bishop',()=>{
 const game=new Chess(),ev=new SquareEvidence();
 const det=(square,type,confidence=.93)=>{
  const i=SQ(square);return {tile:tileOf(i),className:type,confidence};
 };
 let result;
 for(let i=0;i<4;i++){
   const obs=observedSquares([det('e4',i%2?'B':'P'),det('d2','P'),det('e7','p')],'w');
   ev.add(game.fen(),obs,new Set([...Array(64).keys()]));
   const snap=ev.snapshot();
   result=inferPhysicalMoves(game,[],{observed:snap.seen,empty:snap.empty});
 }
 assert.equal(result.kind,'move',JSON.stringify(result));
 assert.equal(result.key,'e2e4');
 assert.equal(result.typeRelaxed,true);
 assert(result.confidence>=.55);
});
test('wrong piece type on stationary white piece never creates phantom move',()=>{
 const game=new Chess(),ev=new SquareEvidence(),idx=SQ('d2');
 const wrong=new Map([[idx,{type:'B',confidence:.98}]]);
 for(let i=0;i<4;i++){
   ev.add(game.fen(),wrong,new Set([...Array(64).keys()]));
   const snap=ev.snapshot();
   const result=inferPhysicalMoves(game,[],{observed:snap.seen,empty:snap.empty});
   assert.equal(result.kind,'unchanged');
 }
});
