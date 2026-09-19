import { Entity, Color, Vec3, Quat, StandardMaterial, Asset, ADDRESS_REPEAT } from 'playcanvas';
import { createBuoy, createPiles, material } from './props.js';
import { applyTerrain, applyRockWaterline } from './triplanar.js';
import { loadBathymetry, seabedHeight } from './bathymetry.js';
export { seabedHeight } from './bathymetry.js';

// ---------------------------------------------------------------- assets
// Scanned rocks and ground from Poly Haven (CC0); see demo/assets/README.md for what each is.
const ASSETS = `${import.meta.env?.BASE_URL ?? '/'}demo/assets`;

/** Scanned PBR sets for the terrain, and the real-world size of one tile of each. */
const GROUND = {
    sand: { id: 'coast_sand_01', tile: 3 },
    grass: { id: 'coast_land_rocks_01', tile: 20 },
    rock: { id: 'rock_face_03', tile: 2.7, arm: true }   // only the rock's AO / roughness map is used
};

function loadAsset(app, asset) {
    return new Promise((resolve, reject) => {
        asset.once('load', () => resolve(asset));
        asset.once('error', err => reject(new Error(`${asset.name}: ${err}`)));
        app.assets.add(asset);
        app.assets.load(asset);
    });
}

async function loadGroundSet(app, { id, tile, arm: arm_ = false }, assets = ASSETS) {
    const tex = async (map, srgb) => {
        const a = await loadAsset(app, new Asset(`${id}_${map}`, 'texture',
            { url: `${assets}/textures/${id}/${id}_${map}_2k.jpg` }, { srgb, mipmaps: true, anisotropy: 4 }));
        a.resource.addressU = ADDRESS_REPEAT;
        a.resource.addressV = ADDRESS_REPEAT;
        return a.resource;
    };
    const [albedo, normal, arm] = await Promise.all([tex('diffuse', true), tex('nor_gl', false), arm_ ? tex('arm', false) : null]);
    return { albedo, normal, arm, tile };
}

/**
 * Load an optional authored environment without rewriting its material model.
 *
 * This is an art-asset comparison only: the default heightfield remains the bathymetry source.
 * In particular, Saltreach contains foliage, wood and soil as well as rocks; applying the rock
 * waterline chunk to all materials corrupts its authored material behaviour. The source is
 * about 198 MiB with 1.44 million base triangles before vegetation instances, so it stays opt-in.
 * A production example needs a model-derived shore map and a separately budgeted delivery asset.
 */
export async function loadCoastModel(app, url, at) {
    const asset = await loadAsset(app, new Asset(url.split('/').pop(), 'container', { url }));
    const e = asset.resource.instantiateRenderEntity();
    e.name = 'Coast asset study (separate bathymetry required)';
    for (const rc of e.findComponents('render')) { rc.castShadows = true; rc.receiveShadows = true; }
    e.setPosition(at[0], at[1], at[2]);
    app.root.addChild(e);
    return e;
}

/** Load the offline-authored coast. Geometry and bathymetry share the same Blender source. */
export async function buildSeabed(app, device, seaLevel = 0, assets = ASSETS) {
    const [sand, grass, rock, coast] = await Promise.all([
        loadGroundSet(app, GROUND.sand, assets), loadGroundSet(app, GROUND.grass, assets), loadGroundSet(app, GROUND.rock, assets),
        loadAsset(app, new Asset('Authored coast', 'container', { url: `${assets}/coast/coast.glb` })),
        loadBathymetry(`${assets}/coast`)
    ]);
    const mat = new StandardMaterial();
    mat.diffuse = new Color(1, 1, 1);
    mat.metalness = 0;
    mat.useMetalness = true;
    applyTerrain(mat, { sand, grass, rock, tileMetres: [sand.tile, grass.tile, rock.tile], seaLevel });
    const terrain = coast.resource.instantiateRenderEntity();
    terrain.name = 'Authored coast';
    const rockMaterials = new Set();
    for (const rc of terrain.findComponents('render')) {
        rc.castShadows = true;
        rc.receiveShadows = true;
        for (const mi of rc.meshInstances) {
            if (mi.material.name === 'CoastTerrain') mi.material = mat;
            else rockMaterials.add(mi.material);
        }
    }
    for (const material of rockMaterials) applyRockWaterline(material, seaLevel);
    app.root.addChild(terrain);
    const mats = { timber: material([0.30, 0.24, 0.17], 0.22), rust: material([0.36, 0.17, 0.10], 0.3) };
    for (const at of [[92, 62], [118, 30]])
        app.root.addChild(createPiles(device, at, seabedHeight(at[0], at[1]), mats));
    return { terrain, material: mat };
}

