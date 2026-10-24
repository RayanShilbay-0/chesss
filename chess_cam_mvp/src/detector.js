import { Chess } from 'chess.js';

// One- or two-ply legal move matching, with optional piece-occupancy evidence.
// Board snapshots and image features share the a8..h1 index convention.
const code = p => p ? p.color+p.type : '';
const board = g => g.board().flat().map(code);
const uci = m => m.from+m.to+(m.promotion||'');

export function recognizeSequence(game,scores,threshold,opts={}){
  const baseline=board(game);
  const occ=opts.occupancy;
  const observed=new Set();
  const predictedOccupancy=Array(64).fill(null);
  for(let i=0;i<64;i++){
    const pixelChanged=scores[i]>threshold;
    if(occ?.reliable && Number.isFinite(occ?.current?.[i])){
      const value=occ.current[i],cut=occ.threshold,guard=occ.guard||2.5;
      if(value<cut-guard)predictedOccupancy[i]=false;
      else if(value>cut+guard)predictedOccupancy[i]=true;
    }
    const seenPiece=predictedOccupancy[i],oldPiece=Boolean(baseline[i]);
    if(seenPiece!==null){
      if(seenPiece!==oldPiece){
        // Strongest possible evidence: the piece appeared or disappeared.
        observed.add(i);
      }else if(pixelChanged&&oldPiece&&scores[i]>Math.max(24,threshold*3)){
        // Occupied-to-occupied captures can change piece identity without
        // changing square occupancy. Keep only unmistakably large visual changes.
        observed.add(i);
      }
      // Otherwise discard background/last-move square highlighting noise.
    }else if(pixelChanged){
      observed.add(i);
    }
  }
  const indices=[...observed];
  if(indices.length===0)return {credible:false,reason:'no-change',observed:indices,alternatives:[]};
  if(indices.length>12)return {credible:false,reason:'many-changes',observed:indices,alternatives:[]};
  const candidates=[],g=new Chess(game.fen());
  function consider(line){
    const target=board(g),expected=[];
    for(let i=0;i<64;i++)if(target[i]!==baseline[i])expected.push(i);
    if(expected.length<1||expected.length>8)return;
    const expectedSet=new Set(expected);
    const hit=expected.filter(i=>observed.has(i));
    const extra=indices.filter(i=>!expectedSet.has(i));
    const miss=expected.length-hit.length;
    let occErrors=0,occSupport=0;
    if(occ?.reliable){
      for(let i=0;i<64;i++){
        const result=predictedOccupancy[i];
        if(result===null)continue;
        if(result!==Boolean(target[i]))occErrors++;
        else if(Boolean(target[i])!==Boolean(baseline[i]))occSupport++;
      }
    }
    const strength=hit.reduce((sum,i)=>sum+Math.min(scores[i],90),0);
    const rating=hit.length*25+.16*strength-miss*23-extra.length*24
       -occErrors*24+occSupport*8;
    candidates.push({
      sequence:line.map(m=>({...m})),key:line.map(uci).join(' '),
      expected,hits:hit.length,miss,extra:extra.length,occErrors,occSupport,rating
    });
  }
  for(const a of g.moves({verbose:true})){
    g.move(a);
    consider([a]);
    if(!g.isGameOver()){
      for(const b of g.moves({verbose:true})){
        g.move(b);
        consider([a,b]);
        g.undo();
      }
    }
    g.undo();
  }
  candidates.sort((a,b)=>b.rating-a.rating||a.sequence.length-b.sequence.length);
  const top=candidates[0],runner=candidates.find(c=>c.key!==top?.key);
  const margin=top?(top.rating-(runner?.rating??-Infinity)):0;
  const hasOccupancy=Boolean(occ?.reliable);
  const credible=Boolean(top
    && top.extra<=1 && top.occErrors<=(hasOccupancy?2:0)
    && (top.miss===0 || (hasOccupancy&&top.miss===1&&top.occSupport>=1))
    && top.hits>=1 && top.rating>20 && margin>=8);
  return {
    credible,reason:credible?'matched':'ambiguous',observed:indices,
    top:top||null,alternatives:candidates.slice(0,3),
    margin:Number.isFinite(margin)?margin:0,
    occupancyReliable:hasOccupancy
  };
}
