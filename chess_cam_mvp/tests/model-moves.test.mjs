import test from 'node:test';
import assert from 'node:assert/strict';
import {Chess} from 'chess.js';
import {inferMovesFromModel,decodedPosition,visualIndex,TILE_LABELS} from '../src/model-moves.js';
function probabilitiesFor(game,correct=.985){
 const arr=new Float32Array(832);
 const squares=game.board().flat();
 for(let i=0;i<64;i++){
   const piece=squares[i],ch=piece?(piece.color==='w'?piece.type.toUpperCase():piece.type):'1';
   const tile=visualIndex(i,true),k=TILE_LABELS.indexOf(ch);
   for(let j=0;j<13;j++)arr[tile*13+j]=j===k?correct:(1-correct)/12;
 }
 return arr;
}
test('model tile ordering identifies starting FEN',()=>{
 const chess=new Chess(),p=probabilitiesFor(chess);
 assert.equal(decodedPosition(p).placement,chess.fen().split(' ')[0]);
});
test('model picks legal white and black replies from full positions',()=>{
 const start=new Chess(),target=new Chess();target.move('e4');
 let found=inferMovesFromModel(start,probabilitiesFor(target));
 assert.equal(found.kind,'move',JSON.stringify(found));
 assert.equal(found.key,'e2e4');
 target.move('e6');
 found=inferMovesFromModel(new Chess(start.fen()),probabilitiesFor(target));
 assert.equal(found.kind,'move',JSON.stringify(found));
 assert.equal(found.sequence.length,2);
 assert.equal(found.key,'e2e4 e7e6');
});
test('model picks a knight response after successive legal moves',()=>{
 const g=new Chess();g.move('e4');g.move('e6');
 const dest=new Chess(g.fen());dest.move('Nf3');
 const result=inferMovesFromModel(g,probabilitiesFor(dest));
 assert.equal(result.key,'g1f3',JSON.stringify(result));
});
test('correct board never generates fabricated moves',()=>{
 const g=new Chess();
 const r=inferMovesFromModel(g,probabilitiesFor(g));
 assert.equal(r.kind,'unchanged',JSON.stringify(r));
});
test('rotated camera model probabilities map black-bottom correctly',()=>{
 const g=new Chess(),raw=probabilitiesFor(g);
 const rotated=new Float32Array(832);
 for(let i=0;i<64;i++){
   const from=visualIndex(i,true),to=visualIndex(i,false);
   rotated.set(raw.subarray(from*13,from*13+13),to*13);
 }
 assert.equal(decodedPosition(rotated,false).placement,g.fen().split(' ')[0]);
 assert.equal(inferMovesFromModel(g,rotated,{whiteBottom:false}).kind,'unchanged');
});
test('low-confidence model output is rejected, not accepted as a chess move',()=>{
 const arr=new Float32Array(832).fill(1/13);
 const r=inferMovesFromModel(new Chess(),arr);
 assert.equal(r.kind,'unreliable');
});
