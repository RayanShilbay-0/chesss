import { recognizeSequence } from './detector.js';
import { shouldRefreshBaseline } from './tracking-policy.js';
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
   this.arEnabled=true;this.arMove=null;this.frozenFrame=null;this.poseValid=true;
   this.occupancyModel=null;this.referenceSetAt=0;this.sourceKind='camera';
   this.stillFrames=0;this.autoRefreshCount=0;this.latestMotion=null;
 }
 async start(){
   if(!navigator.mediaDevices?.getUserMedia)
     throw new Error('فتح كاميرا المتصفح يتطلب HTTPS أو localhost.');
   const stream=await navigator.mediaDevices.getUserMedia({
     video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},
     audio:false
   });
   return this.connect(stream,'camera');
 }
 async startScreen(){
   if(!navigator.mediaDevices?.getDisplayMedia)
     throw new Error('قراءة نافذة الكمبيوتر غير مدعومة على هذا المتصفح. افتح ChessCam على Chrome أو Edge بكمبيوتر، أو استخدم كاميرا الهاتف.');
   // Browser requires an explicit user gesture and always shows the window picker.
   const stream=await navigator.mediaDevices.getDisplayMedia({
     video:{frameRate:{ideal:10}},audio:false
   });
   return this.connect(stream,'screen');
 }
 async connect(stream,kind){
   if(this.stream)this.stop();
   this.stream=stream;this.sourceKind=kind;
   this.video.srcObject=stream;
   try{
     await this.video.play();
     const sourceWidth=this.video.videoWidth||960,sourceHeight=this.video.videoHeight||720;
     const w=Math.min(kind==='screen'?1280:960,sourceWidth);
     const h=Math.round(w*sourceHeight/sourceWidth);
     this.canvas.width=w;this.canvas.height=h;
     this.stage.style.aspectRatio=`${w} / ${h}`;
     this.stage.classList.add('playing');
     this.calibrating=false;this.corners=[];this.reference=null;
     this.lastScan=null;this.latestFeatures=null;this.occupancyModel=null;this.stillFrames=0;this.latestMotion=null;
     stream.getVideoTracks()[0]?.addEventListener('ended',()=>{
       if(this.stream===stream){
         this.stop();
         this.message('توقف بث نافذة الشطرنج. يمكنك مشاركة النافذة مرة أخرى.');
       }
     },{once:true});
     this.message(kind==='screen'?
       'تمت مشاركة النافذة. حدد زوايا الرقعة التي تظهر داخل الفيديو، ثم احفظ الوضع قبل أول نقلة.':
       'الكاميرا جاهزة. الآن اضغط تحديد زوايا الرقعة.');
   }catch(err){
     stream.getTracks().forEach(track=>track.stop());
     this.stop();throw err;
   }
 }

 stop(){
   this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;
   this.video.srcObject=null;this.reference=null;this.latestFeatures=null;this.occupancyModel=null;this.referenceSetAt=0;
   this.stillFrames=0;this.latestMotion=null;
   this.calibrating=false;this.corners=[];this.arMove=null;this.lastScan=null;this.drawOverlay();
   this.sourceKind='camera';
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
   this.reference=null;this.lastScan=null;this.occupancyModel=null;this.calibrating=true;this.corners=[];
   this.stillFrames=0;this.latestMotion=null;
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
     if(!this.calibrating&&this.poseValid!==false&&this.arEnabled&&this.arMove)this.drawArrow(this.arMove);
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
     // Background probes near the square edges remain mostly unoccluded by pieces.
     // This also permits occupancy detection when a move changes only subtle pixels.
     const edges=[[.09,.09],[.09,.91],[.91,.09],[.91,.91],[.09,.5],[.91,.5],[.5,.09],[.5,.91]];
     for(const [u,v] of edges){
       const pt=this.point((c+u)/8,(r+v)/8);
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
   // A chess website often highlights the two squares of its last move.
   // Local texture removes most flat square-color changes without removing piece detail.
   const all=[[],[],[]];
   for(let i=0;i<64;i++)for(let j=0;j<base[i].length;j++)
     for(let k=0;k<3;k++)all[k].push(now[i][j][k]-base[i][j][k]);
   const global=all.map(median),scores=[];
   for(let i=0;i<64;i++){
     const dx=[[],[],[]];
     for(let j=0;j<base[i].length;j++)for(let k=0;k<3;k++)
       dx[k].push(now[i][j][k]-base[i][j][k]-global[k]);
     const local=dx.map(median),raw=[],detail=[];
     for(let j=0;j<base[i].length;j++){
       let a=0,b=0;
       for(let k=0;k<3;k++){
         a+=Math.abs(dx[k][j])/3;
         b+=Math.abs(dx[k][j]-local[k])/3;
       }
       raw.push(a);detail.push(b);
     }
     const absScore=.48*quantile(raw,.5)+.52*quantile(raw,.78);
     const patternScore=.42*quantile(detail,.5)+.58*quantile(detail,.78);
     scores.push(.24*absScore+1.12*patternScore);
   }
   return scores;
 }
 occupancyScores(features){
   return features.map(samples=>{
     if(samples.length<57)return 0;
     const corners=samples.slice(49,57);
     const background=[0,1,2].map(k=>median(corners.map(pixel=>pixel[k])));
     const values=samples.slice(0,49).map(pixel=>
       (Math.abs(pixel[0]-background[0])+
        Math.abs(pixel[1]-background[1])+
        Math.abs(pixel[2]-background[2]))/3
     );
     return quantile(values,.72);
   });
 }
 modelFor(features,game){
   const s=this.occupancyScores(features);
   const occupied=game.board().flat().map(Boolean);
   const emptyStrength=s.filter((_,i)=>!occupied[i]);
   const occupiedStrength=s.filter((_,i)=>occupied[i]);
   const emptyHigh=quantile(emptyStrength,.9),occupiedLow=quantile(occupiedStrength,.2);
   const separation=occupiedLow-emptyHigh;
   const reliable=emptyStrength.length>=8&&occupiedStrength.length>=5&&separation>=5;
   const threshold=(emptyHigh+occupiedLow)/2;
   const guard=Math.max(1.5,Math.min(6,separation*.14));
   const baselineMismatch=s.reduce((count,value,i)=>{
     if(!reliable)return count;
     if(occupied[i]&&value<threshold-guard)return count+1;
     if(!occupied[i]&&value>threshold+guard)return count+1;
     return count;
   },0);
   return {reliable,threshold,guard,separation,baselineMismatch,
     occupiedStrength:occupiedLow,emptyStrength:emptyHigh};
 }
 saveReference(game){
   if(this.corners.length!==4)throw Error('حدد زوايا الرقعة أولًا.');
   const features=this.features(this.frame());
   const model=game?this.modelFor(features,game):null;
   this.reference=features;this.occupancyModel=model;
   this.lastScan=null;this.latestFeatures=null;this.referenceSetAt=Date.now();
   this.stillFrames=0;this.latestMotion=null;
   if(model?.reliable&&model.baselineMismatch>=4)
     this.message('تحذير: يبدو أن توزيع القطع في كاميرا الرقعة يختلف عن اللوحة الرقمية. لن تكون التحليلات موثوقة قبل تصحيح الوضعيتين.');
   else this.message('تم حفظ الصورة المرجعية. المراقبة تقارن شكل القطع وتغيّر المربعات من هذه اللحظة.');
   return model;
 }
 propose(game){
   if(!this.reference)throw Error('احفظ الوضع الحالي أولًا.');
   const current=this.features(this.frame());
   const scores=this.difference(this.reference,current);
   const background=median(scores),p75=quantile(scores,.75);
   const threshold=Math.max(6,background*2.1,p75*1.45);
   const changed=scores.filter(s=>s>threshold).length;
   const currentOccupancy=this.occupancyScores(current);
   const motion=this.lastScan?this.difference(this.lastScan,current):null;
   const still=Boolean(motion&&motion.filter(x=>x>7).length<=2&&quantile(motion,.85)<5);
   this.stillFrames=still?this.stillFrames+1:0;
   this.latestMotion=motion;
   this.lastScan=current;
   if(changed>12||(motion&&changed>=5&&motion.filter(x=>x>Math.max(11,median(motion)*2.8)).length>12)){
     this.latestFeatures=current;
     return {credible:false,unstable:true,reason:'many-changes',changed,threshold,
       message:'الكاميرا تحركت أو حدث تغيير كبير بالصورة. ثبّت الهاتف وأبعد اليد عن الرقعة. إذا تغيرت الزاوية، أعد تحديد الزوايا وحفظ المرجع.'};
   }
   this.latestFeatures=current;
   const result=recognizeSequence(game,scores,threshold,{
     occupancy:this.occupancyModel?.reliable?{
       reliable:true,
       current:currentOccupancy,
       threshold:this.occupancyModel.threshold,
       guard:this.occupancyModel.guard
     }:null
   });
   const totalChanged=result.observed?.length||changed;
   if(result.credible){
     return {...result,changed:totalChanged,threshold,
       message:result.top.sequence.length===2?
        'تم التعرف على نقلتين متتاليتين. راجع النقلتين قبل الاعتماد.':
        'تم التعرف على نقلة مرجحة. راجعها قبل الاعتماد.'};
   }
   if(result.reason==='no-change'){
     return {...result,changed:totalChanged,threshold,
       message:'لا يوجد تغيّر واضح منذ التقاط المرجع. إذا بدأت المباراة قبل حفظ المرجع، أعد ضبط الرقعتين والتقط المرجع قبل النقلة الأولى.'};
   }
   return {...result,changed:totalChanged,threshold,
     message:'الكاميرا رصدت تغيّرًا لكن لم تطابقه بثقة مع تسلسل النقلات القانونية. تأكد من مطابقة لوحة ChessCam للرقعة المصورة.'};
 }

 // Verifies agreement with the CURRENT legal game state; never guesses moves
 // by periodically discarding unprocessed video differences.
 referenceAgreement(game,features){
   const model=this.occupancyModel;
   if(!model?.reliable||!features)return {reliable:false,mismatches:64,confident:0};
   const values=this.occupancyScores(features);
   const occupied=game.board().flat().map(Boolean);
   let mismatches=0,confident=0;
   for(let i=0;i<64;i++){
     if(values[i]<model.threshold-model.guard){
       confident++;if(occupied[i])mismatches++;
     }else if(values[i]>model.threshold+model.guard){
       confident++;if(!occupied[i])mismatches++;
     }
   }
   return {reliable:true,mismatches,confident};
 }
 autoRefresh(game,{credible=false,changed=0,unstable=false}={},now=Date.now()){
   if(!this.reference||!this.latestFeatures||!game||unstable)
     return {ok:false,reason:'unavailable'};
   const agreement=this.referenceAgreement(game,this.latestFeatures);
   const strengths=this.difference(this.reference,this.latestFeatures);
   const near=quantile(strengths,.95)<1.5;
   const gate=shouldRefreshBaseline({
     ageMs:now-this.referenceSetAt,stableFrames:this.stillFrames,
     pending:false,credible,inMotion:unstable,
     changed,reliable:agreement.reliable,mismatches:agreement.mismatches,
     confident:agreement.confident,nearlyIdentical:near
   });
   if(!gate.ok)return gate;
   // Use the exact frame that was verified, not a later camera frame where
   // the opponent may already have made another move.
   const snap=this.latestFeatures;
   const model=this.modelFor(snap,game);
   if(model?.reliable&&model.baselineMismatch>=3)
     return {ok:false,reason:'calibration-mismatch'};
   this.reference=snap;this.occupancyModel=model;
   this.lastScan=snap;this.latestMotion=null;this.stillFrames=0;
   this.referenceSetAt=now;this.autoRefreshCount++;
   return {ok:true,reason:gate.reason,count:this.autoRefreshCount};
 }
 syncReference(game){
   if(!this.stream||this.corners.length!==4||this.calibrating)return {ok:false,reason:'camera'};
   // The frame that yielded the recognized move is the authoritative baseline.
   // Recapturing later could accidentally swallow the bot's NEXT move.
   const now=this.latestFeatures||this.features(this.frame());
   const model=game?this.modelFor(now,game):null;
   this.reference=now;this.occupancyModel=model;this.latestFeatures=null;
   this.lastScan=now;this.referenceSetAt=Date.now();
   this.stillFrames=0;this.latestMotion=null;
   if(model?.reliable&&model.baselineMismatch>=4)
     return {ok:false,reason:'mismatch',count:model.baselineMismatch};
   return {ok:true,model};
 }
}
