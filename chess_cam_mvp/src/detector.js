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
  const firstMoves=g.moves({verbose:true});
  for(const a of firstMoves){
    g.move(a);
    consider([a]);
    g.undo();
  }
  // Scoring and searching EVERY two-ply line for every video frame causes
  // stalls on phones, especially in open middlegames (>1,000 continuations).
  // Try the cheap single-move solution first. Only look two moves ahead when
  // the image contains >=3 changed squares AND no legal single move fits.
  const rank=()=>candidates.sort((a,b)=>b.rating-a.rating||a.sequence.length-b.sequence.length);
  const assess=()=>{
    rank();
    const best=candidates[0],second=candidates.find(c=>c.key!==best?.key);
    const margin=best?(best.rating-(second?.rating??-Infinity)):0;
    const hasOccupancy=Boolean(occ?.reliable);
    const credible=Boolean(best
      && best.extra<=1 && best.occErrors<=(hasOccupancy?2:0)
      && (best.miss===0||(hasOccupancy&&best.miss===1&&best.occSupport>=1))
      && best.hits>=1&&best.rating>20&&margin>=8);
    return {best,margin,credible};
  };
  let result=assess();
  if(!result.credible&&indices.length>=3){
    for(const a of firstMoves){
      g.move(a);
      if(!g.isGameOver()){
        for(const b of g.moves({verbose:true})){
          g.move(b);
          consider([a,b]);
          g.undo();
        }
      }
      g.undo();
    }
    result=assess();
  }
  const top=result.best,margin=result.margin,credible=result.credible;
  return {
    credible,reason:credible?'matched':'ambiguous',observed:indices,
    top:top||null,alternatives:candidates.slice(0,3),
    margin:Number.isFinite(margin)?margin:0,
    occupancyReliable:hasOccupancy
  };
}
