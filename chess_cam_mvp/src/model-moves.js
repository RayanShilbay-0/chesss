// Legal-sequence Bayesian scoring of a trained 13-class chess-tile CNN.
// Fenshot's ONNX probabilities are ordered A1..H8 in visual image coordinates.
export const TILE_LABELS='1KQRBNPkqrbnp';
const scorePiece=p=>p?(p.color==='w'?p.type.toUpperCase():p.type):'1';
export function visualIndex(boardIndex,whiteBottom=true){
  const row=Math.floor(boardIndex/8),col=boardIndex%8;
  return whiteBottom?(7-row)*8+col:row*8+(7-col);
}
export function decodedPosition(probabilities,whiteBottom=true){
  const ranks=[];let avg=0,min=1;
  for(let row=0;row<8;row++){
    let line='',empty=0;
    for(let col=0;col<8;col++){
      const vis=visualIndex(row*8+col,whiteBottom),off=vis*13;
      let best=-1,kind=0;
      for(let t=0;t<13;t++){
        if(probabilities[off+t]>best){best=probabilities[off+t];kind=t;}
      }
      avg+=best;min=Math.min(min,best);
      if(kind===0)empty++;
      else{if(empty){line+=String(empty);empty=0}line+=TILE_LABELS[kind];}
    }
    if(empty)line+=String(empty);
    ranks.push(line);
  }
  return {placement:ranks.join('/'),meanConfidence:avg/64,minConfidence:min};
}
function boardChars(game){return game.board().flat().map(scorePiece)}
function logScore(chars,probabilities,whiteBottom){
  let ll=0;
  for(let i=0;i<64;i++){
    const offset=visualIndex(i,whiteBottom)*13;
    const k=TILE_LABELS.indexOf(chars[i]);
    ll+=Math.log(Math.max(probabilities[offset+k],.000001));
  }
  return ll;
}
function evaluateExpected(game,probabilities,whiteBottom){
  const now=boardChars(game);
  const currentLL=logScore(now,probabilities,whiteBottom);
  const options=[{sequence:[],key:'',score:0,current:true}];
  const g=game;
  const first=g.moves({verbose:true});
  for(const a of first){
    g.move(a);
    const afterOne=boardChars(g);
    const one=logScore(afterOne,probabilities,whiteBottom)-currentLL;
    options.push({sequence:[{from:a.from,to:a.to,promotion:a.promotion}],key:a.from+a.to+(a.promotion||''),score:one-.2});
    // Two half-moves only if screenshot indicates multiple differences or
    // single-move hypothesis is weak; evaluated by caller condition.
    g.undo();
  }
  return {currentLL,options,first};
}
export function inferMovesFromModel(game,probabilities,{whiteBottom=true,maxTwo=true}={}){
  if(!probabilities||probabilities.length!==832)return {kind:'error',reason:'wrong-output-size'};
  const decoded=decodedPosition(probabilities,whiteBottom);
  const baseline=game.fen().split(' ')[0];
  const observed=decoded.placement;
  if(decoded.meanConfidence<.52)return {kind:'unreliable',reason:'low-confidence',decoded};
  const all=evaluateExpected(game,probabilities,whiteBottom);
  let candidates=all.options;
  const current=all.options[0];
  const bestOne=[...candidates].sort((a,b)=>b.score-a.score)[0];
  const rows=game.board().flat().map(scorePiece);
  let highDifference=0;
  for(let i=0;i<64;i++){
    const vis=visualIndex(i,whiteBottom),p0=probabilities[vis*13+TILE_LABELS.indexOf(rows[i])];
    let max=0;for(let k=0;k<13;k++)max=Math.max(max,probabilities[vis*13+k]);
    if(max>.65&&max>p0*3)highDifference++;
  }
  // A bot often makes an immediate reply. Check two-ply continuations if
  // at least 3 squares strongly disagree with the current position.
  if(maxTwo&&highDifference>=3&&(bestOne.score<8||highDifference>=4)){
    const g=game;
    for(const a of all.first){
      g.move(a);
      if(!g.isGameOver()){
        for(const b of g.moves({verbose:true})){
          g.move(b);
          const score=logScore(boardChars(g),probabilities,whiteBottom)-all.currentLL;
          candidates.push({
            sequence:[{from:a.from,to:a.to,promotion:a.promotion},{from:b.from,to:b.to,promotion:b.promotion}],
            key:a.from+a.to+(a.promotion||'')+' '+b.from+b.to+(b.promotion||''),
            score:score-.65
          });
          g.undo();
        }
      }
      g.undo();
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const top=candidates[0];
  const runner=candidates.find(x=>x.key!==top.key);
  const margin=top.score-(runner?.score??-Infinity);
  if(top.sequence.length===0||top.score<4){
    return {kind:observed===baseline?'unchanged':'uncertain',reason:'no-legal-advantage',
      decoded,highDifference,confidence:decoded.meanConfidence,
      best:top,margin};
  }
  if(top.score<6||margin<2.2||decoded.meanConfidence<.58){
    return {kind:'uncertain',reason:'ambiguous',decoded,highDifference,
      best:top,margin};
  }
  return {kind:'move',sequence:top.sequence,key:top.key,score:top.score,
    confidence:decoded.meanConfidence,decoded,highDifference,margin};
}
