import { Vec3 } from 'playcanvas';

const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Gallery art direction. Each example owns a distinct visual question and a camera composition.
 * `intent` describes what should be legible in a render; it is deliberately not a water setting.
 * Stable ids also identify examples in URLs and render captures.
 */
export const SHOTS = [
    {
        id: 'stillwater', name: 'Stillwater', preset: 'Glass',
        sub: 'Sheltered water · long reflections',
        intent: 'A quiet silver-blue surface, with reflected rock silhouettes and almost no whitecaps.',
        duration: 18,
        from: [-78, 3.3, 143], to: [-64, 2.6, 128],
        lookFrom: [-26, 0.5, 23], lookTo: [-22, 0.5, 16],
        focus: 115, focusRange: 180, blur: 0.5, fov: 44, drift: 0.2
    },
    {
        id: 'open-water', name: 'Open water', preset: 'Breeze',
        sub: 'Wind and swell · deep ocean',
        intent: 'Open horizon and layered blue wind waves; no coast or props to hide the wave field.',
        duration: 18,
        from: [-156, 6.0, 205], to: [-144, 4.2, 224],
        lookFrom: [-265, 1.5, 420], lookTo: [-258, 1.0, 438],
        focus: 80, focusRange: 180, blur: 0.5, fov: 48, drift: 0.5
    },
    {
        id: 'golden-hour', name: 'Glitter path', preset: 'Golden hour',
        sub: 'Low sun · amber light',
        intent: 'The low warm sun and a continuous, broken reflection path reach the waterline camera.',
        duration: 19,
        from: [-70, 2.4, 120], to: [-68, 2.4, 117],
        lookFrom: [32.6, 6.4, -161.7], lookTo: [34.6, 6.4, -164.7],
        focus: 100, focusRange: 180, blur: 0.5, fov: 44, drift: 0.15
    },
    {
        id: 'shallows', name: 'The turquoise shelf', preset: 'Tropical shallows',
        sub: 'Clear water · sand and caustics',
        intent: 'An elevated oblique view reads the sand-to-turquoise-to-deep-blue depth gradient.',
        duration: 20,
        from: [22, 58, 142], to: [36, 46, 119],
        lookFrom: [80, -2, 96], lookTo: [82, -2, 78],
        focus: 85, focusRange: 140, blur: 0.5, fov: 48, drift: 0.1
    },
    {
        id: 'beneath', name: 'Beneath the surface', preset: 'Tropical shallows',
        sub: "Snell's window · submerged light",
        intent: 'A bright window opens to the sky; beyond its edge, the surface reflects the sea back into itself.',
        duration: 16,
        from: [101, -2.8, 20], to: [106, -2.2, 29],
        lookFrom: [118, 5, 13], lookTo: [122, 4, 21],
        focus: 12, focusRange: 35, blur: 0.5, fov: 70, drift: 0.08
    },
    {
        id: 'caustics', name: 'Focused light', preset: 'Tropical shallows',
        sub: 'Refracted sunlight · moving caustics',
        intent: 'Curved ribbons of concentrated sunlight move across the sand. Toggle Caustics in Studio to compare the receiving surface.',
        duration: 18,
        from: [104, -0.9, 34], to: [108, -0.8, 30],
        lookFrom: [112, -5, 28], lookTo: [116, -5, 24],
        focus: 5, focusRange: 20, blur: 0.5, fov: 48, drift: 0.04
    },
    {
        id: 'weather', name: 'Heavy weather', preset: 'Storm',
        sub: 'Breaking crests · 22 m/s wind',
        intent: 'Strong wind raises steep, overlapping crests. Whitecaps linger against a hazy slate horizon.',
        duration: 18,
        from: [-148, 8, -104], to: [-144, 7, -120],
        lookFrom: [-420, 2, -120], lookTo: [-430, 2, -130],
        focus: 90, focusRange: 160, blur: 0.5, fov: 52, drift: 0.65
    },
    {
        id: 'adrift', name: 'Adrift', preset: 'Glass',
        sub: 'Buoyancy · reflected colour',
        intent: 'A close buoy provides metre-scale evidence of wave motion and coloured scene reflections.',
        duration: 18,
        from: [7, 2.2, 12], to: [3, 1.6, 9],
        lookFrom: [-2, 0.8, -2], lookTo: [-2, 0.8, -2],
        focus: 14, focusRange: 24, blur: 1.0, fov: 38, drift: 0.12
    },
    {
        id: 'blue-hour', name: 'Afterglow', preset: 'Afterglow',
        sub: 'After sunset · atmospheric light',
        intent: 'The sun has set, but the atmosphere still glows. Violet-blue reflections carry the shape of the sea.',
        duration: 18,
        from: [-190, 3.8, 150], to: [-175, 3.0, 168],
        lookFrom: [-136, 10, 351], lookTo: [-121, 9, 369],
        focus: 90, focusRange: 180, blur: 0.5, fov: 42, drift: 0.25
    }
];

