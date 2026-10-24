import { Chess } from 'chess.js';
// Compare changes to every legal continuation of one or two half-moves.
// A chess bot can respond before the next camera frame is captured.
const code=p=>p?p.color+p.type:'';
const snapshot=g=>g.board().flat().map(code);
const id=m=>m.from+m.to+(m.promotion||'');
export function recognizeSequence(game,scores,threshold){
  const observed=scores.flatMap((v,i)=>v>threshold?[i]:[]);
  const seen=new Set(observed);
  if(observed.length<2)return {credible:false,reason:'no-change',observed,alternatives:[]};
  if(observed.length>12)return {credible:false,reason:'many-changes',observed,alternatives:[]};
  const before=snapshot(game),candidates=[],fen=game.fen();
  const scratch=new Chess(fen);
  function consider(line){
    const after=snapshot(scratch);
    const expected=[];
    for(let i=0;i<64;i++)if(before[i]!==after[i])expected.push(i);
    if(expected.length<2||expected.length>8)return;
    const expectedSet=new Set(expected);
    const hits=expected.filter(i=>seen.has(i));
    const miss=expected.length-hits.length;
    const extra=observed.filter(i=>!expectedSet.has(i)).length;
    const strength=hits.reduce((s,i)=>s+Math.min(scores[i],90),0);
    const rating=hits.length*22+strength*.12-miss*25-extra*24;
    candidates.push({
      sequence:line,expected,hits:hits.length,miss,extra,
      coverage:hits.length/expected.length,rating,
      key:line.map(id).join(' ')
    });
  }
  for(const a of scratch.moves({verbose:true})){
    scratch.move(a);
    consider([a]);
    if(!scratch.isGameOver()){
      for(const b of scratch.moves({verbose:true})){
        scratch.move(b);
        consider([a,b]);
        scratch.undo();
      }
    }
    scratch.undo();
  }
  candidates.sort((a,b)=>b.rating-a.rating);
  const top=candidates[0],runner=candidates.find(c=>c.key!==top?.key);
  const gap=top?(top.rating-(runner?.rating??-Infinity)):0;
  const credible=Boolean(top&&top.miss===0&&top.extra<=1&&top.rating>25&&gap>=7);
  return {credible,reason:credible?'matched':'ambiguous',observed,
    top:top||null,alternatives:candidates.slice(0,3),
    margin:Number.isFinite(gap)?gap:0};
}
