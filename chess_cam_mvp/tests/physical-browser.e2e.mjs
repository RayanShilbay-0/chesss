import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const port=4190,base='http://127.0.0.1:'+port;
const proc=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port)],{
 cwd:process.cwd(),stdio:['ignore','pipe','pipe']
});
let log='';proc.stdout.on('data',x=>log+=String(x));proc.stderr.on('data',x=>log+=String(x));
let browser;
async function waitReady(){
 for(let i=0;i<100;i++){
  if(proc.exitCode!==null)throw Error(log);
  try{if((await fetch(base)).ok)return;}catch{}
  await new Promise(r=>setTimeout(r,250));
 }throw Error('Server timeout '+log);
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
 console.log('PASS PHYSICAL ONNX + MOVING CAMERA OPENCV RANSAC');
}
try{await main()}catch(e){console.error('PHYSICAL TEST FAILED',e.stack||e);process.exitCode=1}
finally{try{await browser?.close()}catch{};proc.kill('SIGTERM');}
