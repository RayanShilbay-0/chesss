import {mkdir,copyFile,stat} from 'node:fs/promises';
await mkdir('public/opencv',{recursive:true});
const from='node_modules/@techstark/opencv-js/dist/opencv.js';
const to='public/opencv/opencv.js';
await copyFile(from,to);
console.log('OpenCV.js optical flow module ready:',(await stat(to)).size,'bytes');
