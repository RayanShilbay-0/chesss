import test from 'node:test';
import assert from 'node:assert/strict';
import {quadArea,poseIsValid,stabilizeCorners} from '../src/moving-board-tracker.js';
const board=[{x:110,y:70},{x:470,y:75},{x:460,y:410},{x:100,y:395}];
test('AR perspective board accepts hand-held translation, scale, and skew',()=>{
 const q=board.map(p=>({x:p.x+35,y:p.y+23}));
 assert(poseIsValid(board,q,640,480));assert(quadArea(q)>90000);
 const tilt=[{x:140,y:55},{x:460,y:85},{x:490,y:405},{x:115,y:380}];
 assert(poseIsValid(board,tilt,640,480));
});
test('reject reflections and enormous camera jumps',()=>{
 assert(!poseIsValid(board,[board[1],board[0],board[3],board[2]],640,480));
 assert(!poseIsValid(board,board.map(p=>({x:p.x*4,y:p.y*4})),640,480));
 assert(!poseIsValid(board,[board[0],board[0],board[2],board[3]],640,480));
});
test('stabilization damps jitter without freezing large motion',()=>{
 const delta=board.map(p=>({x:p.x+10,y:p.y-4}));
 const smooth=stabilizeCorners(board,delta,.7);
 assert(Math.abs(smooth[0].x-board[0].x-7)<.001);
 assert(Math.abs(smooth[0].y-board[0].y+2.8)<.001);
});
