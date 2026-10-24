import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';

const port=4177,base='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port)],{
 cwd:process.cwd(),stdio:['ignore','pipe','pipe']
});
let serverLog='';
child.stdout.on('data',x=>serverLog+=String(x));
child.stderr.on('data',x=>serverLog+=String(x));
let browser, page;
const delay=ms=>new Promise(r=>setTimeout(r,ms));

async function startServer(){
 for(let i=0;i<100;i++){
   if(child.exitCode!==null)throw Error('Vite exited: '+serverLog);
   try{const r=await fetch(base);if(r.ok)return;}catch{}
   await delay(250);
 }
 throw Error('Vite server not ready: '+serverLog);
}
const checker=async(label,condition,timeout=9000)=>{
 const started=Date.now();
 while(Date.now()-started<timeout){
   const info=await page.evaluate(()=>({
    status:document.querySelector('#scan-indicator')?.textContent,
    message:document.querySelector('#vision-message')?.textContent,
    count:document.querySelector('#move-count')?.textContent,
    turn:document.querySelector('#turn-status')?.textContent,
    suggestion:document.querySelector('#vision-suggestion')?.hidden===false,
    e4:document.querySelector('button[aria-label^="e4:"]')?.getAttribute('aria-label')
   }));
   if(condition(info)){console.log('PASS '+label+' '+JSON.stringify(info));return;}
   await delay(350);
 }
 const now=await page.evaluate(()=>({
  status:document.querySelector('#scan-indicator')?.textContent,
  message:document.querySelector('#vision-message')?.textContent,
  count:document.querySelector('#move-count')?.textContent,
  turn:document.querySelector('#turn-status')?.textContent
 }));
 await page.screenshot({path:'test-artifacts/'+label.replaceAll(/[^a-z0-9]/gi,'-')+'.png',fullPage:true});
 throw Error('TIMEOUT '+label+': '+JSON.stringify(now));
};
const init=()=>{
 const c=document.createElement('canvas');c.width=768;c.height=768;
 const ctx=c.getContext('2d');
 const file='abcdefgh';
 const pos={};
 for(let i=0;i<8;i++){
  for(const [r,type,color] of [[2,'p','w'],[7,'p','b']])pos[file[i]+r]=color+type;
  for(const [r,color] of [[1,'w'],[8,'b']])pos[file[i]+r]=color+['r','n','b','q','k','b','n','r'][i];
 }
 const rgb={light:'#ebecd0',dark:'#779556'};
 let highlighted=[];
 function render(){
  const size=96;
  for(let r=0;r<8;r++)for(let x=0;x<8;x++){
   const sq=file[x]+(8-r),light=(r+x)%2===0;
   ctx.fillStyle=highlighted.includes(sq)?(light?'#f3ee8b':'#a9bf59'):(light?rgb.light:rgb.dark);
   ctx.fillRect(x*size,r*size,size,size);
   const piece=pos[sq];
   if(!piece)continue;
   const black=piece[0]==='b';
   const x0=x*size+size/2,y0=r*size+size/2;
   ctx.lineWidth=4;ctx.strokeStyle=black?'#eee':'#30342b';
   ctx.fillStyle=black?'#242526':'#f4f4ef';
   ctx.beginPath();
   ctx.ellipse(x0,y0+19,30,13,0,0,Math.PI*2);ctx.fill();ctx.stroke();
   ctx.beginPath();ctx.ellipse(x0,y0-3,21,30,0,0,Math.PI*2);ctx.fill();ctx.stroke();
   ctx.beginPath();ctx.arc(x0,y0-29,piece[1]==='p'?12:15,0,Math.PI*2);ctx.fill();ctx.stroke();
   if(piece[1]!=='p'){
    ctx.strokeStyle=black?'#fafafa':'#212727';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(x0-9,y0-27);ctx.lineTo(x0+9,y0-27);ctx.stroke();
   }
   if(piece[1]==='k'){
    ctx.beginPath();ctx.moveTo(x0,y0-49);ctx.lineTo(x0,y0-28);
    ctx.moveTo(x0-10,y0-42);ctx.lineTo(x0+10,y0-42);ctx.stroke();
   }
  }
 }
 render();
 const stream=c.captureStream(12);
 setInterval(render,65);
 navigator.mediaDevices.getUserMedia=async()=>stream;
 Object.defineProperty(window,'__chessTest',{configurable:true,value:{
   move(uci){
    const a=uci.slice(0,2),b=uci.slice(2,4);
    if(!pos[a])throw Error('Missing piece '+a);
    pos[b]=pos[a];delete pos[a];highlighted=[a,b];render();
   },
   reset(){for(const sq of Object.keys(pos))delete pos[sq];highlighted=[];render();},
   highlight(a,b){highlighted=[a,b];render()},
   clearHighlight(){highlighted=[];render()},
   getBoard(){return {...pos}},
   render
 }});
};
async function test(){
 await startServer();
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream']});
 page=await browser.newPage({viewport:{width:1250,height:920},permissions:['camera']});
 page.on('pageerror',e=>console.error('BROWSER PAGE ERROR',e.message));
 page.on('console',msg=>{if(msg.type()==='error')console.error('BROWSER CONSOLE ERROR',msg.text())});
 await page.addInitScript(init);
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.locator('#start-camera').click();
 await checker('stream-started',s=>s.status.includes('بانتظار معايرة'));
 await page.locator('#calibrate').click();
 const o=page.locator('#camera-overlay');
 const box=await o.boundingBox();
 assert(box.width>500&&box.height>500,JSON.stringify(box));
 for(const [x,y] of [[2,2],[box.width-2,2],[box.width-2,box.height-2],[2,box.height-2]]){
   await o.click({position:{x,y}});
 }
 await page.locator('#baseline').click();
 await page.locator('#auto-accept').check();
 await checker('auto-monitor-on',s=>s.status.includes('المراقبة'));
 await page.evaluate(()=>window.__chessTest.move('e2e4'));
 await checker('white-e4-recognized',s=>s.turn.includes('الأسود'));
 await page.evaluate(()=>window.__chessTest.move('e7e6'));
 await checker('black-e6-recognized',s=>s.turn.includes('الأبيض')&&s.count.includes('2'));
 await page.evaluate(()=>window.__chessTest.move('g1f3'));
 await checker('white-knight-f3-recognized',s=>s.turn.includes('الأسود')&&s.count.includes('2'));
 await page.evaluate(()=>window.__chessTest.move('d7d5'));
 await checker('black-d5-recognized',s=>s.turn.includes('الأبيض')&&s.count.includes('3'));
 await page.evaluate(()=>window.__chessTest.move('b1c3'));
 await delay(250);
 await page.evaluate(()=>window.__chessTest.move('g8f6'));
 await checker('fast-two-ply-update',s=>s.turn.includes('الأبيض')&&s.count.includes('4'));
 await delay(4600);
 await checker('still-tracking-after-idle',s=>s.status.includes('المراقبة')&&!s.status.includes('الرقعتان'));
 console.log('PASS FULL BROWSER SIMULATED CHESS GAME');
}
mkdirSync('test-artifacts',{recursive:true});
try{await test();}catch(err){console.error('E2E FAILURE',err.stack||err);process.exitCode=1}
finally{try{await browser?.close()}catch{};child.kill('SIGTERM');}
