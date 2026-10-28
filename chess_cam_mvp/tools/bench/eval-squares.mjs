// Score benchmark predictions against per-image FEN labels.
// usage: node tools/bench/eval-squares.mjs predictions.json labels.json
// labels.json: {"<file>": {"fen": "<placement>", "white_side": "w|b|l|r"|null}}
// Square keys in predictions are "r,c" in the board-quad frame (r from v).
import {readFile} from 'node:fs/promises';
import {Chess} from 'chess.js';
import {tileToBoardIndex,physicalOrientation} from '../../src/physical-orientation.js';
import {mapPhysicalDetections} from '../../src/physical-geometry.js';
import {boardToImageH,applyH} from '../../src/homography.js';
// --remap: recompute square assignment with the app's mapPhysicalDetections
// (instead of the legacy bottom-w/3 mapping stored by bench_photos.py).
const remap=process.argv.includes('--remap');
const [predPath,labelPath]=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const preds=JSON.parse(await readFile(predPath,'utf8'));
const labels=JSON.parse(await readFile(labelPath,'utf8'));
const boardChars=fen=>new Chess(fen.split(' ').length>1?fen:fen+' w - - 0 1')
  .board().flat().map(p=>p?(p.color==='w'?p.type.toUpperCase():p.type):'1');
const total={images:0,boards:0,mapped:0,occupied:0,color:0,exact:0,orientOk:0,orientKnown:0};
const rows=[];
for(const p of preds){
  p.file=p.file.split(String.fromCharCode(92)).join('/');
  const label=labels[p.file];
  if(!label)continue;
  total.images++;
  if(!p.quad_found){rows.push({file:p.file,board:false});continue;}
  total.boards++;
  const truth=boardChars(label.fen);
  let dets;
  if(remap){
    const H=boardToImageH(p.quad.map(([x,y])=>({x,y})));
    const point=(u,v)=>{const q=applyH(H,u,v);return {x:q.x,y:q.y};};
    dets=mapPhysicalDetections(p.pieces.map(d=>({cx:d.cx,cy:d.cy,w:d.w,h:d.h,
      className:d.cls,confidence:d.conf})),point).detections;
  }else dets=Object.entries(p.squares).map(([k,v])=>{
    const [r,c]=k.split(',').map(Number);
    return {tile:(7-r)*8+c,className:v.cls,confidence:v.conf};
  });
  const auto=physicalOrientation(dets);
  const score=side=>{
    let occ=0,col=0,ex=0;
    for(const d of dets){
      const t=truth[tileToBoardIndex(d.tile,side)];
      if(t!=='1'){occ++;
        if((t===t.toUpperCase())===(d.className===d.className.toUpperCase()))col++;
        if(t===d.className)ex++;}
    }
    return {occ,col,ex};
  };
  // Oracle orientation: geometry quality is measured independent of the
  // colour-based orientation vote, which is scored separately against it.
  const side=['w','b','l','r'].map(x=>({x,s:score(x)}))
    .sort((a,b)=>b.s.ex-a.s.ex||b.s.col-a.s.col)[0].x;
  const s=score(side);
  total.mapped+=dets.length;total.occupied+=s.occ;total.color+=s.col;total.exact+=s.ex;
  if(dets.length>=6){total.orientKnown++;if(auto.side===side)total.orientOk++;}
  rows.push({file:p.file,board:true,mapped:dets.length,occupied:s.occ,color:s.col,exact:s.ex,
    side,autoSide:auto.side,expectedPieces:truth.filter(x=>x!=='1').length});
}
const pct=(a,b)=>b?(100*a/b).toFixed(1)+'%':'n/a';
console.table(rows.map(r=>({...r,file:r.file.replace(/^.*photo_(\d+).*$/,'photo_$1').replace(/^.*(frame_\d+).*$/,'$1')})));
console.log(JSON.stringify({...total,
  board_found_rate:pct(total.boards,total.images),
  square_occupancy_precision:pct(total.occupied,total.mapped),
  color_precision:pct(total.color,total.mapped),
  exact_piece_precision:pct(total.exact,total.mapped),
  auto_orientation_accuracy:pct(total.orientOk,total.orientKnown)},null,1));
