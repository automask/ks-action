import {
    AppBase, AppOptions, createGraphicsDevice, Entity, Color,
    CameraComponentSystem, RenderComponentSystem, LightComponentSystem, ScriptComponentSystem,
    DEVICETYPE_WEBGPU, DEVICETYPE_WEBGL2
} from 'playcanvas';
import { CameraFrame } from 'playcanvas/scripts/esm/camera-frame.mjs';
import { Sky } from '../src/sky/index.js';

// This example uses only the atmosphere package. There is no water or demo-scene dependency.
const STUDIES = {
    daylight: {
        label: '01 / Daylight', title: 'Blue, all the<br>way up.',
        description: 'Shorter wavelengths scatter across the sky. A clear atmosphere reveals a deep blue zenith and a pale, luminous horizon.',
        params: { sunElevation: 42, haze: 0.35, exposure: 0.55 },
        pitch: 25
    },
    golden: {
        label: '02 / Golden hour', title: 'Light, at the<br>edge of day.',
        description: 'Amber light gathers around the low sun. Above it, the last blue of the day opens into a deeper sky.',
        params: { sunElevation: 3.2, haze: 1.4, exposure: 0.9 },
        pitch: 10
    },
    twilight: {
        label: '03 / Afterglow', title: 'Just beyond<br>the horizon.',
        description: 'The sun has set here. Higher layers of air still catch its light, leaving a quiet ribbon of warmth beneath the blue.',
        params: { sunElevation: -2, haze: 0.65, exposure: 3.2 },
        pitch: 8
    }
};

async function main() {
    const canvas = document.getElementById('sky');
    const query = new URLSearchParams(location.search);
    if (query.has('clean')) document.body.classList.add('clean');
    const requested = query.get('gfx');
    const deviceTypes = requested === 'webgl2' ? [DEVICETYPE_WEBGL2]
        : requested === 'webgpu' ? [DEVICETYPE_WEBGPU] : [DEVICETYPE_WEBGPU, DEVICETYPE_WEBGL2];
    const device = await createGraphicsDevice(canvas, { deviceTypes, antialias: false, alpha: false });
    device.maxPixelRatio = Math.min(window.devicePixelRatio, 2);
    const app = new AppBase(canvas);
    const options = new AppOptions();
    options.graphicsDevice = device;
    options.componentSystems = [CameraComponentSystem, RenderComponentSystem, LightComponentSystem, ScriptComponentSystem];
    app.init(options);
    app.setCanvasFillMode('FILL_WINDOW');
    app.setCanvasResolution('AUTO');
    window.addEventListener('resize', () => app.resizeCanvas());

    const camera = new Entity('Sky camera');
    camera.addComponent('camera', { fov: 55, nearClip: 0.1, farClip: 10000, clearColor: new Color(0.015, 0.025, 0.045) });
    camera.addComponent('script');
    app.root.addChild(camera);
    const frame = camera.script.create(CameraFrame);
    frame.rendering.renderFormat = 'rgba16';
    frame.rendering.samples = 1;
    frame.rendering.toneMapping = 'aces2';
    frame.bloom.enabled = true;
    frame.bloom.intensity = 0.012;
    frame.bloom.blurLevel = 6;

    let studyName = Object.hasOwn(STUDIES, query.get('study')) ? query.get('study') : 'golden';
    const sky = new Sky(app, STUDIES[studyName].params);
    let yaw = 0, pitch = 0, drag = null, updateTimer;
    const faceSun = () => {
        yaw = sky.params.sunAzimuth - 14;
        pitch = STUDIES[studyName].pitch;
        camera.camera.fov = 55;
        updateView();
    };
    function updateView() {
        const az = yaw * Math.PI / 180, el = pitch * Math.PI / 180;
        camera.lookAt(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    }
    canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        drag = [event.clientX, event.clientY];
        canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
        if (!drag) return;
        yaw += (event.clientX - drag[0]) * 0.12;
        pitch = Math.max(-15, Math.min(88, pitch + (event.clientY - drag[1]) * 0.12));
        drag = [event.clientX, event.clientY];
        updateView();
    });
    const stopDrag = () => { drag = null; };
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
    canvas.addEventListener('lostpointercapture', stopDrag);
    canvas.addEventListener('wheel', event => {
        event.preventDefault();
        camera.camera.fov = Math.max(28, Math.min(90, camera.camera.fov + event.deltaY * 0.035));
    }, { passive: false });
    document.getElementById('reset-view').addEventListener('click', faceSun);

    const elevation = document.getElementById('elevation');
    const haze = document.getElementById('haze');
    function updateLabels() {
        document.getElementById('elevation-value').value = `${Number(elevation.value).toFixed(1)}°`;
        document.getElementById('haze-value').value = `${Number(haze.value).toFixed(1)}×`;
    }
    function commitControls() {
        clearTimeout(updateTimer);
        sky.setParams({ sunElevation: Number(elevation.value), haze: Number(haze.value) });
    }
    for (const input of [elevation, haze]) {
        input.addEventListener('input', () => {
            updateLabels();
            clearTimeout(updateTimer);
            updateTimer = setTimeout(commitControls, 160);
        });
        input.addEventListener('change', commitControls);
    }
    function selectStudy(name) {
        clearTimeout(updateTimer);
        studyName = name;
        const study = STUDIES[name];
        sky.resetParams(study.params);
        document.getElementById('eyebrow').textContent = study.label;
        document.getElementById('study-title').innerHTML = study.title;
        document.getElementById('study-description').textContent = study.description;
        for (const button of document.querySelectorAll('[data-study]')) button.setAttribute('aria-pressed', String(button.dataset.study === name));
        elevation.value = sky.params.sunElevation;
        haze.value = sky.params.haze;
        updateLabels();
        faceSun();
    }
    for (const button of document.querySelectorAll('[data-study]')) button.addEventListener('click', () => selectStudy(button.dataset.study));
    selectStudy(studyName);

    sky.onUpdate = () => {
        const status = document.getElementById('status');
        status.classList.add('ready');
        status.setAttribute('aria-hidden', 'true');
    };
    // Capture the submitted drawing buffer after the initial sky has settled. Development only.
    let captureName = import.meta.env.DEV ? query.get('capture') : null;
    let readyFrames = 0;
    app.on('frameend', () => {
        if (!captureName || !sky.ready || ++readyFrames < 3) return;
        const name = captureName;
        captureName = null;
        canvas.toBlob(async blob => {
            try {
                if (!blob) throw new Error('Sky capture returned an empty image.');
                const response = await fetch(`/__shot?name=${encodeURIComponent(name)}&ext=png`, { method: 'POST', body: blob });
                if (!response.ok) throw new Error('Sky capture could not be saved.');
                document.body.dataset.captured = name;
            } catch (error) { console.error(error); }
        }, 'image/png');
    });
    window.atmosphereDemo = { app, sky, camera, selectStudy, frame };
    app.start();
}

main().catch(error => {
    console.error(error);
    const status = document.getElementById('status');
    status.className = 'failed';
    status.firstElementChild.textContent = `The atmosphere could not start.\n\n${error.stack || error}`;
});
