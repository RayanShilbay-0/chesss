// Lightweight second, independent visual signal (no neural model).
// Samples local piece-to-background contrast, intentionally reducing the
// impact of Chess.com/Lichess last-move square highlight color.
const S=256,TILE=32, sample=[7,12,17,22,26];
export function boardSignature(pixels){
  if(!pixels||pixels.length!==S*S)throw new Error('Expected 256x256 grayscale board');
  const out=new Float32Array(64);
  for(let row=0;row<8;row++)for(let col=0;col<8;col++){
    const off=(row*TILE)*S+col*TILE;
    const background=(pixels[off+2*S+2]+pixels[off+2*S+29]+
      pixels[off+29*S+2]+pixels[off+29*S+29])/4;
    let sum=0;
    for(const y of sample)for(const x of sample)
      sum+=Math.abs(pixels[off+y*S+x]-background);
    out[row*8+col]=sum/25;
  }
  return out;
}
export function signatureDifference(a,b,cutoff=.027){
  if(!a||!b||a.length!==64||b.length!==64)throw new Error('Expected 64 board signatures');
  let changed=0,highest=0,total=0;
  for(let i=0;i<64;i++){
    const d=Math.abs(a[i]-b[i]);
    if(d>cutoff)changed++;
    if(d>highest)highest=d;
    total+=d;
  }
  return {changed,highest,mean:total/64};
}
export function profileSettings(profile){
  switch(profile){
    case 'turbo':return {interval:380,agreement:1,confidence:.92,margin:5};
    case 'careful':return {interval:1100,agreement:2,confidence:.58,margin:2.2};
    default:return {interval:560,agreement:2,confidence:.58,margin:2.2};
  }
}
