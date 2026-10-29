// Sparse real-piece detections. Missing ≠ empty: the camera can hide pieces.
import {tileToBoardIndex} from './physical-orientation.js';
const piece=p=>p?(p.color==='w'?p.type.toUpperCase():p.type):'1';
const chars=g=>g.board().flat().map(piece);
const sameColour=(a,b)=>a!=='1'&&b!=='1'&&
  (a===a.toUpperCase())===(b===b.toUpperCase());
const isNovelObservation=(before,observed)=>
  before==='1'||!sameColour(before,observed.type);
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
// Temporal per-square evidence since the last VERIFIED position. Single
// LeYOLO frames miss pieces; accumulating decayed scores lets a piece seen in
// most recent scans count, and lets a square that stays visibly empty while
// the board pose is trusted count as weak 'vacated' evidence. Squares never
// visible are simply unknown (never treated as empty).
export class SquareEvidence{
  constructor({decay=.55,minScore=.5,emptyAfter=2}={}){
    this.decay=decay;this.minScore=minScore;this.emptyAfter=emptyAfter;this.reset('');
  }
  reset(key){this.key=key;this.scores=new Map();this.missing=new Map();this.scans=0;}
  // observed: Map(boardIndex -> {type,confidence}); visible: Set(boardIndex)
  add(key,observed,visible=new Set()){
    if(key!==this.key)this.reset(key);
    this.scans++;
    for(const [i,m] of this.scores){
      for(const t of Object.keys(m)){m[t]*=this.decay;if(m[t]<.05)delete m[t];}
      if(!Object.keys(m).length)this.scores.delete(i);
    }
    for(const [i,d] of observed){
      const m=this.scores.get(i)||{};
      m[d.type]=(m[d.type]||0)+d.confidence;this.scores.set(i,m);
      this.missing.delete(i);
    }
    for(const i of visible)if(!observed.has(i))this.missing.set(i,(this.missing.get(i)||0)+1);
    for(const i of [...this.missing.keys()])if(!visible.has(i)&&!observed.has(i))this.missing.delete(i);
  }
  // Observed map in the shape inferPhysicalMoves expects, plus empty set.
  snapshot(){
    const seen=new Map(),empty=new Set();
    for(const [i,m] of this.scores){
      let best=null,score=0,total=0;
      for(const [t,v] of Object.entries(m)){total+=v;if(v>score){score=v;best=t;}}
      // Normalise to a confidence: agreement across scans, capped below 1.
      if(score>=this.minScore){
        const sameColor=Object.entries(m).reduce((sum,[type,value])=>
          sum+(sameColour(type,best)?value:0),0);
        seen.set(i,{type:best,
          confidence:Math.min(.97,score/Math.max(total,1)*Math.min(1,score)),
          colorConfidence:Math.min(.97,sameColor/Math.max(total,1)*Math.min(1,sameColor))});
      }
    }
    for(const [i,n] of this.missing)if(n>=this.emptyAfter&&!seen.has(i))empty.add(i);
    return {seen,empty};
  }
}
function evidenceScore(before,after,seen,empty=new Set()){
 let rating=0,explained=0,strong=0,colorOnly=0;
 for(const [i,d] of seen){
  if(before[i]===d.type)continue;
  if(after[i]===d.type){
    rating+=3.1*d.confidence;explained++;strong=Math.max(strong,d.confidence);
  }else if(sameColour(after[i],d.type)&&isNovelObservation(before[i],d)){
    // The wooden piece may be called B/P or R/Q at a steep camera angle.
    // Colour + a previously empty/opponent-occupied destination is useful
    // evidence, but less trustworthy than an exact class match.
    const conf=d.colorConfidence??d.confidence;
    rating+=2.1*conf;explained++;strong=Math.max(strong,conf);
    colorOnly++;
  }else rating-=.48*d.confidence;
 }
 for(let i=0;i<64;i++){
  if(before[i]===after[i])continue;
  const obs=seen.get(i);
  if(!obs){
   if(after[i]!=='1')rating-=.32;
   // A vacated source square that stays visibly empty supports the move.
   else if(empty.has(i))rating+=.55;
   continue;
  }
  if(after[i]===obs.type&&before[i]!==obs.type)rating+=1.1*obs.confidence;
  else if(after[i]==='1'&&obs.type===before[i])rating-=2.9*obs.confidence;
  else if(after[i]!=='1'&&sameColour(after[i],obs.type)&&
          isNovelObservation(before[i],obs))
    rating+=.72*(obs.colorConfidence??obs.confidence);
  else if(after[i]!=='1'&&obs.type!==after[i])rating-=1.25*obs.confidence;
 }
 return {rating,explained,strong,colorOnly};
}
export function observedSquares(detections,side){return observedMap(detections,side);}
export function inferPhysicalMoves(game,detections,{orientation='w',whiteBottom,maxTwo=true,observed=null,empty=new Set()}={}){
 const side=typeof whiteBottom==='boolean'?(whiteBottom?'w':'b'):orientation;
 const seen=observed||observedMap(detections,side),before=chars(game);
 const newPieces=[...seen].filter(([i,d])=>isNovelObservation(before[i],d)&&
   Math.max(d.confidence,d.colorConfidence??0)>=.44);
 const unexpected=newPieces.length;
 if(unexpected===0)return {kind:'unchanged',count:seen.size,reason:'no-visible-piece-change',twoPlyConsidered:0};
 const candidates=[],first=game.moves({verbose:true});
 const consider=(seq,penalty)=>{
  const e=evidenceScore(before,chars(game),seen,empty);
  candidates.push({...e,rating:e.rating-penalty,
   sequence:seq.map(m=>({from:m.from,to:m.to,promotion:m.promotion})),
   key:seq.map(m=>m.from+m.to+(m.promotion||'')).join(' '),
   position:game.fen().split(' ')[0]});
 };
 for(const m of first){game.move(m);consider([m],.15);game.undo();}
 candidates.sort((a,b)=>b.rating-a.rating);
 // Two legal moves are needed only if BOTH colours gained a new visible
 // piece (a player move followed by a fast bot response). A single move with
 // noisy LeYOLO boxes must never trigger ~1,000 legal-board evaluations on
 // the main browser thread.
 const colours=new Set(newPieces.map(([,d])=>d.type===d.type.toUpperCase()?'w':'b'));
 let twoPlyConsidered=0;
 if(maxTwo&&unexpected>=2&&colours.size===2&&
    (candidates[0]?.explained||0)<unexpected){
  for(const m of first){
   game.move(m);
   const interim=chars(game);
   // A first move has to explain an observed NEW destination; otherwise
   // it cannot be the first half of a two-ply visual sequence.
   if(newPieces.some(([i,d])=>interim[i]===d.type)){
    if(!game.isGameOver())for(const n of game.moves({verbose:true})){
      game.move(n);consider([m,n],.65);twoPlyConsidered++;game.undo();
    }
   }
   game.undo();
  }
  candidates.sort((a,b)=>b.rating-a.rating);
 }
 const top=candidates[0];
 if(!top||top.explained<1||top.strong<.44||top.rating<2.1)
  return {kind:'uncertain',count:seen.size,reason:'missing-supported-change',best:top,twoPlyConsidered};
 const next=candidates.find(c=>c.position!==top.position);
 const margin=top.rating-(next?.rating??-Infinity);
 if(margin<1.2)return {kind:'uncertain',count:seen.size,margin,reason:'ambiguous',best:top,twoPlyConsidered};
 return {kind:'move',key:top.key,sequence:top.sequence,score:top.rating,
  confidence:top.strong,margin,count:seen.size,reason:'sparse-physical-evidence',
  typeRelaxed:top.colorOnly>0,
  explained:top.explained,twoPlyConsidered};
}

