// Camera is independent of player color, and a handheld phone may rotate 90°.
export const CAMERA_DIRECTIONS=['w','b','l','r'];
export function tileToBoardIndex(tile,side='w'){
  const r=7-Math.floor(tile/8),c=tile%8;
  if(side==='b')return (7-r)*8+7-c;
  if(side==='l')return (7-c)*8+r;
  if(side==='r')return c*8+(7-r);
  return r*8+c;
}
export function visualSquare(file,rank,side='w'){
  const c='abcdefgh'.indexOf(file),r=8-Number(rank);
  if(side==='b')return {r:7-r,c:7-c};
  if(side==='l')return {r:c,c:7-r};
  if(side==='r')return {r:7-c,c:r};
  return {r,c};
}
// BoardMemory's camera corners remain anchored to the original physical
// squares during pan/zoom/rotation. A newly misidentified piece must never
// flip those coordinates in the middle of the game. Only an independently
// re-acquired complete board or a user choice may change this orientation.
export function retainMappedOrientation(current,proposal,lock){
  return current||lock.update(proposal);
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
// Orientation from the VERIFIED game position: for each camera direction,
// how well do the observed pieces agree with the known occupancy/colours?
// Colour centroids (physicalOrientation) flip once pieces leave their home
// ranks mid-game; the verified FEN does not. Returns null side if unclear.
export function orientationFromPosition(detections,position,{minMargin=1.5}={}){
  const scores=CAMERA_DIRECTIONS.map(side=>{
    let s=0;
    for(const d of detections){
      if(!Number.isInteger(d.tile)||d.confidence<.3)continue;
      const t=position[tileToBoardIndex(d.tile,side)],cls=d.className;
      if(t==='1')s-=d.confidence;
      else if(t===cls)s+=d.confidence;
      else if((t===t.toUpperCase())===(cls===cls.toUpperCase()))s+=.6*d.confidence;
      else s-=.5*d.confidence;
    }
    return {side,score:s};
  }).sort((a,b)=>b.score-a.score);
  const margin=scores[0].score-scores[1].score;
  return {side:margin>=minMargin?scores[0].side:null,verified:margin>=minMargin,margin,scores};
}
