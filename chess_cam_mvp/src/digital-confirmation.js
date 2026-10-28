// An intermediate low-confidence CNN frame must not erase an otherwise
// strong consecutive hypothesis. Confirm again soon, but discard the
// candidate if the model clearly sees the original, unchanged chessboard.
export function keepDigitalCandidate(kind,decoded,fen,missing,{maxMisses=3}={}){
 if(kind==='move'||missing>=maxMisses)return false;
 if(decoded?.placement===fen.split(' ')[0]&&decoded.meanConfidence>=.86)
   return false;
 return true;
}

export function digitalMoveVote(result,hits,settings){
 const qualified=result?.kind==='move'&&
   Number.isFinite(result.confidence)&&result.confidence>=settings.confidence&&
   Number.isFinite(result.margin)&&result.margin>=settings.margin;
 // A first high-confidence vote is VALID evidence even when we still
 // need the second one. Never reset that vote just because hits<agreement.
 return {qualified,accept:qualified&&hits>=settings.agreement,
   stillWaiting:qualified&&hits<settings.agreement};
}
