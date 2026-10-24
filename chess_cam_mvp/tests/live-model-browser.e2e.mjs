import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import {strict as assert} from 'node:assert';
const port=4184,base='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port)],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
let serverLog='';for(const pipe of [child.stdout,child.stderr])pipe.on('data',x=>serverLog+=String(x));
let browser;
async function ready(){
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)return}catch{};await new Promise(r=>setTimeout(r,250))}
 throw Error('Vite not ready: '+serverLog);
}
async function check(page,title,condition,timeout=15000){
 const start=Date.now(),last=()=>page.evaluate(()=>({
  state:document.getElementById('scan-indicator')?.textContent,
  message:document.getElementById('vision-message')?.textContent,
  turn:document.getElementById('turn-status')?.textContent,
  moves:document.getElementById('move-count')?.textContent,
  model:document.getElementById('ai-vision-state')?.textContent
 }));
 let state;
 while(Date.now()-start<timeout){
  state=await last();
  if(condition(state)){console.log('PASS '+title+' '+JSON.stringify(state));return;}
  await new Promise(r=>setTimeout(r,300));
 }
 throw Error('FAIL '+title+' after '+timeout+'ms: '+JSON.stringify(state));
}
async function run(){
 await ready();
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream']});
 const page=await browser.newPage({viewport:{width:1450,height:980},permissions:['camera']});
 page.on('pageerror',e=>console.error('PAGE ERROR',e.message));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=640;c.height=640;
  const ctx=c.getContext('2d'),files='abcdefgh';
  const position={},sprites={};
  for(let i=0;i<8;i++){
   for(const [rank,color] of [[2,'w'],[7,'b']])position[files[i]+rank]=color+'P';
   for(const [rank,color] of [[1,'w'],[8,'b']])position[files[i]+rank]=color+['R','N','B','Q','K','B','N','R'][i];
  }
  await Promise.all(['w','b'].flatMap(color=>['P','R','N','B','Q','K'].map(async kind=>{
   const name=color+kind,image=new Image();
   image.src='/test-fixtures/cburnett/'+name+'.svg';
   await image.decode();sprites[name]=image;
  })));
  let marked=[];
  function draw(){
   const side=80;
   for(let row=0;row<8;row++)for(let col=0;col<8;col++){
    const square=files[col]+(8-row),light=(row+col)%2===0;
    ctx.fillStyle=marked.includes(square)?(light?'#f4ef89':'#a9c754'):(light?'#eeeed2':'#769656');
    ctx.fillRect(col*side,row*side,side,side);
    if(position[square])ctx.drawImage(sprites[position[square]],col*side+2,row*side+2,side-4,side-4);
   }
  }
  draw();
  const stream=c.captureStream(15);
  navigator.mediaDevices.getUserMedia=async()=>stream;
  window.__liveChessTest={
   move(str){
    const a=str.slice(0,2),b=str.slice(2,4);
    if(!position[a])throw Error('No piece on '+a);
    position[b]=position[a];delete position[a];marked=[a,b];draw();
   },
   board:()=>({...position})
  };
 });
 await page.locator('#start-camera').click();
 await page.locator('#calibrate').click();
 const box=await page.locator('#camera-overlay').boundingBox();
 assert(box.width>200,JSON.stringify(box));
 for(const [x,y] of [[1,1],[box.width-1,1],[box.width-1,box.height-1],[1,box.height-1]])await page.locator('#camera-overlay').click({position:{x,y}});
 await page.locator('#baseline').click();
 await page.locator('#auto-accept').check();
 await check(page,'model-start',s=>s.state.includes('المراقبة'),8000);
 for(const [notation,expectedTurn,expectedNumber] of [
  ['e2e4','الأسود','1'],
  ['e7e6','الأبيض','2'],
  ['g1f3','الأسود','2'],
  ['d7d5','الأبيض','3']
 ]){
  await page.evaluate(move=>window.__liveChessTest.move(move),notation);
  await check(page,'live-'+notation,s=>s.turn.includes(expectedTurn)&&s.moves.includes(expectedNumber),19000);
 }
 console.log('PASS LIVE CHESS WEBSITE CAMERA MODEL: 4 consecutive moves with trained ONNX runtime');
}
try{await run()}catch(e){console.error('END-TO-END TRAINED MODEL FAILED',e.stack||e);process.exitCode=1}
finally{try{await browser?.close()}catch{};child.kill('SIGTERM')}
