// The web CNN's probability score and LeYOLO's sparse physical evidence
// have DIFFERENT scales. A 2.2 log-score margin is not a meaningful YOLO
// threshold. Physical candidates are already filtered for legal moves,
// stable observations, occlusion, and a >=1.2 separation from alternatives.
export function physicalRecognitionProfile(name='balanced'){
 switch(name){
  case 'turbo':
   return {minScans:2,agreement:1,minConfidence:.86,minMargin:1.8};
  case 'careful':
   return {minScans:3,agreement:2,minConfidence:.73,minMargin:2};
  default:
   return {minScans:2,agreement:1,minConfidence:.6,minMargin:1.23};
 }
}
export function physicalCandidateDecision(result,scans,name='balanced',repeat=1){
 const base=physicalRecognitionProfile(name);
 const policy=result?.typeRelaxed?{
   ...base,minScans:Math.max(base.minScans,3),
   agreement:Math.max(base.agreement,2),
   minMargin:Math.max(base.minMargin,1.65)
 }:base;
 if(!result||result.kind!=='move')return {accept:false,reason:'no-move',policy};
 if(scans<policy.minScans)return {accept:false,reason:'needs-observations',policy};
 if(result.confidence<policy.minConfidence)return {accept:false,reason:'low-confidence',policy};
 if(result.margin<policy.minMargin)return {accept:false,reason:'ambiguous',policy};
 if(repeat<policy.agreement)return {accept:false,reason:'needs-confirmation',policy};
 return {accept:true,reason:'verified',policy};
}
