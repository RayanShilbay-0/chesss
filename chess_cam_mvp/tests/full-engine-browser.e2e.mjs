import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const port=4185, origin='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js',
  '--host','127.0.0.1','--port',String(port)],{
  cwd:process.cwd(),stdio:['ignore','pipe','pipe']
});
let serverOutput='';
for(const p of [server.stdout,server.stderr])p.on('data',x=>serverOutput+=String(x));
let browser;
async function start(){
 for(let i=0;i<120;i++){
   if(server.exitCode!==null)throw Error(serverOutput);
   try{if((await fetch(origin)).ok)return;}catch{}
   await new Promise(r=>setTimeout(r,250));
 }
 throw Error('No local server: '+serverOutput);
}
async function run(){
 await start();
 browser=await chromium.launch({
   headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']
 });
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 page.on('pageerror',e=>console.error('Page error: '+e.message));
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 assert.equal(await page.locator('#engine-mode').inputValue(),'full');
 await page.waitForFunction(
  ()=>document.querySelector('#engine-health')?.textContent.includes('Full جاهز'),
  null,{timeout:125000}
 );
 await page.waitForFunction(
  ()=>document.querySelector('#best-move')?.textContent.trim()!=='—',
  null,{timeout:60000}
 );
 const first=await page.locator('#best-move').textContent();
 const detail=await page.locator('#best-detail').textContent();
 console.log('PASS FULL ENGINE READY '+JSON.stringify({first,detail}));
 // Test real next-position analysis rather than merely initializing WASM.
 await page.locator('#board button[aria-label^="e2:"]').click();
 await page.locator('#board button[aria-label^="e4:"]').click();
 await page.waitForFunction(()=>document.querySelector('#turn-status')?.textContent.includes('الأسود'));
 await page.waitForFunction(
   ()=>document.querySelector('#best-move')?.textContent.trim()!=='—',
   null,{timeout:60000}
 );
 console.log('PASS STOCKFISH FULL 19 DEFAULT — worker UCI, initial bestmove, next-position analysis');
}
try{await run()}
catch(e){console.error('FULL STOCKFISH BROWSER TEST FAILURE',e.stack||e);process.exitCode=1;}
finally{try{await browser?.close()}catch{};server.kill('SIGTERM');}
