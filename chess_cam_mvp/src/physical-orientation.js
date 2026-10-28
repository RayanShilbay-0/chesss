// Camera is independent of player color, and a handheld phone may rotate 90°.
export const CAMERA_DIRECTIONS=['w','b','l','r'];
export function tileToBoardIndex(tile,side='w'){
  const r=7-Math.floor(tile/8),c=tile%8;
  if(side==='b')return r*8+7-c;
  if(side==='l')return (7-c)*8+r;
  if(side==='r')return c*8+(7-r);
  return (7-r)*8+c;
}
export function visualSquare(file,rank,side='w'){
  const c='abcdefgh'.indexOf(file),r=8-Number(rank);
  if(side==='b')return {r:7-r,c:7-c};
  if(side==='l')return {r:c,c:7-r};
  if(side==='r')return {r:7-c,c:r};
  return {r,c};
}
export function physicalOrientation(detections){
  const sums={P:{x:0,y:0,n:0},p:{x:0,y:0,n:0}};
  for(const d of detections){
    if(d.confidence<.4||!Number.isInteger(d.tile))continue;
    const white=d.className===d.className.toUpperCase()?'P':'p';
    const obj=sums[white];
    const row=7-Math.floor(d.tile/8),col=d.tile%8;
    obj.x+=(col+.5)/8*d.confidence;obj.y+=(row+.5)/8*d.confidence;
    obj.n+=d.confidence;
  }
  if(sums.P.n<2.2||sums.p.n<2.2)
    return {side:null,verified:false,margin:0};
  const dx=sums.P.x/sums.P.n-sums.p.x/sums.p.n;
  const dy=sums.P.y/sums.P.n-sums.p.y/sums.p.n;
  const margin=Math.max(Math.abs(dx),Math.abs(dy));
  // The colors occupy opposite sides, even when seen from a rotated phone.
  if(margin<.18)return {side:null,verified:false,margin};
  const side=Math.abs(dx)>Math.abs(dy)*1.12?(dx<0?'l':'r'):(dy>0?'w':'b');
  return {side,verified:true,margin,white:sums.P.n,black:sums.p.n};
}
