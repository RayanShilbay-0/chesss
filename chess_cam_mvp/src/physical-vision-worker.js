import * as ort from 'onnxruntime-web/wasm';
import urlJs from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import urlWasm from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
const WIDTH=480,HEIGHT=288;
let session=null,cornerSession=null;
function half(x){
  const float=new Float32Array([x]),bits=new Uint32Array(float.buffer)[0];
  const sign=(bits>>>16)&0x8000,exp=(bits>>>23)&255,frac=bits&0x7fffff;
  if(exp===255)return sign|0x7c00|(frac?0x0200:0);
  if(exp>142)return sign|0x7c00;
  if(exp<113){
    if(exp<103)return sign;
    const man=(frac|0x800000)>>(113-exp);
    return sign|((man+0x1000)>>13);
  }
  return sign|((exp-112)<<10)|((frac+0x1000)>>13);
}
function resize(image,width,height){
  const scale=Math.min(WIDTH/width,HEIGHT/height),dw=Math.floor(width*scale),dh=Math.floor(height*scale);
  const offX=Math.floor((WIDTH-dw)/2),offY=Math.floor((HEIGHT-dh)/2);
  const tensor=new Uint16Array(WIDTH*HEIGHT*3),padding=half(114/255);
  tensor.fill(padding);
  const stride=WIDTH*HEIGHT;
  for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
    const srcX=Math.min(width-1,Math.floor((x+.5)/scale));
    const srcY=Math.min(height-1,Math.floor((y+.5)/scale));
    const index=(srcY*width+srcX)*4,target=(y+offY)*WIDTH+x+offX;
    for(let k=0;k<3;k++)tensor[k*stride+target]=half(image[index+k]/255);
  }
  return {tensor,scale,offX,offY};
}
function toFloat(h){
  const sign=(h&0x8000)?-1:1,exp=(h>>10)&31,frac=h&1023;
  if(exp===0)return sign*Math.pow(2,-14)*(frac/1024);
  if(exp===31)return frac?NaN:sign*Infinity;
  return sign*Math.pow(2,exp-15)*(1+frac/1024);
}
function readOutput(value){
  if(value instanceof Float32Array)return value;
  if(value instanceof Uint16Array)return Float32Array.from(value,toFloat);
  return Float32Array.from(value);
}
self.onmessage=async({data:m})=>{
 try{
  if(m.type==='init'){
    ort.env.wasm.wasmPaths={
      mjs:new URL(urlJs,self.location.href).href,
      wasm:new URL(urlWasm,self.location.href).href
    };
    ort.env.wasm.numThreads=1;
    session=await ort.InferenceSession.create(m.modelUrl,{executionProviders:['wasm']});
    self.postMessage({type:'ready',inputs:session.inputNames,outputs:session.outputNames});
  }else if(m.type==='corner-detect'){
    if(!cornerSession){
      cornerSession=await ort.InferenceSession.create(m.modelUrl,{executionProviders:['wasm']});
    }
    const t=performance.now(),{tensor,scale,offX,offY}=resize(m.rgba,m.width,m.height);
    const output=await cornerSession.run({images:new ort.Tensor('float16',tensor,[1,3,HEIGHT,WIDTH])});
    const result=output[cornerSession.outputNames[0]],arr=readOutput(result.data);
    self.postMessage({type:'result',id:m.id,raw:arr,shape:result.dims,
      scale,offX,offY,ms:Math.round(performance.now()-t)},[arr.buffer]);
  }else if(m.type==='infer'){
    if(!session)throw Error('physical detector is not loaded');
    const t=performance.now(),{tensor,scale,offX,offY}=resize(m.rgba,m.width,m.height);
    const output=await session.run({images:new ort.Tensor('float16',tensor,[1,3,HEIGHT,WIDTH])});
    const result=output[session.outputNames[0]];
    const arr=readOutput(result.data);
    self.postMessage({type:'result',id:m.id,raw:arr,shape:result.dims,scale,offX,offY,
      ms:Math.round(performance.now()-t)},[arr.buffer]);
  }
 }catch(e){self.postMessage(m.type==='init'?{type:'init-error',error:String(e)}:
  {type:'error',id:m.id,error:String(e)})}
};
