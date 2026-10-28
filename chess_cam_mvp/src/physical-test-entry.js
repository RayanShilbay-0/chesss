import {PhysicalChessVision} from './physical-vision.js';
import {MovingBoardTracker} from './moving-board-tracker.js';
import {Chess} from 'chess.js';
function canvasBoard(){
 const canvas=document.createElement('canvas');
 canvas.width=800;canvas.height=600;
 const ctx=canvas.getContext('2d');
 let shift=0;
 function draw(){
  ctx.fillStyle='#444b3f';ctx.fillRect(0,0,800,600);
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
   const x=154+shift+c*60,y=40+shift+r*60;
   ctx.fillStyle=(r+c)%2===0?'#f1e4bc':'#7a5b39';
   ctx.fillRect(x,y,60,60);
   if(r<2||r>=6){
    ctx.fillStyle=r<2?'#201f1d':'#eee5da';
    ctx.beginPath();ctx.ellipse(x+30,y+25,14,23,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=r<2?'#b5b9ae':'#332b23';
    ctx.beginPath();ctx.arc(x+30,y+10,9,0,Math.PI*2);ctx.fill();
   }
  }
 }
 draw();
 const frame=()=>ctx.getImageData(0,0,800,600);
 const corners=()=>[{x:154+shift,y:40+shift},{x:634+shift,y:40+shift},
   {x:634+shift,y:520+shift},{x:154+shift,y:520+shift}];
 return {canvas,frame,corners,move(px){shift=px;draw()}};
}
window.__testPhysical=async()=>{
 const scene=canvasBoard(),camera={
  stream:{},corners:scene.corners(),sourceKind:'camera',poseValid:true,side:'w',
  frame:scene.frame,
  point(u,v){const [tl,tr,br,bl]=this.corners;
   return {x:tl.x*(1-u)*(1-v)+tr.x*u*(1-v)+br.x*u*v+bl.x*(1-u)*v,
     y:tl.y*(1-u)*(1-v)+tr.y*u*(1-v)+br.y*u*v+bl.y*(1-u)*v}}
 };
 const physical=new PhysicalChessVision(camera);
 try{
  const result=await physical.recognize(new Chess());
  return {kind:result.result.kind,backend:result.stats?.backend,
    ms:result.stats?.inference,count:result.count??0};
 }finally{physical.close()}
};
window.__testMotion=async()=>{
 const scene=canvasBoard();
 const camera={
   stream:{},sourceKind:'camera',calibrating:false,
   corners:scene.corners(),drawOverlay(){},
   frame:scene.frame,
   point(u,v){
    const [a,b,c,d]=this.corners;
    return {x:a.x*(1-u)*(1-v)+b.x*u*(1-v)+c.x*u*v+d.x*(1-u)*v,
      y:a.y*(1-u)*(1-v)+b.y*u*(1-v)+c.y*u*v+d.y*(1-u)*v};
   }
 };
 const tracker=new MovingBoardTracker(camera);
 try{
  await tracker.start();
  const first=tracker.observe(scene.frame());
  scene.move(10);
  const second=tracker.observe(scene.frame());
  scene.move(19);
  const third=tracker.observe(scene.frame());
  return {first,second,third,corners:camera.corners};
 }finally{tracker.stop()}
};
