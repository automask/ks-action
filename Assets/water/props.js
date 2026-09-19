import { Entity, Color, Vec3, Quat, StandardMaterial, Mesh, MeshInstance, TorusGeometry } from 'playcanvas';

// ---------------------------------------------------------------------------------------------
// Procedural props. An empty sea has no scale: without something in it whose size you already
// know, a two metre chop and a twenty metre swell look identical. Everything here exists to give
// the eye that reference — and to give the reflections, the foam and the depth something to catch on.
// ---------------------------------------------------------------------------------------------

function hash(n) {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
}

export function material(diffuse, gloss, metalness = 0) {
    const m = new StandardMaterial();
    m.diffuse = new Color(...diffuse);
    m.gloss = gloss;
    m.useMetalness = true;
    m.metalness = metalness;
    m.update();
    return m;
}

// The engine's default torus has a very thick tube, which makes small metal rings look inflated.
const ringMeshes = new WeakMap();
function ringMesh(device) {
    if (!ringMeshes.has(device)) {
        ringMeshes.set(device, Mesh.fromGeometry(device, new TorusGeometry({
            ringRadius: 0.465, tubeRadius: 0.035, segments: 32, sides: 8
        })));
    }
    return ringMeshes.get(device);
}

/**
 * A steel channel buoy: a welded can with a conical collar, a lattice tower and a lantern. Built from
 * the parts a real one has, because that is what makes an object read as equipment rather than as a
 * primitive with a colour on it.
 *
 * @param {import('playcanvas').GraphicsDevice} device - Graphics device.
 * @param {number} scale - Overall size; 1 is roughly a 2 m buoy.
 * @param {object} mats - Shared materials.
 * @returns {Entity} The buoy, with its waterline at y = 0.
 */
export function createBuoy(device, scale, mats) {
    const root = new Entity('Buoy');
    const s = scale;
    const part = (name, type, mat, pos, sc, rot) => {
        const e = new Entity(name);
        e.addComponent('render', type === 'torus'
            ? { meshInstances: [new MeshInstance(ringMesh(device), mat)], castShadows: true }
            : { type, material: mat, castShadows: true });
        e.setLocalPosition(pos[0] * s, pos[1] * s, pos[2] * s);
        e.setLocalScale(sc[0] * s, sc[1] * s, sc[2] * s);
        if (rot) e.setLocalEulerAngles(rot[0], rot[1], rot[2]);
        root.addChild(e);
        return e;
    };

    // hull: a squat can with a rolled rim, sitting a third out of the water
    part('can', 'cylinder', mats.hull, [0, 0.18, 0], [1.5, 0.62, 1.5]);
    part('rim', 'torus', mats.rust, [0, 0.48, 0], [1.5, 1.5, 1.5]);
    // the conical skirt below, which is what keeps it upright
    part('skirt', 'cone', mats.rust, [0, -0.62, 0], [1.45, 1.05, 1.45], [180, 0, 0]);
    // counterweight tube trailing under it
    part('tail', 'cylinder', mats.rust, [0, -1.5, 0], [0.3, 1.1, 0.3]);

    // Connect actual beam endpoints, so the tower remains a continuous welded structure.
    // The lower collar overlaps the can's top at 0.49 m; the platform carries the lantern.
    part('deck-collar', 'cylinder', mats.rust, [0, 0.51, 0], [0.72, 0.10, 0.72]);
    const beam = (name, from, to, diameter) => {
        const d = new Vec3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        const length = d.length();
        d.divScalar(length);
        const e = part(name, 'cylinder', mats.steel,
            from.map((v, i) => (v + to[i]) * 0.5), [diameter, length, diameter]);
        const axis = new Vec3(d.z, 0, -d.x);
        if (axis.length() > 1e-6) {
            e.setLocalRotation(new Quat().setFromAxisAngle(axis.normalize(), Math.acos(d.y) * 180 / Math.PI));
        }
        return e;
    };
    const foot = [], crown = [];
    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI * 0.5 + Math.PI * 0.25;
        foot.push([Math.cos(a) * 0.30, 0.54, Math.sin(a) * 0.30]);
        crown.push([Math.cos(a) * 0.16, 1.85, Math.sin(a) * 0.16]);
        beam(`leg${i}`, foot[i], crown[i], 0.065);
    }
    for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        beam(`brace${i}`, foot[i], crown[j], 0.036);
    }
    part('lower-ring', 'torus', mats.steel, [0, 0.57, 0], [0.65, 0.65, 0.65]);
    part('upper-ring', 'torus', mats.steel, [0, 1.83, 0], [0.38, 0.38, 0.38]);
    part('lantern-platform', 'cylinder', mats.steel, [0, 1.87, 0], [0.44, 0.10, 0.44]);
    part('lantern', 'cylinder', mats.lamp, [0, 2.045, 0], [0.28, 0.26, 0.28]);
    part('cap', 'cone', mats.steel, [0, 2.255, 0], [0.36, 0.18, 0.36]);

    return root;
}

