// Camera observation, NOT a trained piece recognizer. Detects changed squares between stable snapshots,
// then proposes a legal move based on those changes. Requires a fixed overhead camera.
const file='abcdefgh';
const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0;};
const quantile=(a,q)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor((b.length-1)*q)]:0;};
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
   this.side='w';this.latestFeatures=null;this.lastScan=null;
   this.arEnabled=true;this.arMove=null;this.frozenFrame=null;
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
   this.calibrating=false;this.corners=[];this.arMove=null;this.lastScan=null;this.drawOverlay();
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
   this.reference=null;this.lastScan=null;this.calibrating=true;this.corners=[];
   this.frozenFrame=this.frame();
   this.stage.classList.add('calibrating');
   this.message('اضغط على الزوايا بالترتيب: أعلى يسار ← أعلى يمين ← أسفل يمين ← أسفل يسار.');
 }
 tap(x,y){
   if(!this.calibrating)return false;
   this.corners.push({x,y});this.drawOverlay();
   if(this.corners.length===4){
     this.calibrating=false;this.frozenFrame=null;this.stage.classList.remove('calibrating');this.drawOverlay();
     this.message('تم تحديد الرقعة. ضع القطع في أماكنها واضغط «حفظ الوضع الحالي» بعد إبعاد اليدين.');
     return true;
   }
   this.message(`تم تحديد ${this.corners.length} من 4 زوايا.`);
   return false;
 }
 setSuggestedMove(move){
   this.arMove=move && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)?move:null;
   this.drawOverlay();
 }
 setArEnabled(enabled){this.arEnabled=enabled;this.drawOverlay();}
 drawOverlay(){
   const cx=this.ctx,{width:w,height:h}=this.canvas;
   if(!w||!h)return;
   cx.clearRect(0,0,w,h);
   if(this.calibrating&&this.frozenFrame)cx.putImageData(this.frozenFrame,0,0);
   if(!this.corners.length)return;
   cx.save();
   cx.strokeStyle='#c9f397';cx.lineWidth=3;
   cx.beginPath();cx.moveTo(this.corners[0].x,this.corners[0].y);
   for(let k=1;k<this.corners.length;k++)cx.lineTo(this.corners[k].x,this.corners[k].y);
   if(this.corners.length===4)cx.closePath();cx.stroke();
   for(let i=0;i<this.corners.length;i++){
     const p=this.corners[i];cx.fillStyle='#c9f397';
     cx.beginPath();cx.arc(p.x,p.y,6,0,Math.PI*2);cx.fill();
     if(this.calibrating){cx.font='bold 17px system-ui';cx.fillText(String(i+1),p.x+12,p.y-8);}
   }
   if(this.corners.length===4){
     cx.strokeStyle='rgba(204,255,175,.40)';cx.lineWidth=1;
     for(let i=1;i<8;i++){
       for(const [u,v,x,y] of [[i/8,0,i/8,1],[0,i/8,1,i/8]]){
         const a=this.point(u,v),b=this.point(x,y);
         cx.beginPath();cx.moveTo(a.x,a.y);cx.lineTo(b.x,b.y);cx.stroke();
       }
     }
     if(!this.calibrating&&this.arEnabled&&this.arMove)this.drawArrow(this.arMove);
   }
   cx.restore();
 }
 drawArrow(move){
   const f=visualCell(move.slice(0,2),this.side),t=visualCell(move.slice(2,4),this.side);
   const a=this.point((f.c+.5)/8,(f.r+.5)/8),b=this.point((t.c+.5)/8,(t.r+.5)/8);
   const d=Math.hypot(b.x-a.x,b.y-a.y);
   if(d<2)return;
   const ux=(b.x-a.x)/d,uy=(b.y-a.y)/d;
   const step=this.point((f.c+1.5)/8,(f.r+.5)/8);
   const scale=Math.max(20,Math.hypot(step.x-a.x,step.y-a.y));
   const thick=Math.max(5,Math.min(18,scale*.18));
   const head=Math.max(13,Math.min(35,scale*.45));
   const ax=b.x-ux*head*.65,ay=b.y-uy*head*.65;
   const cx=this.ctx;
   cx.save();cx.lineCap='round';cx.lineJoin='round';
   for(const [p,r] of [[a,scale*.23],[b,scale*.26]]){
     cx.beginPath();cx.arc(p.x,p.y,Math.max(r,8),0,Math.PI*2);
     cx.fillStyle='rgba(8,47,32,.85)';cx.fill();
     cx.strokeStyle='#d3ff9d';cx.lineWidth=2;cx.stroke();
   }
   cx.shadowColor='rgba(0,20,9,.8)';cx.shadowBlur=10;
   cx.beginPath();cx.moveTo(a.x+2,a.y+6);cx.lineTo(ax+2,ay+6);
   cx.lineWidth=thick+5;cx.strokeStyle='rgba(6,37,23,.9)';cx.stroke();cx.shadowBlur=0;
   const grad=cx.createLinearGradient(a.x,a.y,b.x,b.y);
   grad.addColorStop(0,'#ecffad');grad.addColorStop(1,'#63f5a9');
   cx.beginPath();cx.moveTo(a.x,a.y);cx.lineTo(ax,ay);
   cx.strokeStyle=grad;cx.lineWidth=thick;cx.stroke();
   cx.beginPath();cx.moveTo(b.x,b.y);
   cx.lineTo(b.x-ux*head-uy*head*.5,b.y-uy*head+ux*head*.5);
   cx.lineTo(b.x-ux*head+uy*head*.5,b.y-uy*head-ux*head*.5);
   cx.closePath();cx.fillStyle='#caff99';cx.strokeStyle='#103b29';cx.lineWidth=2;cx.fill();cx.stroke();
   const label=move.slice(0,2)+' → '+move.slice(2,4),font=Math.min(22,Math.max(13,scale*.32));
   cx.font='bold '+font+'px system-ui';
   const ww=cx.measureText(label).width+20;
   const x=Math.min(this.canvas.width-ww-2,Math.max(2,b.x-ww/2));
   const y=Math.max(font+5,Math.min(this.canvas.height-8,b.y+scale*.6+font));
   cx.fillStyle='rgba(8,35,28,.9)';cx.fillRect(x,y-font-5,ww,font+12);
   cx.fillStyle='#eaffd3';cx.fillText(label,x+10,y);cx.restore();
 }
 // Perspective mapping of the 8x8 square to the calibrated quadrilateral.
 point(u,v){
   const [a,b,c,d]=this.corners;
   if(!d)return {x:0,y:0};
   const dx1=b.x-c.x,dx2=d.x-c.x,dx3=a.x-b.x+c.x-d.x;
   const dy1=b.y-c.y,dy2=d.y-c.y,dy3=a.y-b.y+c.y-d.y;
   const det=dx1*dy2-dx2*dy1;
   if(Math.abs(det)<.00001){
     return {x:a.x*(1-u)*(1-v)+b.x*u*(1-v)+c.x*u*v+d.x*(1-u)*v,
       y:a.y*(1-u)*(1-v)+b.y*u*(1-v)+c.y*u*v+d.y*(1-u)*v};
   }
   const g=(dx3*dy2-dx2*dy3)/det,h=(dx1*dy3-dx3*dy1)/det;
   const X=b.x-a.x+g*b.x,Y=d.x-a.x+h*d.x;
   const P=b.y-a.y+g*b.y,Q=d.y-a.y+h*d.y;
   const z=g*u+h*v+1;
   return {x:(X*u+Y*v+a.x)/z,y:(P*u+Q*v+a.y)/z};
 }
 features(data){
   const arr=[];const W=data.width,H=data.height,p=data.data;
   for(let r=0;r<8;r++)for(let c=0;c<8;c++){
     const samples=[];
     for(let sy=0;sy<7;sy++)for(let sx=0;sx<7;sx++){
       const u=(c+.16+.68*sx/6)/8,v=(r+.16+.68*sy/6)/8;
       const pt=this.point(u,v);
       const x=Math.max(1,Math.min(W-2,Math.round(pt.x))),y=Math.max(1,Math.min(H-2,Math.round(pt.y)));
       let rgb=[0,0,0];
       for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){
         const off=((y+yy)*W+x+xx)*4;
         for(let k=0;k<3;k++)rgb[k]+=p[off+k]/9;
       }
       samples.push(rgb);
     }
     arr.push(samples);
   }
   return arr;
 }
 difference(base,now){
   const shifts=[[],[],[]];
   for(let i=0;i<64;i++)for(let j=0;j<base[i].length;j++){
     for(let k=0;k<3;k++)shifts[k].push(now[i][j][k]-base[i][j][k]);
   }
   const bias=shifts.map(median),scores=[];
   for(let i=0;i<64;i++){
     const ds=[];
     for(let j=0;j<base[i].length;j++){
       let delta=0;
       for(let k=0;k<3;k++)delta+=Math.abs(now[i][j][k]-base[i][j][k]-bias[k])/3;
       ds.push(delta);
     }
     scores.push(.48*quantile(ds,.5)+.52*quantile(ds,.78));
   }
   return scores;
 }
 saveReference(){
   if(this.corners.length!==4)throw Error('حدد زوايا الرقعة أولًا.');
   this.reference=this.features(this.frame());this.lastScan=null;this.latestFeatures=null;
   this.message('تم حفظ الصورة المرجعية. بعد تحريك قطعة وإبعاد اليدين، اضغط «قراءة النقلة بالكاميرا».');
 }
 propose(game){
   if(!this.reference)throw Error('احفظ الوضع الحالي أولًا.');
   const current=this.features(this.frame());
   const scores=this.difference(this.reference,current);
   const background=median(scores),p75=quantile(scores,.75);
   const threshold=Math.max(8,background*1.85,p75*1.3);
   const changed=scores.filter(s=>s>threshold).length;
   const motion=this.lastScan?this.difference(this.lastScan,current):null;
   this.lastScan=current;
   if(changed>11||(motion&&motion.filter(x=>x>Math.max(7,median(motion)*2.3)).length>=7)){
     this.latestFeatures=current;
     return {credible:false,unstable:true,alternatives:[],background,threshold,
       message:'الصورة غير مستقرة أو اليد تغطي الرقعة. ثبّت الهاتف وأبعد اليدين.'};
   }
   this.latestFeatures=current;
   const moves=game.moves({verbose:true});
   this.latestFeatures=current;
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
     const expected=expectedSquares(m),values=expected.map(i=>scores[i]);
     const unexplained=scores.filter((s,i)=>!expected.includes(i));
     const outsideStrong=unexplained.filter(s=>s>threshold).length;
     const score=values.reduce((sum,n)=>sum+Math.min(n,85),0)/Math.sqrt(expected.length)
        -outsideStrong*10-quantile(unexplained,.9)*.3;
     return {...m,score,min:Math.min(...values),outsideStrong};
   }).sort((a,b)=>b.score-a.score);
   const top=choices[0],second=choices.find(x=>x.from!==top?.from||x.to!==top?.to);
   const credible=!!top && top.min>threshold && top.outsideStrong<=2 &&
     top.score>Math.max(0,second?.score||0)*1.10 && top.score>12;
   return {credible,top,alternatives:choices.slice(0,3),background,threshold,
     message:credible?'تم التعرف على نقلة مرجّحة. راجعها واعتمدها.': 'التغير غير واضح أو توجد أكثر من نقلة محتملة. ثبّت الكاميرا، أبعد اليدين، أو سجّل النقلة من اللوحة.'};
 }
 syncReference(){if(this.stream&&this.corners.length===4&&!this.calibrating){
  this.reference=this.latestFeatures||this.features(this.frame());
  this.latestFeatures=null;this.lastScan=null;
 }}
}
