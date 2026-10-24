import test from 'node:test';
import assert from 'node:assert/strict';
import {Chess} from 'chess.js';
import {recognizeSequence} from '../src/detector.js';
const idx=s=>(8-Number(s[1]))*8+'abcdefgh'.indexOf(s[0]);
const frame=changed=>{const a=Array(64).fill(2);for(const x of changed)a[idx(x)]=48;return a;};
test('one pawn move',()=>{
 const r=recognizeSequence(new Chess(),frame(['e2','e4']),8);
 assert(r.credible,JSON.stringify(r));assert.deepEqual(r.top.sequence.map(x=>x.from+x.to),['e2e4']);
});
test('two fast consecutive moves against a bot',()=>{
 const r=recognizeSequence(new Chess(),frame(['e2','e4','e7','e6']),8);
 assert(r.credible,JSON.stringify(r));assert.deepEqual(r.top.sequence.map(x=>x.from+x.to),['e2e4','e7e6']);
});
test('unchanged image does not invent a move',()=>{
 assert.equal(recognizeSequence(new Chess(),frame([]),8).credible,false);
});
test('large camera changes are rejected',()=>{
 const x=Array.from({length:20},(_,i)=>'abcdefgh'[i%8]+(8-Math.floor(i/8)));
 assert.equal(recognizeSequence(new Chess(),frame(x),8).reason,'many-changes');
});
test('multiple unrelated changed squares are rejected',()=>{
 assert.equal(recognizeSequence(new Chess(),frame(['e2','e4','a5','h5']),8).credible,false);
});
test('continues from an already-synchronized digital position',()=>{
 const g=new Chess();g.move('e4');
 const r=recognizeSequence(g,frame(['e7','e6']),8);
 assert(r.credible,JSON.stringify(r));assert.equal(r.top.sequence[0].san,'e6');
});

import { CameraVision } from '../src/vision.js';
const samples=(value=90)=>Array.from({length:64},()=>Array.from({length:49},()=>[value,value,value]));
test('uniform board-highlight color changes are de-emphasized',()=>{
 const a=samples(),b=samples();
 for(const i of [12,36])for(const pixel of b[i])for(let k=0;k<3;k++)pixel[k]+=30;
 const scores=CameraVision.prototype.difference.call({},a,b);
 assert(scores[12]<8,'highlight 12 score '+scores[12]);
 assert(scores[36]<8,'highlight 36 score '+scores[36]);
});
test('moving piece textures still produce a strong square signal',()=>{
 const a=samples(),b=samples();
 for(const i of [36,52])for(let j=10;j<39;j++)
  if(j%7>=1 && j%7<=5)b[i][j]=[20,22,25];
 const scores=CameraVision.prototype.difference.call({},a,b);
 assert(scores[36]>8,'piece 36 score '+scores[36]);
 assert(scores[52]>8,'piece 52 score '+scores[52]);
});

test('recognizes a black bot move despite weak raw pixel differences using piece occupancy',()=>{
 const g=new Chess();g.move('e4');
 const start=g.board().flat().map(Boolean);
 const after=new Chess(g.fen());after.move('e6');
 const newOcc=after.board().flat().map(Boolean);
 const values=newOcc.map(on=>on?40:0);
 const scores=Array(64).fill(2);
 const r=recognizeSequence(g,scores,9,{
   occupancy:{reliable:true,current:values,threshold:20,guard:3}
 });
 assert(r.credible,JSON.stringify(r));
 assert.equal(r.top.sequence[0].san,'e6');
});
test('recognizes two moves with faint visual differences, for both white and black',()=>{
 const g=new Chess(),after=new Chess();
 after.move('e4');after.move('e6');
 const current=after.board().flat().map(on=>Boolean(on)?40:0);
 const r=recognizeSequence(g,Array(64).fill(2),9,{
   occupancy:{reliable:true,current,threshold:20,guard:3}
 });
 assert(r.credible,JSON.stringify(r));
 assert.deepEqual(r.top.sequence.map(m=>m.san),['e4','e6']);
});
test('no movement is not misclassified as a valid move',()=>{
 const g=new Chess();
 const current=g.board().flat().map(on=>Boolean(on)?40:0);
 const r=recognizeSequence(g,Array(64).fill(2),9,{
   occupancy:{reliable:true,current,threshold:20,guard:3}
 });
 assert.equal(r.credible,false);
});
test('visual classifier separates occupied and empty squares on digital chessboard samples',()=>{
 const g=new Chess();
 const texture=g.board().flat().map((piece,i)=>{
   const light=((Math.floor(i/8)+i%8)%2)===0;
   const bg=light?[236,236,207]:[118,148,87];
   const result=[];
   for(let j=0;j<49;j++){
     const row=Math.floor(j/7),col=j%7;
     const body=piece&&row>=1&&row<=5&&col>=2&&col<=4;
     const edge=body&&(col===2||col===4||row===1);
     result.push(body?(piece.color==='b'?[36,37,37]:(edge?[42,46,45]:[250,250,248])):[...bg]);
   }
   for(let k=0;k<8;k++)result.push([...bg]);
   return result;
 });
 const scan={occupancyScores:CameraVision.prototype.occupancyScores};
 const model=CameraVision.prototype.modelFor.call(scan,texture,g);
 assert(model.reliable,JSON.stringify(model));
 assert(model.baselineMismatch<=2,JSON.stringify(model));
});

