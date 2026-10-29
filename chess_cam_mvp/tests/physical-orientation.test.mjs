import test from 'node:test';
import assert from 'node:assert/strict';
import {tileToBoardIndex,visualSquare,physicalOrientation,retainMappedOrientation} from '../src/physical-orientation.js';
import {OrientationLock} from '../src/physical-evidence.js';
const tile=(r,c)=>(7-r)*8+c;
for(const [side,r,c] of [
 ['w',7,0],['b',0,7],['l',0,0],['r',7,7]
]){
 test('a1 must map correctly when white is '+side,()=>{
  assert.equal(tileToBoardIndex(tile(r,c),side),56);
  assert.deepEqual(visualSquare('a',1,side),{r,c});
 });
}
test('physical camera recognizes white on the left after 90 degree rotation',()=>{
 const det=[];
 for(let row=0;row<8;row++){
  for(const [col,type] of [[0,'P'],[7,'p']]){
    det.push({tile:tile(row,col),className:type,confidence:.94});
  }
 }
 const side=physicalOrientation(det);
 assert.equal(side.side,'l',JSON.stringify(side));
});
test('black bottom remains different from player color and white top',()=>{
 const det=[];
 for(let c=0;c<8;c++){
  det.push({tile:tile(0,c),className:'P',confidence:.8});
  det.push({tile:tile(7,c),className:'p',confidence:.8});
 }
 assert.equal(physicalOrientation(det).side,'b');
});

test('stable mapped chessboard must not flip side even after 20 contrary white/black votes',()=>{
 const lock=new OrientationLock();
 lock.update({side:'w',verified:true,margin:9});
 let side='w';
 for(let i=0;i<20;i++){
   side=retainMappedOrientation(side,{side:'b',verified:true,margin:14},lock);
   assert.equal(side,'w');
 }
});
test('new board acquisition may choose orientation after previous map was discarded',()=>{
 const lock=new OrientationLock();
 assert.equal(retainMappedOrientation(null,{side:'b',verified:true,margin:9},lock),'b');
});
