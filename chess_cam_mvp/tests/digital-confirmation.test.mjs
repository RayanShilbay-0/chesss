import test from 'node:test';
import assert from 'node:assert/strict';
import {keepDigitalCandidate,digitalMoveVote} from '../src/digital-confirmation.js';
const fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
test('retain tentative move through a few ambiguous camera frames',()=>{
 assert(keepDigitalCandidate('uncertain',{meanConfidence:.67,placement:'different'},fen,0));
 assert(keepDigitalCandidate('unreliable',{meanConfidence:.45,placement:'different'},fen,2));
 assert(!keepDigitalCandidate('uncertain',{meanConfidence:.53,placement:'different'},fen,3));
});
test('drop false positive if the original position is clearly seen',()=>{
 assert(!keepDigitalCandidate('unchanged',{meanConfidence:.97,placement:fen.split(' ')[0]},fen,0));
});
test('digital move result needs ordinary confirmation, not an ambiguity hold',()=>{
 assert(!keepDigitalCandidate('move',{meanConfidence:.99},fen,0));
});

test('one valid vote is retained; two independent valid votes accept the move',()=>{
 const r={kind:'move',confidence:.96,margin:9,key:'e2e4'};
 const policy={confidence:.58,margin:2.2,agreement:2};
 assert.deepEqual(digitalMoveVote(r,1,policy),{qualified:true,accept:false,stillWaiting:true});
 assert.deepEqual(digitalMoveVote(r,2,policy),{qualified:true,accept:true,stillWaiting:false});
});
test('a rejected weak frame never becomes a confirmed move',()=>{
 const r={kind:'move',confidence:.52,margin:8,key:'e2e4'};
 const policy={confidence:.58,margin:2.2,agreement:2};
 assert.equal(digitalMoveVote(r,3,policy).accept,false);
});
