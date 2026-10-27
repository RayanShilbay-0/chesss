import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root=resolve('node_modules/stockfish');
const names=['stockfish-19-lite-single.js','stockfish-19-lite-single.wasm',
  'stockfish-19-single.js','stockfish-19-single.wasm'];
const out=resolve('public/engine');
mkdirSync(out,{recursive:true});
function locate(dir,name,depth=0){
  if(depth>4 || !existsSync(dir)) return null;
  const direct=join(dir,name);
  if(existsSync(direct)) return direct;
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    if(entry.isDirectory() && !['node_modules','.git'].includes(entry.name)){
      const result=locate(join(dir,entry.name),name,depth+1);
      if(result) return result;
    }
  }
  return null;
}
for(const name of names){
  const source=locate(root,name);
  if(!source){
    console.error(`Missing ${name}. Install dependencies with npm install.`);
    process.exitCode=1;
  } else {
    copyFileSync(source,join(out,name));
    console.log(`Bundled ${name}`);
  }
}