// Occlusion: a hand/arm hides many pieces at once. Detector recall varies
// with distance and angle, so compare against the recent detection counts
// for this view rather than the number of pieces the position predicts.
export class OcclusionGuard{
  constructor({window=8,ratio=.55,minHistory=3,viewShift=.17,rebaseAfter=7}={}){
    this.window=window;this.ratio=ratio;this.minHistory=minHistory;
    this.viewShift=viewShift;this.rebaseAfter=rebaseAfter;this.reset();
  }
  reset(){this.counts=[];this.views=[];this.low=[];}
  update(count,visibleFraction=1){
    const view=Math.max(0,Math.min(1,visibleFraction));
    const medianOf=a=>{const sorted=[...a].sort((x,y)=>x-y);return sorted[sorted.length>>1];};
    const median=this.counts.length?medianOf(this.counts):null;
    const priorView=this.views.length?medianOf(this.views):null;
    // A pan/zoom changes the observable board area; it is NOT a hand
    // occluding an otherwise unchanged camera view.
    const viewChanged=priorView!==null&&Math.abs(view-priorView)>=this.viewShift;
    if(viewChanged)this.reset();
    const reference=this.counts.length>=this.minHistory?medianOf(this.counts):null;
    const occluded=reference!==null&&count<reference*this.ratio;
    if(occluded){
      this.low.push(count);
      if(this.low.length>this.rebaseAfter)this.low.shift();
      // A steady, lasting reduced view can otherwise remain occluded
      // forever. No instantaneous jump, and no guess while visibility is
      // changing rapidly.
      if(this.low.length>=this.rebaseAfter&&
          Math.max(...this.low)-Math.min(...this.low)<=3&&count>=4){
        this.reset();this.counts.push(count);this.views.push(view);
        return {occluded:false,median:count,viewChanged:true,reacquired:true};
      }
    }else{
      this.low=[];
      this.counts.push(count);this.views.push(view);
      if(this.counts.length>this.window){this.counts.shift();this.views.shift();}
    }
    return {occluded,median:reference??count,viewChanged};
  }
}
// Orientation lock: the board map keeps fixed board coordinates, so the
// camera-facing side only changes after a new acquisition. Switch only on
// sustained, clear evidence.
export class OrientationLock{
  constructor({switchAfter=4,switchMargin=3}={}){this.switchAfter=switchAfter;this.switchMargin=switchMargin;this.reset();}
  reset(){this.side=null;this.challenger=null;this.hits=0;}
  update(vote){
    if(!vote?.verified)return this.side;
    if(!this.side){
      // First lock: two agreeing votes, or one clear vote.
      if(vote.side===this.challenger)this.hits++;else{this.challenger=vote.side;this.hits=1;}
      if(this.hits>=2||vote.margin>=3){this.side=vote.side;this.challenger=null;this.hits=0;}
      return this.side;
    }
    if(vote.side===this.side){this.challenger=null;this.hits=0;return this.side;}
    // Weak votes from a few pieces cannot overturn an established lock.
    if(vote.margin<this.switchMargin)return this.side;
    if(vote.side===this.challenger)this.hits++;else{this.challenger=vote.side;this.hits=1;}
    if(this.hits>=this.switchAfter){this.side=vote.side;this.challenger=null;this.hits=0;}
    return this.side;
  }
}
