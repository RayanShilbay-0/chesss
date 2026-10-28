// Sparse real-piece detections. Missing ≠ empty: the camera can hide pieces.
import {tileToBoardIndex} from './physical-orientation.js';
const piece=p=>p?(p.color==='w'?p.type.toUpperCase():p.type):'1';
const chars=g=>g.board().flat().map(piece);
function observedMap(detections,side){
 const seen=new Map();
 for(const d of detections){
  if(!Number.isInteger(d.tile)||d.confidence<.28)continue;
  const idx=tileToBoardIndex(d.tile,side);
  const old=seen.get(idx);
  if(!old||old.confidence<d.confidence)seen.set(idx,{type:d.className,confidence:d.confidence});
 }
 return seen;
}
function evidenceScore(before,after,seen){
 let rating=0,explained=0,strong=0;
 for(const [i,d] of seen){
  if(before[i]===d.type)continue;
  if(after[i]===d.type){
    rating+=3.1*d.confidence;explained++;strong=Math.max(strong,d.confidence);
  }else rating-=.48*d.confidence;
 }
 for(let i=0;i<64;i++){
  if(before[i]===after[i])continue;
  const obs=seen.get(i);
  if(!obs){if(after[i]!=='1')rating-=.32;continue;}
  if(after[i]===obs.type&&before[i]!==obs.type)rating+=1.1*obs.confidence;
  else if(after[i]==='1'&&obs.type===before[i])rating-=2.9*obs.confidence;
  else if(after[i]!=='1'&&obs.type!==after[i])rating-=1.25*obs.confidence;
 }
 return {rating,explained,strong};
}
export function inferPhysicalMoves(game,detections,{orientation='w',whiteBottom,maxTwo=true}={}){
 const side=typeof whiteBottom==='boolean'?(whiteBottom?'w':'b'):orientation;
 const seen=observedMap(detections,side),before=chars(game);
 const unexpected=[...seen].filter(([i,d])=>before[i]!==d.type&&d.confidence>=.44).length;
 if(unexpected===0)return {kind:'unchanged',count:seen.size,reason:'no-visible-piece-change'};
 const candidates=[],first=game.moves({verbose:true});
 const consider=(seq,penalty)=>{
  const e=evidenceScore(before,chars(game),seen);
  candidates.push({...e,rating:e.rating-penalty,
   sequence:seq.map(m=>({from:m.from,to:m.to,promotion:m.promotion})),
   key:seq.map(m=>m.from+m.to+(m.promotion||'')).join(' '),
   position:game.fen().split(' ')[0]});
 };
 for(const m of first){game.move(m);consider([m],.15);game.undo();}
 candidates.sort((a,b)=>b.rating-a.rating);
 if(maxTwo&&unexpected>=2&&(candidates[0]?.explained||0)<unexpected){
  for(const m of first){
   game.move(m);
   if(!game.isGameOver())for(const n of game.moves({verbose:true})){
    game.move(n);consider([m,n],.65);game.undo();
   }
   game.undo();
  }
  candidates.sort((a,b)=>b.rating-a.rating);
 }
 const top=candidates[0];
 if(!top||top.explained<1||top.strong<.44||top.rating<2.1)
  return {kind:'uncertain',count:seen.size,reason:'missing-supported-change',best:top};
 const next=candidates.find(c=>c.position!==top.position);
 const margin=top.rating-(next?.rating??-Infinity);
 if(margin<1.2)return {kind:'uncertain',count:seen.size,margin,reason:'ambiguous',best:top};
 return {kind:'move',key:top.key,sequence:top.sequence,score:top.rating,
  confidence:top.strong,margin,count:seen.size,reason:'sparse-physical-evidence'};
}
