import test from 'node:test';
import assert from 'node:assert/strict';
import {boardSignature,signatureDifference,profileSettings} from '../src/vision-speed.js';
const empty=()=>new Float32Array(256*256).fill(.5);
test('static frame skips expensive CNN step',()=>{
 const s=boardSignature(empty());
 assert.equal(signatureDifference(s,boardSignature(empty())).changed,0);
});
test('adding a piece in two squares triggers neural model inference',()=>{
 const before=empty(),after=empty();
 for(const [r,c] of [[6,4],[4,4]])for(let dy=9;dy<25;dy++)for(let dx=9;dx<25;dx++)
  after[(r*32+dy)*256+c*32+dx]=.04;
 const change=signatureDifference(boardSignature(before),boardSignature(after));
 assert.equal(change.changed,2,JSON.stringify(change));
});
test('uniform square highlighting does not trigger a piece change',()=>{
 const before=empty(),after=empty();
 for(let y=32*4;y<32*5;y++)for(let x=32*4;x<32*5;x++)
   after[y*256+x]=.65;
 assert.equal(signatureDifference(boardSignature(before),boardSignature(after)).changed,0);
});
test('turbo interval faster and careful profile requires two confirmations',()=>{
 assert(profileSettings('turbo').interval<profileSettings('balanced').interval);
 assert.equal(profileSettings('turbo').agreement,1);
 assert.equal(profileSettings('careful').agreement,2);
});
