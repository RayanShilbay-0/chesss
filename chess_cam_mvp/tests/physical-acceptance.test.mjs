import test from 'node:test';
import assert from 'node:assert/strict';
import {physicalCandidateDecision} from '../src/physical-acceptance.js';
const example={kind:'move',key:'e2e4',confidence:.75,margin:1.48,score:4.2};
test('balanced physical model accepts strong legal move after temporal evidence',()=>{
 assert.equal(physicalCandidateDecision(example,1,'balanced').accept,false);
 assert.equal(physicalCandidateDecision(example,2,'balanced').accept,true);
});
test('video CNN profile thresholds are NOT used for LeYOLO',()=>{
 // This formerly failed: 1.48 < generic CNN margin 2.2.
 assert.equal(physicalCandidateDecision(example,3,'balanced').reason,'verified');
 assert.equal(physicalCandidateDecision(example,3,'careful').accept,false);
});
test('reject single-frame hallucination, weak class and nearly tied guesses',()=>{
 assert.equal(physicalCandidateDecision({...example,confidence:.54},5).accept,false);
 assert.equal(physicalCandidateDecision({...example,margin:1.21},5).accept,false);
 assert.equal(physicalCandidateDecision({...example,kind:'uncertain'},5).accept,false);
});
test('turbo only accepts high-confidence model outputs',()=>{
 assert.equal(physicalCandidateDecision({...example,confidence:.93,margin:2.6},2,'turbo').accept,true);
 assert.equal(physicalCandidateDecision(example,2,'turbo').accept,false);
});
test('careful mode requires an independent repeated candidate',()=>{
 const confident={...example,confidence:.82,margin:2.5};
 assert.equal(physicalCandidateDecision(confident,3,'careful',1).accept,false);
 assert.equal(physicalCandidateDecision(confident,3,'careful',2).accept,true);
});

test('colour-only chess piece recognition requires extra independent confirmation',()=>{
 const result={kind:'move',key:'e2e4',typeRelaxed:true,confidence:.85,margin:2.1};
 assert.equal(physicalCandidateDecision(result,2,'balanced',1).accept,false);
 assert.equal(physicalCandidateDecision(result,3,'balanced',1).accept,false);
 assert.equal(physicalCandidateDecision(result,3,'balanced',2).accept,true);
 assert.equal(physicalCandidateDecision({...result,margin:1.4},4,'balanced',3).accept,false);
});
