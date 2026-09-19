import {
    StandardMaterial, AppBase, AppOptions, createGraphicsDevice, Entity, Color, Vec3, Quat,
    RenderComponentSystem, CameraComponentSystem, LightComponentSystem, ScriptComponentSystem,
    TextureHandler, ContainerHandler, dracoInitialize, basisInitialize,
    FOG_EXP, FOG_EXP2, SHADOW_PCF3_32F, DEVICETYPE_WEBGPU, DEVICETYPE_WEBGL2
} from 'playcanvas';
import { CinematicFrame } from './CinematicFrame.js';

import { Water, bakeShoreMap } from '../src/index.js';
import { Sky } from '../src/sky/index.js';
import { applyPreset } from './presets.js';
import { buildSeabed, seabedHeight, Floaters, loadCoastModel } from './scene.js';
import { Birds } from './props.js';
import { ShotTransition } from './ShotTransition.js';
import { Director, SHOTS } from './director.js';
import { FlyCamera } from './FlyCamera.js';
import { buildGui } from './gui.js';

export async function mountGallery({ app: suppliedApp, cameraEntity, sunEntity, baseUrl = import.meta.env.BASE_URL, query = location.search } = {}) {
    const canvas = suppliedApp?.graphicsDevice.canvas ?? document.getElementById('app');
    const params = new URLSearchParams(query);
    const el = id => document.getElementById(id);
    // ---------------------------------------------------------------- device / app
    const requested = params.get('gfx');
    const deviceTypes = requested === 'webgl2' ? [DEVICETYPE_WEBGL2]
        : requested === 'webgpu' ? [DEVICETYPE_WEBGPU]
            : [DEVICETYPE_WEBGPU, DEVICETYPE_WEBGL2];
    const device = suppliedApp?.graphicsDevice ?? await createGraphicsDevice(canvas, { deviceTypes, antialias: false, alpha: false });
    device.maxPixelRatio = import.meta.env.DEV && params.has('reel') ? 1 : Math.min(window.devicePixelRatio, 2);

    const app = suppliedApp ?? new AppBase(canvas);
    const opts = new AppOptions();
    opts.graphicsDevice = device;
    opts.componentSystems = [RenderComponentSystem, CameraComponentSystem, LightComponentSystem, ScriptComponentSystem];
    opts.resourceHandlers = [TextureHandler, ContainerHandler];   // the scanned rocks and terrain textures
    // Draco meshes and KTX2 / Basis textures in glTF need their decoders (the engine's own builds)
    dracoInitialize({ jsUrl: `${baseUrl}demo/lib/draco/draco.wasm.js`, wasmUrl: `${baseUrl}demo/lib/draco/draco.wasm.wasm`, numWorkers: 2 });
    basisInitialize({ glueUrl: `${baseUrl}demo/lib/basis/basis.wasm.js`, wasmUrl: `${baseUrl}demo/lib/basis/basis.wasm.wasm`, fallbackUrl: `${baseUrl}demo/lib/basis/basis.js` });
    if (!suppliedApp) app.init(opts);
    app.setCanvasFillMode('FILL_WINDOW');
    app.setCanvasResolution('AUTO');
    window.addEventListener('resize', () => app.resizeCanvas());

    // ---------------------------------------------------------------- camera
    const camera = cameraEntity ?? new Entity('Camera');
    if (camera.camera) camera.removeComponent('camera');
    camera.addComponent('camera', {
        clearColor: new Color(0.02, 0.04, 0.08),
        nearClip: 0.25,
        farClip: 60000,
        fov: 42
    });
    // Editor applications are already rendering while the coast loads asynchronously.
    camera.camera.enabled = false;
    camera.setPosition(0, 6, 40);
    camera.lookAt(0, 1, 0);
    if (!camera.parent) app.root.addChild(camera);
    const fly = new FlyCamera(app, camera);

    // ---------------------------------------------------------------- post-processing
    // The engine's own camera-frame script owns the chain: the scene is rendered once into an HDR
    // buffer — the water writes linear radiance into it — and tone mapping, bloom, depth of field,
    // the grade and the god rays are all composed afterwards.
    if (!camera.script) camera.addComponent('script');
    /** @type {import('playcanvas/scripts/esm/camera-frame.mjs').CameraFrame} */
    const frame = camera.script.create(CinematicFrame);

    frame.rendering.renderFormat = 'rgba16';
    frame.rendering.samples = 4;
    frame.rendering.sceneColorMap = true;    // the water's refraction / SSR source
    frame.rendering.sceneDepthMap = true;
    frame.rendering.toneMapping = 'aces2';
    frame.rendering.sharpness = 0.15;
    // Dev render fixture for tests/verify-dof-render.py; no extra Studio controls.
    if (import.meta.env.DEV && params.has('dof-mask')) frame.rendering.debug = 'dofcoc';

    frame.bloom.enabled = true;
    frame.bloom.intensity = 0.022;
    frame.bloom.blurLevel = 7;

    // Only the calm close-up uses focus blur. CinematicFrame computes its circle of confusion
    // against a planar sea proxy; the actual scene grab remains unchanged for refraction.
    frame.dof.enabled = false;
    frame.dof.nearBlur = true;
    frame.dof.highQuality = true;
    frame.dof.focusDistance = 14;
    frame.dof.focusRange = 7;
    frame.dof.blurRadius = 4;

    frame.vignette.enabled = true;
    frame.vignette.inner = 0.5;
    frame.vignette.outer = 1.35;
    frame.vignette.curvature = 0.7;
    frame.vignette.intensity = 0.22;

    // Keep bright water glints achromatic.
    frame.fringing.enabled = false;
    frame.fringing.intensity = 0.3;

    frame.grading.enabled = true;
    frame.colorEnhance.enabled = true;
    frame.colorEnhance.vibrance = 0.04;
    frame.colorEnhance.shadows = 0.02;
    frame.colorEnhance.highlights = -0.02;

    frame.taa.enabled = false;

    /** Effects the demo toggles per frame rather than through the script's own attributes. */
    const post = { volumetric: false, cinematic: params.get('cinematic') !== 'off' };

    // ---------------------------------------------------------------- sky + sun
    const sky = new Sky(app);
    const sun = sunEntity ?? new Entity('Sun');
    if (sun.light) sun.removeComponent('light');
    sun.addComponent('light', {
        type: 'directional', castShadows: true, shadowResolution: 2048, shadowDistance: 180,
        shadowBias: 0.2, normalOffsetBias: 0.05, shadowType: SHADOW_PCF3_32F, numCascades: 3
    });
    if (!sun.parent) app.root.addChild(sun);

    // shafts of sun through the sea haze; off by default because it costs a pass and reads as
    // milky over open water, but it is the finishing touch on the low-sun shots
    frame.volumetricFog.enabled = false;
    frame.volumetricFog.light = sun;
    frame.volumetricFog.density = 0.0012;
    frame.volumetricFog.heightBase = 0;
    frame.volumetricFog.heightFalloff = 0.08;
    frame.volumetricFog.extinction = 0.0;
    frame.volumetricFog.anisotropy = 0.84;
    frame.volumetricFog.intensity = 0.4;
    frame.volumetricFog.ambientIntensity = 0.0;
    frame.volumetricFog.maxDistance = 260;
    frame.volumetricFog.scale = 0.5;

    app.scene.fog.type = FOG_EXP2;
    app.scene.fog.color = new Color(0.45, 0.5, 0.55);
    app.scene.fog.density = 0.00013;

    // ---------------------------------------------------------------- water
    const water = new Water(app, {
        quality: params.get('size') === '128' || params.get('mesh') === 'low' ? 'low'
            : params.get('size') === '512' ? 'high' : 'medium'
    });

    const _axis = new Vec3(), _up = new Vec3(0, 1, 0), _q = new Quat();
    const syncSun = () => {
        const d = sky.getSunDirection();
        // a directional light shines along its local -Y, so point +Y at the sun
        _axis.cross(_up, d);
        const angle = Math.acos(Math.max(-1, Math.min(1, _up.dot(d)))) * 180 / Math.PI;
        if (_axis.length() > 1e-5) sun.setRotation(_q.setFromAxisAngle(_axis.normalize(), angle));
        else sun.setRotation(Quat.IDENTITY);
        const c = sky.getSunColor();
        const mx = Math.max(c.r, c.g, c.b, 1e-3);
        sun.light.color = new Color(c.r / mx, c.g / mx, c.b / mx);
        sun.light.intensity = mx;
        if (sky.ready) water.setEnvironment(sky.environment);
        frame.volumetricFog.tint.set(c.r / mx, c.g / mx, c.b / mx);
    };
    const horizon = new Color(0.45, 0.5, 0.55), zenith = new Color(0.2, 0.35, 0.6);
    const skyLayer = app.scene.layers.getLayerByName('Skybox');
    let lightingRevision = 0, lightingReady = null;
    sky.onUpdate = () => {
        syncSun();
        const revision = ++lightingRevision, settings = sky.params;
        Promise.all([sky.readHorizonColor(), sky.readZenithColor()]).then(([h, z]) => {
            if (revision !== lightingRevision) return;
            if (h) horizon.set(...h);
            if (z) zenith.set(...z);
            lightingReady = settings;
        });
    };
    syncSun();

    // ---------------------------------------------------------------- scene
    await buildSeabed(app, device, 0, `${baseUrl}demo/assets`);

    // Development-only source inspection. This large candidate is excluded from production assets.
    // Its bathymetry is not wired to the water; the default gallery uses the validated heightfield.
    if (import.meta.env.DEV && params.has('saltreach')) {
        const t0 = performance.now();
        const e = await loadCoastModel(app, `${import.meta.env.BASE_URL}demo/assets/models/saltreach_src.glb`, [-380, 0, 520]);
        console.log(`Saltreach loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`, e);
    }

    // Hand the water the same bathymetry the sea bed was built from, so it knows where the coast is
    // and can shoal, break and wash against it.
    water.setShoreMap(bakeShoreMap(device, {
        origin: [-700, -700], size: [1600, 1600], heightAt: seabedHeight, maxDepth: 36, resolution: 512
    }));

    const floaters = new Floaters(app, water);
    const birds = new Birds(app, 7);
    const receivers = new Set(app.root.findComponents('render').flatMap(rc => rc.meshInstances.map(mi => mi.material)));
    for (const material of receivers) {
        // Surface ShaderMaterial owns its own volume integration.
        if (material instanceof StandardMaterial) water.addReceiver(material);
    }

    // ---------------------------------------------------------------- direction
    const shotEl = el('shot');
    const dots = el('dots');
    SHOTS.forEach((s, i) => {
        const d = document.createElement('button');
        d.type = 'button';
        d.title = s.intent || s.sub;
        d.setAttribute('aria-label', s.name);
        d.innerHTML = `<span class="num">${String(i + 1).padStart(2, '0')}</span><span class="label">${s.name}</span>`;
        d.addEventListener('click', () => { giveBack(); director.go(i); if (params.has('still')) { director.seek(s.duration * .35); setPlayback(false); } });
        dots.appendChild(d);
    });

    const transition = new ShotTransition(el('study-transition'));
    app.on('frameend', () => transition.frame(1 / 60, lightingReady === sky.params));
    let gui;
    const director = new Director({
        camera, water, sky, cameraFrame: frame, applyPreset,
        onShot: (s, i) => {
            transition.begin();
            shotEl.querySelector('.idx').textContent = `Study ${String(i + 1).padStart(2, '0')} / ${String(SHOTS.length).padStart(2, '0')}`;
            shotEl.querySelector('.name').textContent = s.name;
            shotEl.querySelector('.sub').textContent = s.sub;
            shotEl.querySelector('.intent').textContent = s.intent || '';
            [...dots.children].forEach((d, j) => { d.classList.toggle('on', j === i); d.setAttribute('aria-current', j === i ? 'true' : 'false'); });
            dots.children[i]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            gui?.refresh(s.preset);
            if (params.get('caustics') === 'off') water.set({ caustics: { enabled: false } });
            el('capture').textContent = 'Capture';
        }
    });

    let manual = false;
    const takeControl = () => {
        if (manual) return;
        manual = true;
        birds.visible = false;
        director.release();
        document.body.classList.add('free');
        document.body.classList.remove('cinematic');
        el('hud-hint').textContent = 'wasd / qe move · drag look · space return';
        fly.syncFrom(camera);
        el('fly-toggle').setAttribute('aria-pressed', 'true');
        el('fly-toggle').textContent = 'Return';
        el('play-toggle').textContent = 'Play';
        el('play-toggle').setAttribute('aria-pressed', 'true');
    };
    const giveBack = () => {
        if (!manual) return;
        manual = false;
        director.resume();
        document.body.classList.remove('free');
        document.body.classList.add('cinematic');
        el('hud-hint').textContent = '← → studies · space explore · h studio';
        el('fly-toggle').setAttribute('aria-pressed', 'false');
        el('fly-toggle').textContent = 'Explore';
        el('play-toggle').textContent = 'Pause';
        el('play-toggle').setAttribute('aria-pressed', 'false');
    };
    // Only a deliberate gesture takes the camera: a drag, or a movement key. A stray pointerdown or
    // scroll during load must not tear down the presentation.
    canvas.addEventListener('pointermove', (ev) => { if (ev.buttons) takeControl(); });
    const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
        'ArrowUp', 'ArrowDown']);

    // ---------------------------------------------------------------- ui
    const setPlayback = playing => {
        if (manual) giveBack();
        director.paused = !playing;
        el('play-toggle').textContent = playing ? 'Pause' : 'Play';
        el('play-toggle').setAttribute('aria-pressed', String(!playing));
        gui?.refresh();
    };
    gui = buildGui({ water, sky, director, post,
        onReset: shot => { director.go(shot.id); director.seek(shot.duration * .35); setPlayback(false); }
    });
    gui.hide();
    let guiShown = false;
    const togglePanel = () => {
        guiShown = !guiShown;
        guiShown ? (gui.refresh(), gui.show()) : gui.hide();
        el('panel-toggle').setAttribute('aria-pressed', String(guiShown));
    };
    el('panel-toggle').addEventListener('click', togglePanel);
    el('fly-toggle').addEventListener('click', () => manual ? giveBack() : takeControl());
    el('play-toggle').addEventListener('click', () => setPlayback(director.paused || !director.active));
    const requestedShot = params.get('shot');
    if (requestedShot) {
        const index = SHOTS.findIndex(s => s.id === requestedShot);
        if (index >= 0) director.go(index);
    }
    if (params.has('still')) {
        director.seek(SHOTS[director.index].duration * .35);
        setPlayback(false);
    }
    if (params.has('clean')) document.body.classList.add('clean');
    // Repeatable authoring views; not part of the library or the public gallery controls.
    if (import.meta.env.DEV) {
        const views = {
            stack: { eye: [2, 23, 64], target: [-30, 0, 34] },
            coast: { eye: [-8, 85, -82], target: [-125, 5, -255] }
        };
        const view = views[params.get('coast-view')];
        if (view) { director.release(); camera.setPosition(...view.eye); camera.lookAt(...view.target); }
    }


    // Capture after GPU command submission: works with both WebGPU and WebGL2 without preserving
    // the drawing buffer. Dev captures go to renders/; production uses a local image download.
    let capturePending = params.get('capture') || null;
    let renderedFrames = 0;
    el('capture').addEventListener('click', () => {
        capturePending = `study-${SHOTS[director.index].id}-${device.isWebGPU ? 'webgpu' : 'webgl2'}`;
        el('capture').textContent = 'Saving…';
    });
    app.on('frameend', () => {
        renderedFrames++;
        if (!capturePending || renderedFrames < 90) return;
        const name = capturePending;
        capturePending = null;
        canvas.toBlob(async blob => {
            if (!blob) { el('capture').textContent = 'Capture failed'; return; }
            try {
                if (import.meta.env.DEV) {
                    const response = await fetch(`/__shot?name=${encodeURIComponent(name)}&ext=png`, { method: 'POST', body: blob });
                    if (!response.ok) throw new Error('Capture could not be saved');
                } else {
                    const url = URL.createObjectURL(blob), link = document.createElement('a');
                    link.href = url; link.download = `${name}.png`; link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
                el('capture').textContent = 'Saved';
                document.body.dataset.captured = name;
            } catch (error) { console.error(error); el('capture').textContent = 'Capture failed'; }
        }, 'image/png');
    });

    el('hud-backend').textContent = device.isWebGPU ? 'WebGPU · compute FFT' : 'WebGL2 · fragment FFT';
    const fpsEl = el('hud-fps');

    window.addEventListener('keydown', (ev) => {
        if (ev.target.closest?.('.studio-panel')) return;
        if (ev.code === 'KeyH') togglePanel();
        else if (ev.code === 'KeyP') setPlayback(director.paused);
        else if (ev.code === 'Space') { ev.preventDefault(); manual ? giveBack() : takeControl(); }
        else if (ev.code === 'ArrowRight' && !manual) director.next();
        else if (ev.code === 'ArrowLeft' && !manual) director.prev();
        else if (MOVE_KEYS.has(ev.code)) takeControl();
    });

    // ---------------------------------------------------------------- loop
    let acc = 0, frames = 0;
    let renderComparison;
    const buoyFocus = new Vec3(-2, 0.8, -2);
    app.on('update', (dt) => {
        const step = renderComparison?.frozen ? 0 : params.has('still') ? 1 / 60 : Math.min(dt, 0.05);
        if (!transition.active) director.update(step);
        if (manual) fly.update(dt);

        water.update(step, camera);
        floaters.update(step);
        birds.update(step, camera);

        // Scene fog supplies the background and a fallback for unattached materials. Registered
        // receivers integrate RGB extinction and sunlight/view paths inside Water's adapter.
        const submerged = camera.getPosition().y < water.seaLevel;
        birds.visible = !manual && !submerged;
        const vol = water.config.volume;
        // the sky is never seen from below except through the surface's own Snell's window
        skyLayer.enabled = !submerged;
        if (submerged) {
            const ext = [3.2, 1, .6].map(e => e / vol.visibility);
            const sunC = sky.getSunColor(), sunUp = Math.max(sky.getSunDirection().y, 0);
            const sc = vol.color;
            app.scene.fog.type = FOG_EXP;
            app.scene.fog.density = (ext[0] + ext[1] + ext[2]) / 3;
            // the surface shader scatters against the sky's upward irradiance; the zenith and
            // horizon reads stand in for it, scaled by the sky exposure as the shader's sample is
            const amb = (z, h) => (z * 0.65 + h * 0.35) * sky.params.exposure;
            app.scene.fog.color.set(
                sc[0] * (amb(zenith.r, horizon.r) + sunC.r * sunUp * 0.318),
                sc[1] * (amb(zenith.g, horizon.g) + sunC.g * sunUp * 0.318),
                sc[2] * (amb(zenith.b, horizon.b) + sunC.b * sunUp * 0.318));
            camera.camera.clearColor.copy(app.scene.fog.color);
        } else {
            app.scene.fog.type = FOG_EXP2;
            app.scene.fog.density = sky.aerialDensity;
            app.scene.fog.color.copy(horizon);
        }
        const cinematic = post.cinematic;
        const closeFocus = cinematic && !manual && SHOTS[director.index]?.id === 'adrift' && !submerged;
        frame.waterFocus = closeFocus;
        frame.seaLevel = water.seaLevel;
        frame.dof.enabled = closeFocus;
        if (closeFocus) {
            frame.dof.focusDistance = camera.getPosition().distance(buoyFocus);
            frame.dof.focusRange = 7;
            frame.dof.blurRadius = 4;
        }
        frame.bloom.enabled = cinematic;
        frame.bloom.blurLevel = 6;
        frame.vignette.enabled = cinematic;
        frame.vignette.intensity = 0.18;
        frame.colorEnhance.enabled = cinematic;
        frame.colorEnhance.vibrance = 0.035;
        frame.colorEnhance.shadows = -0.01;
        frame.colorEnhance.highlights = -0.035;
        frame.grading.enabled = cinematic;
        frame.rendering.sharpness = cinematic ? 0.03 : 0;
        frame.volumetricFog.enabled = post.volumetric && !submerged;


        if (director.active) shotEl.classList.toggle('show', (director.fade ?? 0) > 0.5);
        else shotEl.classList.remove('show');

        acc += dt; frames++;
        if (acc > 0.5) { fpsEl.textContent = Math.round(frames / acc); acc = 0; frames = 0; }
    });

    if (import.meta.env.DEV && params.has('compare')) {
        const { installRenderComparison } = await import('./renderComparison.js');
        renderComparison = installRenderComparison({ app, device, frame, director, water, params });
    }
    if (params.has('profile')) {
        const { installProfile } = await import('./profile.js');
        installProfile({ app, device, water, frame, director, sun, params });
    }

    window.__water = { app, water, sky, camera, device, frame, director };
    // Bind the FFT textures before the camera can draw the newly created surface.
    water.update(1 / 60, camera);
    camera.camera.enabled = true;
    if (!suppliedApp) app.start();

    // give the first frames a moment to compile shaders before revealing the scene
    let ready = 0;
    const reveal = () => {
        if (++ready < 12) { requestAnimationFrame(reveal); return; }
        el('loader').classList.add('gone');
        setTimeout(() => el('loader').remove(), 1000);
    };
    requestAnimationFrame(reveal);
    return { app, water, sky, camera, sun, director };
}
