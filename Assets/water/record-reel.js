// Development-only recording harness. Scene capture and editorial choices stay outside Water.
import { SHOTS } from './director.js';
if (!import.meta.env.DEV) throw new Error('Recording is available only on the development server');
const frame = document.getElementById('scene');
const status = document.getElementById('status');
const output = document.createElement('canvas');
output.width = 1920; output.height = 1080;
document.body.appendChild(output);
const ctx = output.getContext('2d', { alpha: false });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const duration = 4.5;
const names = ['Stillwater', 'Open water', 'Glitter path', 'The turquoise shelf', 'Beneath the surface', 'Focused light', 'Heavy weather', 'Adrift', 'Afterglow'];
const subtitles = ['Quiet reflections', 'Wind and swell', 'Light across the sea', 'Depth becomes colour', 'A world below', 'Waves shaping light', 'A different sea state', 'Motion at human scale', 'The last light'];
const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find(type => MediaRecorder.isTypeSupported(type));
const clamp = x => Math.max(0,Math.min(1,x));
const ease = x => { x=clamp(x); return x*x*(3-2*x); };
function draw(source, index, t) {
    ctx.globalAlpha=1; ctx.fillStyle='#050b10'; ctx.fillRect(0,0,1920,1080);
    // Short fades happen inside the captured image, so no mismatched lighting frame can leak in.
    ctx.globalAlpha=Math.min(ease(t/.22),ease((duration-t)/.22));
    ctx.drawImage(source,0,0,1920,1080);
    const gradient=ctx.createLinearGradient(0,750,0,1080);
    gradient.addColorStop(0,'rgba(3,12,18,0)'); gradient.addColorStop(1,'rgba(3,12,18,.68)');
    ctx.fillStyle=gradient; ctx.fillRect(0,750,1920,330);
    ctx.fillStyle='#eef6f5';
    ctx.font='500 20px Arial'; ctx.fillText('W A T E R   /   S T U D I E S',82,856);
    ctx.font='54px Georgia'; ctx.fillText(names[index],80,933);
    ctx.font='25px Arial'; ctx.fillStyle='#c5d7dc'; ctx.fillText(subtitles[index],82,982);
    ctx.font='20px Arial'; ctx.textAlign='right'; ctx.fillText(`${String(index+1).padStart(2,'0')} / 09`,1838,980);ctx.textAlign='left';
    ctx.globalAlpha=1;
}
async function run() {
    if(!mime) throw new Error('No supported recording codec');
    while(!frame.contentWindow?.__water) await delay(100);
    const {app,director}=frame.contentWindow.__water;
    const source=frame.contentDocument.getElementById('app');
    const stream=output.captureStream(30);
    await document.fonts.ready;
    for(let i=0;i<SHOTS.length;i++) {
        status.textContent=`Preparing ${i+1}/9 — ${names[i]}`;
        director.go(i); director.seek(SHOTS[i].duration*.2);
        // Let sky readbacks, scene grabs, shadows and temporal resources settle before recording.
        await delay(1300);
        while(frame.contentDocument.getElementById('study-transition').classList.contains('covered')) await delay(50);
        const chunks=[];
        const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:18000000});
        recorder.ondataavailable=e=>{if(e.data.size) chunks.push(e.data);};
        const stopped=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=reject;});
        let start=performance.now(),done=false;
        const paint=()=>{
            const t=(performance.now()-start)/1000;
            // Slow camera travel preserves the original composition across each short excerpt.
            director.seek(SHOTS[i].duration*.2+Math.min(t,duration)*.8);
            draw(source,i,Math.min(t,duration));
            if(t>=duration&&!done){done=true;recorder.stop();app.off('frameend',paint);}
        };
        draw(source,i,0);
        status.textContent=`Recording ${i+1}/9 — ${names[i]} · 1920 × 1080 / 30 fps`;
        app.on('frameend',paint); recorder.start();
        await stopped;
        const response=await fetch(`/__reel?name=${String(i+1).padStart(2,'0')}-${SHOTS[i].id}`,{
            method:'POST',headers:{'Content-Type':'video/webm'},body:new Blob(chunks,{type:'video/webm'})
        });
        if(!response.ok) throw new Error(await response.text());
    }
    stream.getTracks().forEach(track=>track.stop());
    status.textContent='Complete — nine clean 1080p clips saved.';
    document.body.dataset.recording='complete';
}
run().catch(error=>{status.textContent=`Recording failed: ${error.message}`;document.body.dataset.recording='failed';console.error(error);});
