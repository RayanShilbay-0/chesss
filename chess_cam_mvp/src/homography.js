// Small dependency-free planar homography helpers (row-major 3x3 arrays).
// Used by board lattice fitting, the persistent board map and AR overlay so
// that browser code and Node tests share one implementation.
export function applyH(H,x,y){
  const z=H[6]*x+H[7]*y+H[8];
  return {x:(H[0]*x+H[1]*y+H[2])/z,y:(H[3]*x+H[4]*y+H[5])/z,z};
}
export function invertH(H){
  const [a,b,c,d,e,f,g,h,i]=H;
  const A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g;
  const det=a*A+b*B+c*C;
  if(!Number.isFinite(det)||Math.abs(det)<1e-12)return null;
  return [A/det,-(b*i-c*h)/det,(b*f-c*e)/det,
    B/det,(a*i-c*g)/det,-(a*f-c*d)/det,
    C/det,-(a*h-b*g)/det,(a*e-b*d)/det];
}
export function multiplyH(A,B){
  const out=new Array(9);
  for(let r=0;r<3;r++)for(let c=0;c<3;c++)
    out[r*3+c]=A[r*3]*B[c]+A[r*3+1]*B[3+c]+A[r*3+2]*B[6+c];
  return out;
}
function normalizer(points){
  let mx=0,my=0;
  for(const p of points){mx+=p.x;my+=p.y;}
  mx/=points.length;my/=points.length;
  let d=0;
  for(const p of points)d+=Math.hypot(p.x-mx,p.y-my);
  d=d/points.length||1;
  const s=Math.SQRT2/d;
  return {T:[s,0,-s*mx,0,s,-s*my,0,0,1],apply:p=>({x:(p.x-mx)*s,y:(p.y-my)*s})};
}
// Solve Ax=b (n x n) with partial pivoting. Returns null when singular.
function solve(A,b){
  const n=b.length;
  for(let col=0;col<n;col++){
    let pivot=col;
    for(let r=col+1;r<n;r++)if(Math.abs(A[r][col])>Math.abs(A[pivot][col]))pivot=r;
    if(Math.abs(A[pivot][col])<1e-12)return null;
    [A[col],A[pivot]]=[A[pivot],A[col]];[b[col],b[pivot]]=[b[pivot],b[col]];
    for(let r=col+1;r<n;r++){
      const f=A[r][col]/A[col][col];
      if(!f)continue;
      for(let k=col;k<n;k++)A[r][k]-=f*A[col][k];
      b[r]-=f*b[col];
    }
  }
  const x=new Array(n);
  for(let r=n-1;r>=0;r--){
    let s=b[r];
    for(let k=r+1;k<n;k++)s-=A[r][k]*x[k];
    x[r]=s/A[r][r];
  }
  return x;
}
// Least-squares DLT (h33=1) with Hartley normalization; >=4 correspondences.
export function solveHomography(src,dst){
  if(src.length<4||src.length!==dst.length)return null;
  const ns=normalizer(src),nd=normalizer(dst);
  const M=Array.from({length:8},()=>new Array(8).fill(0)),v=new Array(8).fill(0);
  for(let i=0;i<src.length;i++){
    const s=ns.apply(src[i]),d=nd.apply(dst[i]);
    const rows=[[s.x,s.y,1,0,0,0,-d.x*s.x,-d.x*s.y,d.x],[0,0,0,s.x,s.y,1,-d.y*s.x,-d.y*s.y,d.y]];
    for(const row of rows){
      for(let r=0;r<8;r++){
        if(!row[r])continue;
        for(let c=0;c<8;c++)M[r][c]+=row[r]*row[c];
        v[r]+=row[r]*row[8];
      }
    }
  }
  const h=solve(M,v);
  if(!h||!h.every(Number.isFinite))return null;
  const Hn=[...h,1];
  const inv=invertH(nd.T);
  if(!inv)return null;
  const H=multiplyH(multiplyH(inv,Hn),ns.T);
  const s=H[8];
  if(!Number.isFinite(s)||Math.abs(s)<1e-12)return null;
  return H.map(x=>x/s);
}
// Board-plane homography from four image corners (TL,TR,BR,BL) to unit
// coordinates (u,v) in [0,1]^2 and back.
export function boardToImageH(corners){
  return solveHomography([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],corners);
}
export const quadFromH=H=>[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>{
  const p=applyH(H,u,v);return {x:p.x,y:p.y};
});
