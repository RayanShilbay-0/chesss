// An intermediate low-confidence CNN frame must not erase an otherwise
// strong consecutive hypothesis. Confirm again soon, but discard the
// candidate if the model clearly sees the original, unchanged chessboard.
export function keepDigitalCandidate(kind,decoded,fen,missing,{maxMisses=3}={}){
 if(kind==='move'||missing>=maxMisses)return false;
 if(decoded?.placement===fen.split(' ')[0]&&decoded.meanConfidence>=.86)
   return false;
 return true;
}
