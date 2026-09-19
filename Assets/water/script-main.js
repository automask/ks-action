import {
    AppBase, AppOptions, createGraphicsDevice, Entity, Color, StandardMaterial, registerScript,
    CameraComponentSystem, RenderComponentSystem, LightComponentSystem, ScriptComponentSystem,
    DEVICETYPE_WEBGPU, DEVICETYPE_WEBGL2
} from 'playcanvas';
import { CameraFrame } from 'playcanvas/scripts/esm/camera-frame.mjs';
import { WaterScript, SkyScript } from '../src/scripts/index.js';

async function main() {
    const query = new URLSearchParams(location.search);
    const canvas = document.getElementById('application');
    const deviceTypes = query.get('gfx') === 'webgl2' ? [DEVICETYPE_WEBGL2] : [DEVICETYPE_WEBGPU, DEVICETYPE_WEBGL2];
    const device = await createGraphicsDevice(canvas, { deviceTypes, antialias: false, alpha: false });
    device.maxPixelRatio = Math.min(devicePixelRatio, 1.5);
    const app = new AppBase(canvas);
    const options = new AppOptions();
    options.graphicsDevice = device;
    options.componentSystems = [CameraComponentSystem, RenderComponentSystem, LightComponentSystem, ScriptComponentSystem];
    app.init(options);
    app.setCanvasFillMode('FILL_WINDOW');
    app.setCanvasResolution('AUTO');
    const resize = () => app.resizeCanvas();
    addEventListener('resize', resize);

    registerScript(WaterScript, undefined, app);
    registerScript(SkyScript, undefined, app);
    const camera = new Entity('Application camera');
    camera.addComponent('camera', { fov: 48, nearClip: 0.1, farClip: 30000, clearColor: new Color(0.025, 0.04, 0.06) });
    camera.setPosition(4, 4, 15);
    camera.lookAt(0, 0.6, -6);
    camera.addComponent('script');
    app.root.addChild(camera);
    const frame = camera.script.create(CameraFrame);
    frame.rendering.renderFormat = 'rgba16';
    frame.rendering.toneMapping = 'aces2';
    frame.rendering.samples = 1;

    const sun = new Entity('Application sunlight');
    sun.addComponent('light', { type: 'directional', castShadows: true, shadowDistance: 70, shadowResolution: 1024 });
    sun.addComponent('script');
    app.root.addChild(sun);
    const sky = sun.script.create('atmosphereSky', {
        properties: { sunElevation: 18, sunAzimuth: 160, haze: 0.6, exposure: 0.55 }
    });
    const ocean = new Entity('Water component');
    ocean.addComponent('script');
    app.root.addChild(ocean);
    const water = ocean.script.create('waterSurface', {
        properties: { cameraEntity: camera, skyEntity: sun, windSpeed: 5, waveHeight: 0.7, quality: 'low' }
    });

    // These reference objects deliberately do not belong to either renderer or wrapper.
    const makeBox = (name, color, position, scale) => {
        const material = new StandardMaterial();
        material.diffuse = new Color(...color);
        material.gloss = 0.35;
        material.update();
        const entity = new Entity(name);
        entity.addComponent('render', { type: 'box', material });
        entity.setPosition(...position);
        entity.setLocalScale(...scale);
        app.root.addChild(entity);
        return entity;
    };
    makeBox('Sand below water', [0.4, 0.33, 0.22], [0, -4.5, 0], [100, 1, 100]);
    makeBox('Red reflection marker', [0.7, 0.035, 0.018], [0, 0.5, -3], [1.5, 3, 1.5]);
    makeBox('Stone reference', [0.22, 0.25, 0.27], [-6, 0, -10], [3, 4, 3]);

    const status = document.getElementById('status');
    const refresh = () => {
        document.body.dataset.waterReady = String(Boolean(water.water));
        document.body.dataset.skyReady = String(Boolean(sky.sky?.ready));
        status.textContent = `${water.water ? 'Water ready' : water.enabled ? 'Waiting for sky' : 'Water disabled'} · ${device.isWebGPU ? 'WebGPU' : 'WebGL2'}`;
        document.getElementById('water-toggle').textContent = water.enabled ? 'Disable water' : 'Enable water';
        document.getElementById('sky-toggle').textContent = sky.enabled ? 'Disable sky' : 'Enable sky';
    };
    water.on('water:ready', refresh);
    water.on('water:before-destroy', () => queueMicrotask(refresh));
    sky.on('sky:ready', refresh);
    document.getElementById('water-toggle').addEventListener('click', () => { water.enabled = !water.enabled; refresh(); });
    document.getElementById('sky-toggle').addEventListener('click', () => { sky.enabled = !sky.enabled; refresh(); });
    document.getElementById('wind').addEventListener('input', event => { water.windSpeed = Number(event.target.value); });
    app.on('destroy', () => removeEventListener('resize', resize));
    app.start();
    refresh();
}
main().catch(error => {
    console.error(error);
    document.getElementById('error').textContent = error.stack ?? String(error);
});
