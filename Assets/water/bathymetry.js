/** Demo-owned height data raycast from the Blender delivery meshes. */
let sampleHeight = null;
export function createHeightSampler(metadata, buffer) {
    const { origin, step, resolution, heightMin, heightRange } = metadata;
    if (!(step > 0) || resolution < 2 || buffer.byteLength !== resolution * resolution * 2)
        throw new Error('Invalid coast bathymetry');
    const samples = new DataView(buffer);
    const at = (x, z) => heightMin + samples.getUint16((z * resolution + x) * 2, true) * heightRange / 65535;
    return (x, z) => {
        const u = (x - origin[0]) / step, v = (z - origin[1]) / step;
        if (u < 0 || v < 0 || u > resolution - 1 || v > resolution - 1) return -50;
        const ix = Math.min(resolution - 2, Math.floor(u)), iz = Math.min(resolution - 2, Math.floor(v));
        const fx = u - ix, fz = v - iz;
        return (at(ix, iz) * (1-fx) + at(ix+1, iz) * fx) * (1-fz) +
            (at(ix, iz+1) * (1-fx) + at(ix+1, iz+1) * fx) * fz;
    };
}
export function installBathymetry(metadata, buffer) { sampleHeight = createHeightSampler(metadata, buffer); }
export function seabedHeight(x, z) {
    if (!sampleHeight) throw new Error('Load the authored coast before sampling its seabed');
    return sampleHeight(x, z);
}
export async function loadBathymetry(base) {
    const [metadata, heights] = await Promise.all(['bathymetry.json', 'bathymetry.u16'].map(async file => {
        const response = await fetch(`${base}/${file}`);
        if (!response.ok) throw new Error(`Unable to load coast ${file}: ${response.status}`);
        return file.endsWith('.json') ? response.json() : response.arrayBuffer();
    }));
    installBathymetry(metadata, heights);
}
