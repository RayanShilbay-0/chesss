import { createRecognizer } from '@scoriiu/fenshot';
import { TrainedChessVision } from './trained-vision.js';
import { Chess } from 'chess.js';
export async function runModelGoldenFixture(name,side){
  const base=import.meta.env.BASE_URL||'/';
  const response=await fetch(base+'test-fixtures/'+name);
  if(!response.ok)throw new Error('Fixture missing: '+response.status);
  const blob=await response.blob();
  const bitmap=await createImageBitmap(blob);
  const canvas=document.createElement('canvas');
  canvas.width=bitmap.width;canvas.height=bitmap.height;
  const cx=canvas.getContext('2d',{willReadFrequently:true});
  cx.drawImage(bitmap,0,0);const image=cx.getImageData(0,0,bitmap.width,bitmap.height);
  const standard=createRecognizer({
    modelUrl:base+'models/chess-tiles-v2.onnx',wasmPaths:base+'ort/'
  });
  const detected=await standard.recognize(blob);
  if(!detected)throw new Error('Upstream Fenshot model failed to locate source fixture');
  const {x0,y0,x1,y1}=detected.corners;
  const fakeCamera={
    stream:{},corners:[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}],
    side,frame:()=>image,
    point:(u,v)=>({x:x0+(x1-x0)*u,y:y0+(y1-y0)*v})
  };
  const trained=new TrainedChessVision(fakeCamera);
  const result=await trained.recognize(new Chess());
  return {
    actual:result.decoded.placement,mean:result.decoded.meanConfidence,
    min:result.decoded.minConfidence,
    upstream:detected.placement,upstreamMean:detected.meanConfidence,
    upstreamReliable:detected.reliable
  };
}
window.__runModelGoldenFixture=runModelGoldenFixture;
