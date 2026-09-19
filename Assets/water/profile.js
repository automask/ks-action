/** Opt-in diagnostic harness. Never changes the normal demo or the water API. */
export function installProfile({ app, device, water, frame, director, sun, params }) {
    const panel = document.createElement('section');
    panel.id = 'performance-profile';
    panel.style.cssText = 'position:fixed;z-index:10000;top:64px;left:12px;max-width:calc(100vw - 24px);max-height:75vh;overflow:auto;background:#071019ee;color:#e6f0f4;padding:12px;font:12px monospace;box-sizing:border-box';
    const button = document.createElement('button'); button.textContent = 'Run performance profile';
    const output = document.createElement('pre'); output.style.whiteSpace = 'pre-wrap';
    output.textContent = 'Keep this tab visible. Runs nine comparisons (~2 minutes). Results stay on this device.';
    const download = document.createElement('button'); download.textContent = 'Download report'; download.hidden = true;
    let report = null;
    download.addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'water-performance.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    panel.append(button, download, output); document.body.append(panel);
    // Timestamp readback can perturb performance substantially on some browser/GPU pairs.
    // Keep FPS comparisons uninstrumented; opt into GPU timings only for a separate run.
    const gpuTimingEnabled = params.has('profile-gpu');
    device.gpuProfiler && (device.gpuProfiler.enabled = gpuTimingEnabled);
    const initial = { ratio: device.maxPixelRatio, samples: frame.rendering.samples, quality: water.config.quality, shadows: sun.light.castShadows };
    const renders = app.root.findComponents('render').filter(r => r.entity !== water._entity);
    const enabled = renders.map(r => r.enabled);
    // A private probe is intentional: stopping FFT work must not grow the public API.
    let originalSimulation, originalUpdate, freeze = false;
    const restoreFFT = () => { if (originalSimulation) originalSimulation.update = originalUpdate; originalSimulation = null; freeze = false; };
    const reset = () => {
        restoreFFT();
        device.maxPixelRatio = initial.ratio; app.resizeCanvas();
        frame.rendering.samples = initial.samples;
        water.set({ quality: initial.quality }); sun.light.castShadows = initial.shadows;
        renders.forEach((r, i) => r.enabled = enabled[i]);
    };
    const cases = [
        ['Baseline', () => {}],
        ['Pixel ratio 1', () => { device.maxPixelRatio = 1; app.resizeCanvas(); }],
        ['MSAA 1', () => frame.rendering.samples = 1],
        ['Post effects off', () => {}],
        ['FFT frozen', () => freeze = true],
        ['Low water quality', () => water.set({ quality: 'low' })],
        ['Scene geometry off', () => renders.forEach(r => r.enabled = false)],
        ['Shadows off', () => sun.light.castShadows = false],
        ['Baseline repeat', () => {}]
    ];
    let running = false, index = -1, start = 0, cpuStart = 0, interval = 0, samples = [], results = [];
    const percentile = (values, p) => {
        const a = values.filter(Number.isFinite).sort((a,b) => a-b);
        return a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2) : null;
    };
    const describe = () => ({ backend: device.deviceType, viewport: [innerWidth, innerHeight], canvas: [device.width, device.height], pixelRatio: device.maxPixelRatio, samples: frame.rendering.samples, quality: water.config.quality });
    let metadata;
    const next = () => {
        reset(); index++;
        if (index === cases.length) {
            running = false; button.disabled = false; button.textContent = 'Run again';
            const drift = Math.abs(results.at(-1).fps / results[0].fps - 1);
            report = { status: 'complete', ...metadata, baselineDriftPercent: +(drift * 100).toFixed(1),
                largestTextures: [...device.textures].map(t => ({ name: t.name, width: t.width, height: t.height, estimatedMiB: +(t.gpuSize / 1048576).toFixed(2) })).sort((a,b) => b.estimatedMiB - a.estimatedMiB).slice(0, 15),
                warning: drift > .2 ? 'Baselines differ by over 20%. Repeat before drawing conclusions; loading, thermal changes or other GPU work may interfere.' : null, results };
            download.hidden = false;
            output.textContent = JSON.stringify(report, null, 2);
            return;
        }
        cases[index][1](); samples = []; start = performance.now();
        output.textContent = `${index+1}/${cases.length} ${cases[index][0]} — warming up…\n` + JSON.stringify(results, null, 2);
    };
    button.addEventListener('click', () => {
        if (running) return;
        director.paused = true;
        metadata = { userAgent: navigator.userAgent, started: new Date().toISOString(), shot: params.get('shot') || 'stillwater', renderer: device.unmaskedRenderer || [device.gpuAdapter?.info?.vendor, device.gpuAdapter?.info?.architecture, device.gpuAdapter?.info?.description].filter(Boolean).join(' ') || 'unavailable', gpuTimingEnabled, gpuTimersSupported: device.isWebGPU ? Boolean(device.supportsTimestampQuery) : Boolean(device.extDisjointTimerQuery), note: 'CPU = main-thread update + submit. GPU timestamps lag; WebGL GpuFrame excludes FFT passes submitted during update. Memory is an engine allocation estimate, not measured physical VRAM. FPS includes display scheduling. No mobile emulation.' };
        download.hidden = true; results = []; index = -1; running = true; button.disabled = true; next();
    });
    app.on('frameupdate', ms => { cpuStart = performance.now(); interval = ms; });
    // Installed after the gallery update so diagnostic overrides are not overwritten by art direction.
    app.on('update', () => {
        if (!running) return;
        if (cases[index][0] === 'Post effects off') {
            for (const key of ['bloom','dof','vignette','colorEnhance','grading','volumetricFog']) frame[key].enabled = false;
            frame.rendering.sharpness = 0;
        }
        if (freeze && !originalSimulation) {
            originalSimulation = water._simulation; originalUpdate = originalSimulation.update;
            originalSimulation.update = () => {};
        }
    });
    app.on('frameend', () => {
        if (!running) return;
        if (document.hidden) { samples = []; start = performance.now(); return; }
        const elapsed = performance.now() - start;
        const warmup = index === 0 ? 10000 : 4000;
        if (elapsed < warmup) return;
        samples.push({ interval, cpu: performance.now()-cpuStart, draws: app.stats.drawCalls.total, vram: app.stats.vram.totalUsed / 1048576, gpu: Object.fromEntries(app.stats.gpu) });
        if (elapsed < warmup + 8000) return;
        const passNames = [...new Set(samples.flatMap(s => Object.keys(s.gpu)))];
        const gpu = Object.fromEntries(passNames.map(k => [k, percentile(samples.map(s=>s.gpu[k]), .5)]).sort((a,b)=>b[1]-a[1]));
        results.push({ case: cases[index][0], ...describe(), frames: samples.length,
            fps: +(1000 / (samples.reduce((n,s)=>n+s.interval,0) / samples.length)).toFixed(1),
            frameMedianMs: percentile(samples.map(s=>s.interval),.5), frameP95Ms: percentile(samples.map(s=>s.interval),.95),
            cpuMedianMs: percentile(samples.map(s=>s.cpu),.5), draws: percentile(samples.map(s=>s.draws),.5),
            gpuMemoryMiB: percentile(samples.map(s=>s.vram),.5), gpuPassMedianMs: gpu });
        next();
    });
    if (params.get('profile') === 'auto') button.click();
}
