import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {strict as assert} from 'node:assert';
const port=4178,base='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port)],{
 cwd:process.cwd(),stdio:['ignore','pipe','pipe']
});
let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
let browser;
async function waitServer(){
 for(let i=0;i<110;i++){
  if(child.exitCode!==null)throw Error(log);
  try{if((await fetch(base)).ok)return}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 throw Error('Vite unavailable '+log);
}
async function main(){
 await waitServer();
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage();
 page.on('pageerror',e=>console.log('BROWSER ERROR',e.message));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.addScriptTag({type:'module',url:base+'/src/model-test-entry.js'});
 await page.waitForFunction(()=>typeof window.__runModelGoldenFixture==='function');
 const expected='r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R';
 for(const [file,side] of [
  ['chesscom-italian-white.png','w'],
  ['lichess-italian-black.png','b']
 ]){
  const read=await page.evaluate(async ([filename,color])=>window.__runModelGoldenFixture(filename,color),[file,side]);
  console.log('MODEL RESULT '+file+' '+JSON.stringify(read));
  assert.equal(read.upstreamReliable,true,'original recognizer must accept fixture');
  assert.equal(read.actual,expected,'our 4-corner ONNX inference must read exact recognized pieces');
  assert(read.mean>.85,'recognition confidence too low: '+read.mean);
 }
 console.log('PASS PRETRAINED CHESS PIECE RECOGNITION: 2 real Lichess/Chess.com screenshots including black orientation');
}
try{await main()}catch(e){console.error('TEST FAILED',e.stack||e);process.exitCode=1}
finally{try{await browser?.close()}catch{}child.kill('SIGTERM')}
