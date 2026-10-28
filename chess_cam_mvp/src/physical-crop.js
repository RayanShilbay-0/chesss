// Reduce unused phone-camera background before LeYOLO inference.
// Portrait camera video otherwise shrinks each physical square too much
// when letterboxed to the model's 480x288 landscape input.
export function cropPhysicalBoard(frame,corners,{margin=.24,upper=.42}={}){
 if(corners.length!==4)return {rgba:new Uint8ClampedArray(frame.data),
   width:frame.width,height:frame.height,left:0,top:0};
 const x= corners.map(p=>p.x), y=corners.map(p=>p.y);
 const minX=Math.min(...x),maxX=Math.max(...x),minY=Math.min(...y),maxY=Math.max(...y);
 const ww=Math.max(1,maxX-minX),hh=Math.max(1,maxY-minY);
 const left=Math.max(0,Math.floor(minX-ww*margin));
 const right=Math.min(frame.width,Math.ceil(maxX+ww*margin));
 const top=Math.max(0,Math.floor(minY-hh*upper));
 const bottom=Math.min(frame.height,Math.ceil(maxY+hh*margin));
 const width=right-left,height=bottom-top;
 if(width<150||height<150)return {rgba:new Uint8ClampedArray(frame.data),
   width:frame.width,height:frame.height,left:0,top:0};
 const rgba=new Uint8ClampedArray(width*height*4);
 const src=frame.data;
 for(let row=0;row<height;row++){
   const start=((row+top)*frame.width+left)*4;
   rgba.set(src.subarray(start,start+width*4),row*width*4);
 }
 return {rgba,width,height,left,top};
}
