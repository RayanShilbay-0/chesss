// All ONNX inference runs off the UI thread by default.
import * as ort from 'onnxruntime-web/wasm';
import urlJs from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import urlWasm from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
let session=null,opening=null;
function init(modelUrl){
  if(!opening)opening=(async()=>{
    ort.env.wasm.wasmPaths={
      mjs:new URL(urlJs,self.location.href).href,
      wasm:new URL(urlWasm,self.location.href).href
    };
    ort.env.wasm.numThreads=1;
    session=await ort.InferenceSession.create(modelUrl,{executionProviders:['wasm']});
  })();
  return opening;
}
self.onmessage=async({data:msg})=>{
  try{
    if(msg.type==='init'){
      await init(msg.modelUrl);
      self.postMessage({type:'ready'});
    }else if(msg.type==='infer'){
      if(!session)throw new Error('ONNX model not ready');
      const start=performance.now();
      const output=await session.run({tiles:new ort.Tensor('float32',msg.input,[64,1024])});
      const probabilities=Float32Array.from(output.probs?.data||[]);
      self.postMessage({type:'result',id:msg.id,probabilities,ms:Math.round(performance.now()-start)},
        [probabilities.buffer]);
    }
  }catch(e){
    self.postMessage(msg.type==='init'?{type:'init-failed',error:String(e?.message||e)}:
      {type:'error',id:msg.id,error:String(e?.message||e)});
  }
};
