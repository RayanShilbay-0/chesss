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