/**
 * A cluster of weathered timber piles — a mooring dolphin. Three or four leaning trunks bound at the
 * top, standing in a couple of metres of water: an unmistakable piece of coast, and a vertical the
 * eye can measure the swell against.
 *
 * @param {import('playcanvas').GraphicsDevice} device - Graphics device.
 * @param {number[]} at - World XZ to stand it at.
 * @param {number} seabedY - Sea-bed height there, so the piles reach the bottom.
 * @param {object} mats - Shared materials.
 * @returns {Entity} The dolphin.
 */
export function createPiles(device, at, seabedY, mats) {
    const root = new Entity('Piles');
    root.setPosition(at[0], 0, at[1]);
    const n = 4;
    const height = -seabedY + 3.4;
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.7;
        const r = 0.75;
        const lean = 5 + hash(i + at[0]) * 4;
        const h = height * (0.86 + hash(i * 3.1 + at[1]) * 0.22);
        const p = new Entity(`pile${i}`);
        p.addComponent('render', { type: 'cylinder', material: mats.timber, castShadows: true });
        p.setLocalScale(0.34, h, 0.34);
        p.setLocalPosition(Math.cos(a) * r, seabedY + h * 0.5, Math.sin(a) * r);
        p.setLocalEulerAngles(-Math.sin(a) * lean, 0, Math.cos(a) * lean);
        root.addChild(p);
    }
    // the band that holds them together, just above the waterline
    const band = new Entity('band');
    band.addComponent('render', { meshInstances: [new MeshInstance(ringMesh(device), mats.rust)], castShadows: true });
    band.setLocalScale(1.5, 1.5, 1.5);
    band.setLocalPosition(0, 2.3, 0);
    root.addChild(band);
    return root;
}

/**
 * Gulls. Two wings and a body, wheeling on long slow circles and flapping now and then. Almost
 * nothing on screen, and the single cheapest way to put a sky in motion and a sea in scale.
 */
export class Birds {
    /**
     * @param {import('playcanvas').AppBase} app - The application.
     * @param {number} [count] - How many.
     */
    constructor(app, count = 7) {
        const mat = material([0.86, 0.87, 0.9], 0.25);
        const dark = material([0.16, 0.17, 0.2], 0.25);
        this.items = [];
        for (let i = 0; i < count; i++) {
            const root = new Entity(`Gull${i}`);
            const body = new Entity('body');
            body.addComponent('render', { type: 'capsule', material: mat, castShadows: false });
            body.setLocalScale(0.16, 0.42, 0.16);
            body.setLocalEulerAngles(90, 0, 0);
            root.addChild(body);

            const wings = [];
            for (const side of [-1, 1]) {
                const w = new Entity('wing');
                w.addComponent('render', { type: 'box', material: mat, castShadows: false });
                w.setLocalScale(0.62, 0.03, 0.2);
                w.setLocalPosition(side * 0.34, 0, 0);
                const tip = new Entity('wingtip');
                tip.addComponent('render', { type: 'box', material: dark, castShadows: false });
                tip.setLocalScale(0.3, 1.05, 1);
                tip.setLocalPosition(side * 0.38, 0, 0);
                w.addChild(tip);
                root.addChild(w);
                wings.push({ e: w, side });
            }
            app.root.addChild(root);
            this.items.push({
                root, wings,
                centre: [(hash(i) - 0.5) * 260, (hash(i + 9) - 0.5) * 260],
                radius: 40 + hash(i + 3) * 90,
                height: 14 + hash(i + 5) * 34,
                speed: 0.09 + hash(i + 7) * 0.07,
                phase: hash(i + 11) * 6.283,
                flap: 1.6 + hash(i + 13) * 1.4
            });
        }
        this._p = new Vec3();
        this.time = 0;
    }

    /** @param {number} dt - Frame delta time. */
    update(dt, camera = null) {
        this.time += dt;
        for (const b of this.items) {
            const a = this.time * b.speed + b.phase;
            const x = b.centre[0] + Math.cos(a) * b.radius;
            const z = b.centre[1] + Math.sin(a) * b.radius;
            const y = b.height + Math.sin(a * 2.3) * 2.5;
            b.root.setPosition(x, y, z);
            b.root.enabled = this._visible !== false && (!camera || b.root.getPosition().distance(camera.getPosition()) > 90);
            // face along the tangent of the circle
            b.root.lookAt(x - Math.sin(a), y + Math.cos(a * 2.3) * 5.75 / b.radius, z + Math.cos(a));
            b.root.rotateLocal(0, 0, -8);
            // a burst of flapping between long glides
            const cycle = (Math.sin(a * 3.1) + 1) * 0.5;
            const beat = Math.sin(this.time * b.flap * 6.0) * Math.max(0, cycle - 0.45) * 2.0;
            for (const w of b.wings) w.e.setLocalEulerAngles(0, 0, w.side * beat * 26);
        }
    }

    set visible(value) {
        if (this._visible === value) return;
        this._visible = value;
        for (const { root } of this.items) root.enabled = value;
    }
}
