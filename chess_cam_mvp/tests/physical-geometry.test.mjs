import test from 'node:test';
import assert from 'node:assert/strict';
import {imageToBoard,mapPhysicalDetections,decodeYolo} from '../src/physical-geometry.js';
const perspective=(u,v)=>({x:(100+350*u+30*v)/(1+.09*u+.04*v),
  y:(70+20*u+310*v)/(1+.09*u+.04*v)});
test('image-to-board inverse homography works during perspective and tilt',()=>{
 for(const [u,v] of [[.1,.1],[.51,.43],[.89,.66],[.4,.85]]){
  const p=perspective(u,v);
  const r=imageToBoard(perspective,p.x,p.y);
  assert(Math.abs(r.u-u)<.003&&Math.abs(r.v-v)<.003,JSON.stringify(r));
 }
});
test('physical LeYOLO squares map pieces by their feet, not box centers',()=>{
 const foot=perspective((4.5)/8,(6.5)/8);
 const boxes=[{cx:foot.x,cy:foot.y-9,h:30,w:18,className:'P',confidence:.91}];
 const m=mapPhysicalDetections(boxes,perspective);
 assert.equal(m.count,1);
 assert.equal(m.probabilities.length,832);
});
test('LeYOLO 16-channel ONNX outputs decode class and bbox',()=>{
 const n=2,raw=new Float32Array(16*n);
 raw[0]=100;raw[n]=80;raw[2*n]=25;raw[3*n]=40;
 raw[(4+3)*n]=.89;
 const boxes=decodeYolo(raw,[1,16,n]);
 assert.equal(boxes.length,1);
 assert.equal(boxes[0].className,'p');
 assert(boxes[0].confidence>.8);
});

import { PhysicalChessVision } from '../src/physical-vision.js';
test('LeYOLO xcorner classifier recovers outer board corners from 7x7 intersections',()=>{
 const n=49,raw=new Float32Array(5*n);
 let i=0;
 for(let row=1;row<=7;row++)for(let col=1;col<=7;col++){
   raw[i]=100+col*60;
   raw[n+i]=40+row*60;
   raw[2*n+i]=8;raw[3*n+i]=8;raw[4*n+i]=.95;
   i++;
 }
 const detector=Object.create(PhysicalChessVision.prototype);
 const found=detector.decodeCorners({raw,shape:[1,5,n],scale:1,offX:0,offY:0,ms:12},800,600);
 assert(found, 'the board should be found');
 assert.equal(found.points,49);
 const expected=[[100,40],[580,40],[580,520],[100,520]];
 for(let j=0;j<4;j++){
   assert(Math.abs(found.corners[j].x-expected[j][0])<1);
   assert(Math.abs(found.corners[j].y-expected[j][1])<1);
 }
});
