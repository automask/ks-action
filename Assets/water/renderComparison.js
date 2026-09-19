import { PIXELFORMAT_RGBA16F, PIXELFORMAT_111110F } from 'playcanvas';
import { SHOTS } from './director.js';

/** Development-only A/B fixture: supported Camera Frame settings, identical scene state. */
export function installRenderComparison({ app, device, frame, director, water, params }) {
    const state = { frozen: false };
    const variants = [
        { id: 'baseline', samples: 4, format: 'rgba16' },
        { id: 'msaa2', samples: 2, format: 'rgba16' },
        { id: 'packed', samples: 4, format: 'rg11b10' },
        { id: 'both', samples: 2, format: 'rg11b10' },
        { id: 'repeat', samples: 4, format: 'rgba16' }
    ];
    const original = { samples: frame.rendering.samples, format: frame.rendering.renderFormat };
    director.paused = true;
    if (device.gpuProfiler) device.gpuProfiler.enabled = false;
    const panel = document.createElement('pre');
    panel.id = 'render-comparison';
    panel.style.cssText = 'position:fixed;z-index:10000;top:70px;left:20px;padding:12px;background:#071019ed;color:white;max-height:70vh;max-width:90vw;overflow:auto;font:12px monospace';
    panel.textContent = 'Settling identical scene state…'; document.body.append(panel);
    const shot = SHOTS[director.index].id;
    if (params.get('shot') && params.get('shot') !== shot) throw new Error('Comparison shot did not match the requested scene');
    const label = `${device.deviceType}-${shot}`;
    let count = 0, index = -1, phase = 'settle', start = 0, cpuStart = 0, interval = 0, samples = [];
    const results = [];
    const pct = (values, q) => { const a = [...values].sort((a,b)=>a-b); return +a[Math.min(a.length-1,Math.floor(a.length*q))].toFixed(3); };
    const targetInfo = () => {
        const target = frame.engineCameraFrame.renderPassCamera.rt;
        let hardwareSamples = target.samples;
        // Read the driver's allocation, restoring binding immediately. This is measurement only.
        const buffer = target.impl._glMsaaColorBuffers?.[0];
        if (!device.isWebGPU && buffer) {
            const gl = device.gl, previous = gl.getParameter(gl.RENDERBUFFER_BINDING);
            gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
            hardwareSamples = gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_SAMPLES);
            gl.bindRenderbuffer(gl.RENDERBUFFER, previous);
        }
        return { requestedSamples: variants[index].samples, engineSamples: target.samples, hardwareSamples,
            requestedFormat: variants[index].format,
            actualFormat: target.colorBuffer.format === PIXELFORMAT_RGBA16F ? 'RGBA16F' : target.colorBuffer.format === PIXELFORMAT_111110F ? 'RG11B10F' : `format-${target.colorBuffer.format}`,
            canvas: [device.width,device.height], estimatedMiB: +(app.stats.vram.totalUsed / 1048576).toFixed(2) };
    };
    const next = () => {
        index++; samples = []; start = performance.now();
        if (index === variants.length) {
            phase = 'complete';
            frame.rendering.samples = original.samples; frame.rendering.renderFormat = original.format;
            const report = { status: 'complete', backend: device.deviceType, shot, waterTime: water.time,
                note: 'Fixed camera, waves and props. FFT still executes at dt=0. GPU timestamps off. Frame intervals include presentation scheduling; CPU times are update/submission, not GPU execution.',
                baselineDriftPercent: +(100 * Math.abs(results.at(-1).meanFrameMs/results[0].meanFrameMs-1)).toFixed(2), results };
            panel.textContent = JSON.stringify(report, null, 2);
            const button = document.createElement('button'); button.textContent = 'Download comparison';
            button.addEventListener('click', () => {
                const url = URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
                const a = document.createElement('a'); a.href=url; a.download=`render-compare-${label}.json`; a.click();
                setTimeout(()=>URL.revokeObjectURL(url),1000);
            });
            panel.prepend(button); return;
        }
        const variant = variants[index];
        frame.rendering.samples = variant.samples; frame.rendering.renderFormat = variant.format;
        phase = 'measure'; panel.textContent = `${index+1}/${variants.length}: ${variant.id} — warming and measuring…`;
    };
    app.on('frameupdate', ms => { interval = ms; cpuStart = performance.now(); });
    app.on('frameend', () => {
        if (phase === 'settle') { if (++count >= 180) { state.frozen = true; next(); } return; }
        if (phase !== 'measure') return;
        if (document.hidden) { start=performance.now(); samples=[]; return; }
        const elapsed = performance.now()-start, warmup = index === 0 ? 8000 : 4000;
        if (elapsed < warmup) return;
        samples.push({ frame: interval, cpu: performance.now()-cpuStart });
        if (elapsed < warmup+6000) return;
        phase='save';
        const mean = samples.reduce((a,s)=>a+s.frame,0)/samples.length;
        const name = `quality-${label}-${variants[index].id}`;
        results.push({ id: variants[index].id, ...targetInfo(), frames:samples.length, fps:+(1000/mean).toFixed(2),
            meanFrameMs:+mean.toFixed(3), medianFrameMs:pct(samples.map(s=>s.frame),.5), p95FrameMs:pct(samples.map(s=>s.frame),.95),
            medianCpuMs:pct(samples.map(s=>s.cpu),.5), image:`${name}.png` });
        device.canvas.toBlob(async blob => {
            try {
                if (!blob) throw new Error('Canvas capture failed');
                const response = await fetch(`/__shot?name=${name}&ext=png`,{method:'POST',body:blob});
                if (!response.ok) throw new Error(await response.text());
                next();
            } catch(error) { phase='error'; panel.textContent=String(error); console.error(error); }
        },'image/png');
    });
    return state;
}