import { shouldRefreshBaseline } from '../src/tracking-policy.js';
const eligible=(changes={})=>({
  ageMs:4000,stableFrames:3,pending:false,credible:false,inMotion:false,
  changed:5,reliable:true,mismatches:0,confident:60,nearlyIdentical:false,
  ...changes
});
test('safe periodic refresh only when board occupancy still matches',()=>{
 assert(shouldRefreshBaseline(eligible()).ok);
 assert(!shouldRefreshBaseline(eligible({mismatches:2})).ok);
 assert(!shouldRefreshBaseline(eligible({changed:14})).ok);
 assert(!shouldRefreshBaseline(eligible({reliable:false,changed:5})).ok);
});
test('do not swallow a moving opponent piece or a pending recognized move',()=>{
 assert(!shouldRefreshBaseline(eligible({inMotion:true})).ok);
 assert(!shouldRefreshBaseline(eligible({stableFrames:1})).ok);
 assert(!shouldRefreshBaseline(eligible({pending:true})).ok);
 assert(!shouldRefreshBaseline(eligible({credible:true})).ok);
 assert(!shouldRefreshBaseline(eligible({ageMs:900})).ok);
});
test('when occupancy unavailable allow only virtually identical noise',()=>{
 assert(shouldRefreshBaseline(eligible({reliable:false,changed:0,nearlyIdentical:true})).ok);
 assert(!shouldRefreshBaseline(eligible({reliable:false,changed:1,nearlyIdentical:true})).ok);
});
test('recognized moves use last analyzed frame for reference, preserving later bot replies',()=>{
 const cam=Object.create(CameraVision.prototype);
 cam.stream={};cam.corners=[{},{},{},{}];cam.calibrating=false;
 const old=Array.from({length:64},()=>[]);
 const recognized=Array.from({length:64},()=>[[5,5,5]]);
 cam.latestFeatures=recognized;cam.occupancyModel=null;cam.frame=()=>{throw Error('should not capture a new bot reply frame');};
 cam.features=()=>{throw Error('should not re-extract a live bot reply frame');};
 cam.modelFor=()=>({reliable:false,baselineMismatch:0});
 const r=cam.syncReference(new Chess());
 assert.equal(r.ok,true);
 assert.equal(cam.reference,recognized);
 assert.equal(cam.lastScan,recognized);
 assert.notEqual(cam.reference,old);
});

test('ignores stale opponent highlighting when detecting the next white knight move',()=>{
 const g=new Chess();
 g.move('e4');g.move('e6');
 const following=new Chess(g.fen());following.move('Nf3');
 // The previous e7/e6 highlighted squares also change their visual colors,
 // but the pawns on those squares did not move again.
 const scores=frame(['g1','f3']);
 scores[idx('e7')]=17;scores[idx('e6')]=17;
 const current=following.board().flat().map(x=>Boolean(x)?40:0);
 const found=recognizeSequence(g,scores,7,{
   occupancy:{reliable:true,current,threshold:20,guard:3}
 });
 assert(found.credible,JSON.stringify(found));
 assert.deepEqual(found.top.sequence.map(m=>m.san),['Nf3']);
});
test('ignores old highlights while tracking a black knight after white moved',()=>{
 const g=new Chess();
 for(const san of ['e4','e6','Nf3'])g.move(san);
 const following=new Chess(g.fen());following.move('Nf6');
 const scores=frame(['g8','f6']);
 for(const sq of ['g1','f3'])scores[idx(sq)]=16;
 const current=following.board().flat().map(x=>Boolean(x)?40:0);
 const found=recognizeSequence(g,scores,7,{
   occupancy:{reliable:true,current,threshold:20,guard:3}
 });
 assert(found.credible,JSON.stringify(found));
 assert.deepEqual(found.top.sequence.map(m=>m.san),['Nf6']);
});

test('single-ply camera tracking remains fast over repeated middle-game scans',()=>{
 const game=new Chess();
 for(const san of ['e4','e5','Nf3','Nc6','Bc4','Bc5','d3','Nf6','Nc3','d6'])game.move(san);
 const next=game.moves({verbose:true})[0];
 const s=frame([next.from,next.to]);
 const start=performance.now();
 for(let i=0;i<20;i++){
   const found=recognizeSequence(game,s,9);
   assert(found.credible,JSON.stringify(found));
 }
 const elapsed=performance.now()-start;
 assert(elapsed<3000,'20 single-move scans took '+elapsed.toFixed(0)+'ms');
});