/**
 * Navigation buoys that ride the simulated surface. Each buoy asks the water for the surface point
 * and normal under a few points of its hull, which is what turns a wave field into something the
 * eye can read the scale and motion of.
 */
export class Floaters {
    /**
     * @param {import('playcanvas').AppBase} app - The application.
     * @param {import('../src/index.js').Water} water - Water to float on.
     */
    constructor(app, water) {
        this.app = app;
        this.water = water;
        this.items = [];

        const mats = {
            hull: material([0.60, 0.10, 0.05], 0.42),
            hullB: material([0.78, 0.55, 0.06], 0.42),
            hullG: material([0.10, 0.42, 0.22], 0.42),
            rust: material([0.34, 0.16, 0.09], 0.28),
            steel: material([0.40, 0.42, 0.44], 0.55, 0.6),
            lamp: material([0.85, 0.88, 0.9], 0.8),
            timber: material([0.30, 0.24, 0.17], 0.22)
        };

        const specs = [
            { at: [-2, -2], scale: 1.0, hull: mats.hull },
            { at: [18, 31], scale: 0.85, hull: mats.hullG },
            { at: [80, 74], scale: 0.85, hull: mats.hullB },
            { at: [112, 48], scale: 0.7, hull: mats.hull }
        ];

        for (const spec of specs) {
            const root = createBuoy(app.graphicsDevice, spec.scale, { ...mats, hull: spec.hull });
            app.root.addChild(root);
            this.items.push({
                root,
                x: spec.at[0], z: spec.at[1],
                draft: 0.0,
                span: 1.1 * spec.scale,
                quat: new Quat()
            });
        }

        this._a = new Vec3(); this._b = new Vec3(); this._n = new Vec3();
        this._q = new Quat(); this._up = new Vec3(0, 1, 0); this._axis = new Vec3();
    }

    /**
     * @param {number} dt - Frame delta time.
     */
    update(dt) {
        const w = this.water;
        const k = Math.min(1, dt * 6);   // critically-ish damped follow, so buoys lag the surface a little
        for (const it of this.items) {
            const c = w.getSurfaceAt(it.x, it.z);
            // two extra samples across the hull give a tilt that responds to the local wave slope
            const sx = w.getSurfaceAt(it.x + it.span, it.z);
            const sz = w.getSurfaceAt(it.x, it.z + it.span);

            const p = it.root.getPosition();
            const targetY = c.position.y - it.draft;
            it.root.setPosition(it.x, p.y + (targetY - p.y) * k, it.z);

            this._a.set(it.span, sx.position.y - c.position.y, 0);
            this._b.set(0, sz.position.y - c.position.y, it.span);
            this._n.cross(this._b, this._a).normalize();
            // a buoy rights itself, so only lean part of the way into the surface normal
            this._n.lerp(this._up, this._n, 0.55).normalize();

            const axis = this._axis.cross(this._up, this._n);
            const angle = Math.acos(Math.max(-1, Math.min(1, this._up.dot(this._n)))) * 180 / Math.PI;
            if (axis.length() > 1e-5) this._q.setFromAxisAngle(axis.normalize(), angle);
            else this._q.copy(Quat.IDENTITY);
            it.quat.slerp(it.quat, this._q, k);
            it.root.setRotation(it.quat);
        }
    }
}
