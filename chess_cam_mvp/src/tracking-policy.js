// Never reset a camera baseline on a timer alone: doing so can erase an
// opponent move before it has been recorded. Only verified unchanged positions
// may receive an automatic baseline refresh.
export function shouldRefreshBaseline({
  ageMs, stableFrames, pending, credible, inMotion,
  changed, reliable, mismatches, confident, nearlyIdentical
}){
  if(pending||credible||inMotion||stableFrames<2||ageMs<2800)
    return {ok:false,reason:'not-stable'};
  if(reliable){
    if(mismatches===0&&confident>=36&&changed<=10)
      return {ok:true,reason:'same-position'};
    return {ok:false,reason:'position-not-verified'};
  }
  // If no occupancy classifier is available, only renew after negligible pixel
  // difference. Never reset a real or ambiguous change without verification.
  if(changed===0&&nearlyIdentical)
    return {ok:true,reason:'identical-frame'};
  return {ok:false,reason:'insufficient-evidence'};
}
