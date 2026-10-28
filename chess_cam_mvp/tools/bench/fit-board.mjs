// Batch bridge so the Python benchmark runs the SAME board-lattice code as
// the browser. usage: node tools/bench/fit-board.mjs jobs.json results.json
// jobs: [{id, points:[{x,y,confidence}], width, height, gray: <raw u8 path>}]
import {readFile,writeFile} from 'node:fs/promises';
import {detectBoardFromCorners} from '../../src/board-lattice.js';
const [jobsPath,outPath]=process.argv.slice(2);
const jobs=JSON.parse(await readFile(jobsPath,'utf8'));
const out=[];
for(const job of jobs){
  const gray=job.gray?new Uint8Array(await readFile(job.gray)):null;
  const t=performance.now();
  const result=detectBoardFromCorners(job.points,{gray,width:job.width,height:job.height,pieces:job.pieces||[],position:job.position||null});
  out.push({id:job.id,ms:performance.now()-t,...result});
}
await writeFile(outPath,JSON.stringify(out));
