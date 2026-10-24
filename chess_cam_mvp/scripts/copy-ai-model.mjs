import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
// These files are local dependencies, shipped with our free, self-hosted app.
const model='node_modules/@scoriiu/fenshot/model/chess-tiles-v2.onnx';
const dist='node_modules/onnxruntime-web/dist';
await mkdir('public/models',{recursive:true});
await mkdir('public/ort',{recursive:true});
await copyFile(model,'public/models/chess-tiles-v2.onnx');
for(const f of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']){
  await copyFile(join(dist,f),join('public/ort',f));
}
console.log('Pretrained Fenshot ONNX and ONNX Runtime assets prepared for self-hosting.');
