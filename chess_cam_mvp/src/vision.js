// Camera observation, NOT a trained piece recognizer. Detects changed squares between stable snapshots,
// then proposes a legal move based on those changes. Requires a fixed overhead camera.
const file='abcdefgh';
const cellName=(r,c,side)=>side==='w'?file[c]+(8-r):file[7-c]+(r+1);
const visualCell=(square,side)=>{
  const c=file.indexOf(square[0]), r=8-Number(square[1]);
  return side==='w'?{r,c}:{r:7-r,c:7-c};
};

export class CameraVision {
 constructor(video,canvas,stage,onMessage){
   this.video=video;this.canvas=canvas;this.stage=stage;this.message=onMessage;
   this.ctx=canvas.getContext('2d',{willReadFrequently:true});
   this.stream=null;this.calibrating=false;this.corners=[];this.reference=null;
   this.side='w';this.latestFeatures=null;
 }
 async start(){
   if(!navigator.mediaDevices?.getUserMedia) throw new Error('كاميرا المتصفح تتطلب HTTPS أو localhost. افتح الموقع من رابط آمن.');
   if(this.stream) return;
   this.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
   this.video.srcObject=this.stream;
   await this.video.play();
   const w=Math.min(960,this.video.videoWidth),h=Math.round(w*this.video.videoHeight/this.video.videoWidth);
   this.canvas.width=w;this.canvas.height=h;
   this.stage.style.aspectRatio=`${w} / ${h}`;
   this.stage.classList.add('playing');
   this.message('الكاميرا جاهزة. الآن اضغط «تحديد زوايا الرقعة».');
 }
 stop(){
   this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;
   this.video.srcObject=null;this.reference=null;this.latestFeatures=null;
   this.calibrating=false;this.corners=[];this.drawOverlay();
   this.stage.classList.remove('playing');
 }
 frame(){
   if(!this.stream||this.video.readyState<2)throw Error('الكاميرا غير جاهزة.');
   const c=document.createElement('canvas'); c.width=this.canvas.width;c.height=this.canvas.height;
   const cx=c.getContext('2d',{willReadFrequently:true});cx.drawImage(this.video,0,0,c.width,c.height);
   return cx.getImageData(0,0,c.width,c.height);
 }
 beginCalibration(){
   if(!this.stream)throw Error('شغّل الكاميرا أولًا.');
   this.reference=null;this.calibrating=true;this.corners=[];
   this.ctx.putImageData(this.frame(),0,0);
   this.stage.classList.add('calibrating');
   this.message('اضغط على الزوايا بالترتيب: أعلى يسار ← أعلى يمين ← أسفل يمين ← أسفل يسار.');
 }
 tap(x,y){
   if(!this.calibrating)return false;
   this.corners.push({x,y});this.drawOverlay(true);
   if(this.corners.length===4){
     this.calibrating=false;this.stage.classList.remove('calibrating');this.drawOverlay();
     this.message('تم تحديد الرقعة. ضع القطع في أماكنها واضغط «حفظ الوضع الحالي» بعد إبعاد اليدين.');
     return true;
   }
   this.message(`تم تحديد ${this.corners.length} من 4 زوايا.`);
   return false;
 }
 drawOverlay(frozen=false){
   const cx=this.ctx, {width:w,height:h}=this.canvas;
   if(!frozen)cx.clearRect(0,0,w,h);
   if(this.corners.length){
     cx.lineWidth=4;cx.strokeStyle='#c9f397';cx.fillStyle='#c9f397';
     cx.beginPath();cx.moveTo(this.corners[0].x,this.corners[0].y);
     for(let k=1;k<this.corners.length;k++)cx.lineTo(this.corners[k].x,this.corners[k].y);
     if(this.corners.length===4)cx.closePath();cx.stroke();
     for(let i=0;i<this.corners.length;i++){
       const p=this.corners[i];cx.beginPath();cx.arc(p.x,p.y,7,0,Math.PI*2);cx.fill();
       cx.fillStyle='#172b24';cx.font='bold 18px sans-serif';cx.fillText(String(i+1),p.x+12,p.y+6);cx.fillStyle='#c9f397';
     }
   }
 }
 // Bilinear interpolation is enough for approximate cell interiors when seen from near overhead.
 point(u,v){
   const [a,b,c,d]=this.corners;
   return {x:a.x*(1-u)*(1-v)+b.x*u*(1-v)+c.x*u*v+d.x*(1-u)*v,
           y:a.y*(1-u)*(1-v)+b.y*u*(1-v)+c.y*u*v+d.y*(1-u)*v};
 }
 features(data){
   const arr=[];const W=data.width,H=data.height,p=data.data;
   for(let r=0;r<8;r++)for(let c=0;c<8;c++){
     let samples=[];
     // 5 x 5 interior samples; includes center of each physical square.
     for(let sy=0;sy<5;sy++)for(let sx=0;sx<5;sx++){
       const u=(c+0.19+0.62*sx/4)/8,v=(r+0.19+0.62*sy/4)/8;
       const pt=this.point(u,v),x=Math.max(0,Math.min(W-1,Math.round(pt.x))),y=Math.max(0,Math.min(H-1,Math.round(pt.y)));
       const off=(y*W+x)*4;
       samples.push([p[off],p[off+1],p[off+2]]);
     }
     arr.push(samples);
   }
   return arr;
 }
 saveReference(){
   if(this.corners.length!==4)throw Error('حدد زوايا الرقعة أولًا.');
   this.reference=this.features(this.frame());
   this.message('تم حفظ الصورة المرجعية. بعد تحريك قطعة وإبعاد اليدين، اضغط «قراءة النقلة بالكاميرا».');
 }
 propose(game){
   if(!this.reference)throw Error('احفظ الوضع الحالي أولًا.');
   const current=this.features(this.frame());
   const scores=this.reference.map((samples,i)=>{
     const base=samples.map(p=>(p[0]+p[1]+p[2])/3);
     const now=current[i].map(p=>(p[0]+p[1]+p[2])/3);
     const bias=now.reduce((a,b)=>a+b,0)/now.length-base.reduce((a,b)=>a+b,0)/base.length;
     let diff=0;
     for(let j=0;j<samples.length;j++){
       // account for camera automatic exposure by subtracting per-square mean shift
       for(let k=0;k<3;k++)diff+=Math.abs(current[i][j][k]-samples[j][k]-bias);
     }
     return diff/(samples.length*3);
   });
   this.latestFeatures=current;
   const moves=game.moves({verbose:true});
   const ordered=[...scores].sort((a,b)=>b-a);
   const background=ordered[Math.floor(scores.length/2)]||0;
   const expectedSquares=(m)=>{
     const f=visualCell(m.from,this.side),t=visualCell(m.to,this.side);
     const ss=[f.r*8+f.c,t.r*8+t.c];
     if(m.flags.includes('e')){
       const target=m.to[0]+m.from[1],p=visualCell(target,this.side);ss.push(p.r*8+p.c);
     }
     if(m.flags.includes('k')||m.flags.includes('q')){
       const kingSide=m.flags.includes('k'),rank=m.from[1];
       for(const square of [(kingSide?'h':'a')+rank,(kingSide?'f':'d')+rank]){const p=visualCell(square,this.side);ss.push(p.r*8+p.c);}
     }
     return ss;
   };
   const choices=moves.map(m=>{
     const changed=expectedSquares(m),values=changed.map(i=>scores[i]);
     const min=Math.min(...values);
     // Reward changed expected squares; confidence penalized by unlikely outside-square differences.
     const maxOutside=Math.max(0,...scores.filter((s,i)=>!changed.includes(i)));
     const score=values.reduce((a,b)=>a+b,0)/Math.sqrt(changed.length)-Math.max(0,maxOutside-background)*0.52;
     return {...m,score,min,maxOutside};
   }).sort((a,b)=>b.score-a.score);
   const top=choices[0],second=choices.find(x=>x.from!==top?.from||x.to!==top?.to);
   const threshold=Math.max(8,background*2.1);
   const credible=!!top && top.min>threshold && top.score>(second?.score||0)*1.08;
   return {credible,top,alternatives:choices.slice(0,3),background,threshold,
     message:credible?'تم التعرف على نقلة مرجّحة. راجعها واعتمدها.': 'التغير غير واضح أو توجد أكثر من نقلة محتملة. ثبّت الكاميرا، أبعد اليدين، أو سجّل النقلة من اللوحة.'};
 }
 syncReference(){if(this.stream&&this.corners.length===4&&!this.calibrating)this.reference=this.features(this.frame());}
}
