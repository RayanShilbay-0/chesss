import test from 'node:test';
import assert from 'node:assert/strict';
import {Chess} from 'chess.js';
import {boardPoint,scoreChessboardQuad,expandQuadToPieces} from '../src/physical-calibration.js';
import {inferPhysicalMoves} from '../src/physical-evidence.js';
const full=[{x:110,y:60},{x:580,y:75},{x:625,y:550},{x:85,y:545}];
const clipped=[{x:110,y:60},{x:380,y:75},{x:410,y:440},{x:85,y:440}];
const grid=Array.from({length:49},(_,i)=>boardPoint(full,((i%7)+1)/8,(Math.floor(i/7)+1)/8));
const pieces=[0,1,6,7].flatMap(r=>Array.from({length:8},(_,c)=>({
 ...boardPoint(full,(c+.5)/8,(r+.5)/8),confidence:.88
})));
test('full 8x8 board is accepted',()=>assert(scoreChessboardQuad(full,grid,pieces).valid));
test('user-like 5-column calibration is rejected',()=>{
 const result=scoreChessboardQuad(clipped,grid,pieces);
 assert.equal(result.valid,false);assert(result.coverage<.8);
});
test('piece-based calibration expands partial board and recovers xcorners',()=>{
 const improved=expandQuadToPieces(clipped,pieces);
 assert(improved);assert(scoreChessboardQuad(improved,grid,pieces).valid);
});
function det(s,p,confidence=.93,side='w'){
 const row=8-Number(s[1]),col='abcdefgh'.indexOf(s[0]);
 return {tile:side==='w'?(7-row)*8+col:row*8+(7-col),
  className:p,confidence};
}
test('real pieces detect e4 even when 25 other pieces are occluded',()=>{
 const g=new Chess();
 const r=inferPhysicalMoves(g,[det('e4','P'),det('g1','N'),det('d2','P')]);
 assert.equal(r.kind,'move',JSON.stringify(r));assert.equal(r.key,'e2e4');
});
test('black-side physical image maps square coordinates correctly',()=>{
 const r=inferPhysicalMoves(new Chess(),[det('e4','P',.93,'b')],{whiteBottom:false});
 assert.equal(r.kind,'move');assert.equal(r.key,'e2e4');
});
test('no phantom moves when the detector misses pieces',()=>{
 const r=inferPhysicalMoves(new Chess(),[det('d2','P'),det('e2','P')]);
 assert.equal(r.kind,'unchanged');
});
test('two rapid chess moves detected from distinct new piece locations',()=>{
 const r=inferPhysicalMoves(new Chess(),[det('e4','P'),det('e6','p'),det('d2','P')]);
 assert.equal(r.kind,'move',JSON.stringify(r));assert.equal(r.key,'e2e4 e7e6');
});

test('physical piece evidence identifies e4 when white is on camera left',()=>{
  // Real a1 appears at the camera top-left after 90 degree rotation.
  const tile=(7-4)*8+4;
  // e4: canonical row 4, file 4 -> rotated CW row 4, col 3.
  const srcRow=4,srcCol=3;
  const visual=(7-srcRow)*8+srcCol;
  const result=inferPhysicalMoves(new Chess(),
   [{tile:visual,className:'P',confidence:.95}],{orientation:'l'});
  assert.equal(result.kind,'move',JSON.stringify(result));
  assert.equal(result.key,'e2e4');
});
