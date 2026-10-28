import test from 'node:test';
import assert from 'node:assert/strict';
import {keepDigitalCandidate} from '../src/digital-confirmation.js';
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
