import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dest='public/models/chesscam-physical-pieces.onnx';
const url='https://raw.githubusercontent.com/samegardner/chess-vision/9517ce421f3896ef3e922ee2bc10f306ba32a761/models/chesscam_pieces.onnx';
await mkdir('public/models',{recursive:true});
let body;
try{body=await readFile(dest);}
catch{
 const r=await fetch(url);
 if(!r.ok)throw Error('Cannot retrieve licensed physical model: HTTP '+r.status);
 body=Buffer.from(await r.arrayBuffer());
 await writeFile(dest,body);
}
if(body.length<3000000||body.length>6000000)
 throw Error('Unexpected ONNX physical model size: '+body.length);
const hash=createHash('sha256').update(body).digest('hex');
console.log('LeYOLO physical chess model ready',body.length,'bytes, SHA256',hash,
 'AGPL-3.0 origin samegardner/chess-vision, CameraChessWeb');
