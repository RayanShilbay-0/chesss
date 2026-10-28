import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const port=4178,base='http://127.0.0.1:'+port;
const proc=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port)],{
 cwd:process.cwd(),stdio:['ignore','pipe','pipe']
});
let log='';proc.stdout.on('data',x=>log+=String(x));proc.stderr.on('data',x=>log+=String(x));
let browser;
async function waitReady(){
 let lastError='';
 for(let i=0;i<100;i++){
  if(proc.exitCode!==null)throw Error(log);
  try{
    const response=await fetch(base);
    if(response.ok)return;
    if(i%12===0)lastError='HTTP '+response.status+' '+(await response.text()).slice(0,700);
  }catch(e){lastError=String(e)}
  await new Promise(r=>setTimeout(r,250));
 }
 throw Error('Server timeout '+lastError+' | Vite log: '+log);
}
async function main(){
 await waitReady();
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1150,height:900}});
 page.on('pageerror',e=>console.error('PAGE ERROR',e.message));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.addScriptTag({type:'module',url:base+'/src/physical-test-entry.js'});
 await page.waitForFunction(()=>typeof window.__testPhysical==='function');
 const onnx=await page.evaluate(()=>window.__testPhysical());
 console.log('REAL PHYSICAL PIECE MODEL '+JSON.stringify(onnx));
 assert.equal(onnx.backend,'LeYOLO ONNX');
 assert(Number.isFinite(onnx.ms)&&onnx.ms>0);
 const flow=await page.evaluate(()=>window.__testMotion());
 console.log('OPENCV MOVING BOARD '+JSON.stringify(flow));
 assert.equal(flow.first.state,'tracking','must establish grid features');
 assert.equal(flow.second.state,'tracking','must track a moving board');
 assert.equal(flow.third.state,'tracking','must stay tracked with camera translation');
 assert(flow.corners[0].x>159,'corner must follow camera movement, got '+flow.corners[0].x);
 const memory=await page.evaluate(()=>window.__testBoardMemory());
 console.log('BOARD MEMORY '+JSON.stringify(memory));
 assert(memory.log.every(s=>s==='tracking'),'board memory must track a moving board');
 assert(memory.trackedError<3,'tracked corners must stay within 3 px, got '+memory.trackedError);
 assert.equal(memory.lost,'lost','a blank frame must invalidate the pose');
 assert(memory.relocalizedAfterFrames,'must relocalize from stored keyframes after loss');
 assert(memory.relocError<4,'relocalized corners within 4 px, got '+memory.relocError);
 console.log('PASS PHYSICAL ONNX + MOVING CAMERA OPENCV RANSAC + BOARD MEMORY RELOCALIZATION');
}
try{await main()}catch(e){console.error('PHYSICAL TEST FAILED',e.stack||e);process.exitCode=1}
finally{try{await browser?.close()}catch{};proc.kill('SIGTERM');}
