import test from 'node:test';
import assert from 'node:assert/strict';
import {cropPhysicalBoard} from '../src/physical-crop.js';
test('real camera YOLO ROI crops large portrait background around board',()=>{
 const width=720,height=1280,src=new Uint8ClampedArray(width*height*4);
 src.fill(100);
 const corners=[{x:160,y:360},{x:560,y:340},{x:570,y:770},{x:145,y:780}];
 const crop=cropPhysicalBoard({width,height,data:src},corners);
 assert(crop.width<width&&crop.height<height);
 assert(crop.left<145&&crop.top<340);
 assert.equal(crop.rgba.length,crop.width*crop.height*4);
 assert(crop.width>=425&&crop.height>=440);
});
test('without calibration do not crop important pieces',()=>{
 const pixels=new Uint8ClampedArray(32*48*4);
 const c=cropPhysicalBoard({width:32,height:48,data:pixels},[]);
 assert.equal(c.width,32);assert.equal(c.height,48);
});
