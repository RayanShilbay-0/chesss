// Guard against a partial-board homography: the 7x7 X-corners and
// the physical pieces must lie in a FULL 8x8 calibrated quadrilateral.
export function boardPoint(q,u,v){
 const [a,b,c,d]=q;
 const x1=b.x-c.x,x2=d.x-c.x,x3=a.x-b.x+c.x-d.x;
 const y1=b.y-c.y,y2=d.y-c.y,y3=a.y-b.y+c.y-d.y;
 const det=x1*y2-x2*y1;
 if(Math.abs(det)<1e-7)return {x:a.x*(1-u)*(1-v)+b.x*u*(1-v)+c.x*u*v+d.x*(1-u)*v,
 y:a.y*(1-u)*(1-v)+b.y*u*(1-v)+c.y*u*v+d.y*(1-u)*v};
 const g=(x3*y2-x2*y3)/det,h=(x1*y3-x3*y1)/det,z=g*u+h*v+1;
 return {x:((b.x-a.x+g*b.x)*u+(d.x-a.x+h*d.x)*v+a.x)/z,
 y:((b.y-a.y+g*b.y)*u+(d.y-a.y+h*d.y)*v+a.y)/z};
}
export function inverseBoardPoint(q,x,y){
 let u=.5,v=.5;
 for(let i=0;i<15;i++){
  const p=boardPoint(q,u,v),pu=boardPoint(q,u+.001,v),pv=boardPoint(q,u,v+.001);
  const a=(pu.x-p.x)*1000,b=(pv.x-p.x)*1000,c=(pu.y-p.y)*1000,d=(pv.y-p.y)*1000;
  const det=a*d-b*c;if(!Number.isFinite(det)||Math.abs(det)<1e-7)return null;
  const dx=x-p.x,dy=y-p.y,du=(d*dx-b*dy)/det,dv=(a*dy-c*dx)/det;
  u+=Math.max(-.6,Math.min(.6,du));v+=Math.max(-.6,Math.min(.6,dv));
  if(Math.abs(du)+Math.abs(dv)<.00001)break;
 }
 return Number.isFinite(u)&&Number.isFinite(v)?{u,v}:null;
}
const percentile=(a,p)=>{
 if(!a.length)return NaN;const b=[...a].sort((x,y)=>x-y);
 return b[Math.floor((b.length-1)*p)];
};
export function scoreChessboardQuad(corners,gridPoints,pieceAnchors=[]){
 if(corners?.length!==4)return {valid:false,reason:'no-quad'};
 const points=gridPoints.map(p=>inverseBoardPoint(corners,p.x,p.y)).filter(Boolean);
 const cells=new Set(),columns=new Set(),rows=new Set();
 for(const {u,v} of points){
  const col=Math.round(u*8),row=Math.round(v*8);
  if(col<1||col>7||row<1||row>7)continue;
  if(Math.hypot(col-u*8,row-v*8)<.27){
    cells.add(row*8+col);columns.add(col);rows.add(row);
  }
 }
 const gridValid=points.length>=18&&cells.size>=18&&
  columns.size>=5&&rows.size>=5&&cells.size/Math.max(1,points.length)>=.48;
 let inside=0,total=0;
 for(const p of pieceAnchors){
  if((p.confidence??1)<.4)continue;
  const uv=inverseBoardPoint(corners,p.x,p.y);if(!uv)continue;
  total++;
  if(uv.u>=-.08&&uv.u<=1.08&&uv.v>=-.08&&uv.v<=1.08)inside++;
 }
 const coverage=total?inside/total:null;
 const pieceValid=total<12||coverage>=.84;
 return {valid:gridValid&&pieceValid,gridValid,pieceValid,
  aligned:cells.size,cols:columns.size,rows:rows.size,
  coverage,inside,total,reason:!gridValid?'partial-grid':!pieceValid?'pieces-outside':'ok'};
}
export function expandQuadToPieces(corners,pieceAnchors){
 const uv=pieceAnchors.filter(p=>(p.confidence??1)>=.5)
  .map(p=>inverseBoardPoint(corners,p.x,p.y)).filter(p=>p&&
    p.u>-.6&&p.u<2.1&&p.v>-.6&&p.v<2.1);
 if(uv.length<16)return null;
 const us=uv.map(p=>p.u),vs=uv.map(p=>p.v);
 const lowU=percentile(us,.06),highU=percentile(us,.94);
 const lowV=percentile(vs,.06),highV=percentile(vs,.94);
 const u0=lowU-(highU-lowU)/14,u1=highU+(highU-lowU)/14;
 const v0=lowV-(highV-lowV)/14,v1=highV+(highV-lowV)/14;
 if(u1-u0<.7||u1-u0>2.4||v1-v0<.7||v1-v0>2.4)return null;
 return [boardPoint(corners,u0,v0),boardPoint(corners,u1,v0),
    boardPoint(corners,u1,v1),boardPoint(corners,u0,v1)];
}