/** Plays, pauses and seeks the demo's camera sequence without adding camera policy to Water. */
export class Director {
    constructor({ camera, water, sky, cameraFrame, applyPreset, onShot }) {
        this.camera = camera;
        this.water = water;
        this.sky = sky;
        this.frame = cameraFrame;
        this.applyPreset = applyPreset;
        this.onShot = onShot;
        this.index = -1;
        this.t = 0;
        this.active = true;
        this.paused = false;
        this._pos = new Vec3();
        this._look = new Vec3();
        this.next();
    }

    /** Jump by index (wrapping) or stable shot id and immediately apply its starting pose. */
    go(shot) {
        const i = typeof shot === 'string' ? SHOTS.findIndex(s => s.id === shot) : shot;
        if (!Number.isInteger(i) || (typeof shot === 'string' && i < 0)) {
            throw new RangeError(`Unknown demo shot: ${shot}`);
        }
        this.index = ((i % SHOTS.length) + SHOTS.length) % SHOTS.length;
        this.t = 0;
        const s = SHOTS[this.index];
        this.applyPreset(this.water, this.sky, s.preset, this.frame);
        this.camera.camera.fov = s.fov;
        this._pose();
        this.onShot?.(s, this.index);
    }

    next() { this.go(this.index + 1); }
    prev() { this.go(this.index - 1); }
    release() { this.active = false; }
    resume() { this.active = true; this.paused = false; this.go(this.index); }

    /** Freeze the camera at a repeatable time within the current shot; water keeps simulating. */
    seek(seconds) {
        if (!Number.isFinite(seconds)) throw new TypeError('Shot time must be finite.');
        this.t = Math.max(0, Math.min(seconds, SHOTS[this.index].duration));
        this.paused = true;
        this._pose();
    }

    _pose() {
        const s = SHOTS[this.index];
        const u = smooth(Math.min(this.t / s.duration, 1));
        const p = this._pos.set(
            lerp(s.from[0], s.to[0], u),
            lerp(s.from[1], s.to[1], u),
            lerp(s.from[2], s.to[2], u)
        );
        const w = this.t, drift = s.drift ?? 0;
        p.x += (Math.sin(w * 0.31) * 0.5 + Math.sin(w * 0.11) * 0.9) * drift;
        p.y += Math.sin(w * 0.27 + 1.3) * 0.16 * drift;
        p.z += Math.cos(w * 0.23 + 0.7) * 0.5 * drift;
        this.camera.setPosition(p);
        this._look.set(
            lerp(s.lookFrom[0], s.lookTo[0], u),
            lerp(s.lookFrom[1], s.lookTo[1], u),
            lerp(s.lookFrom[2], s.lookTo[2], u)
        );
        this.camera.lookAt(this._look);
        Object.assign(this.frame.dof, {
            focusDistance: s.focus, focusRange: s.focusRange, blurRadius: s.blur
        });
        this.fade = this.paused ? 1 : Math.min(1, this.t / 1.2) * Math.min(1, (s.duration - this.t) / 2);
    }

    update(dt) {
        if (!this.active || this.paused) return;
        this.t += dt;
        if (this.t >= SHOTS[this.index].duration) { this.next(); return; }
        this._pose();
    }
}
