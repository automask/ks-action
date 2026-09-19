import { SHOTS } from './director.js';

/** Small demo adapter: authored studies provide the look; these controls let visitors explore it. */
export function buildGui({ water, sky, director, post, onReset }) {
    const panel = document.createElement('aside');
    panel.className = 'studio-panel';
    panel.setAttribute('aria-label', 'Studio');
    panel.hidden = true;
    panel.innerHTML = `<header><span>Studio</span><button type="button" class="studio-reset">Reset</button></header>`;
    const controls = [];
    const range = (name, min, max, step, read, write, format = v => String(v)) => {
        const label = document.createElement('label');
        label.className = 'studio-range';
        label.innerHTML = `<span>${name}<output></output></span><input type="range" min="${min}" max="${max}" step="${step}" aria-label="${name}">`;
        const input = label.querySelector('input'), output = label.querySelector('output');
        const refresh = () => { input.value = read(); output.textContent = format(read()); };
        input.addEventListener('input', () => { write(Number(input.value)); refresh(); });
        controls.push(refresh);
        panel.append(label);
    };
    range('Wind', 0, 28, 0.1, () => water.config.wind.speed, v => water.set({ wind: { speed: v } }), v => `${v.toFixed(1)} m/s`);
    range('Swell', 0, 1.5, .01, () => water.config.swell.strength, v => water.set({ swell: { strength: v } }), v => `${Math.round(v * 100)}%`);
    range('Clarity', 2, 40, 1, () => water.config.volume.visibility, v => water.set({ volume: { visibility: v } }), v => `${Math.round(v)} m`);
    const divider = document.createElement('hr'); panel.append(divider);
    range('Sun', -6, 70, .1, () => sky.params.sunElevation, v => sky.setParams({ sunElevation: v }), v => `${v.toFixed(1)}°`);
    range('Haze', 0, 6, .1, () => sky.params.haze, v => sky.setParams({ haze: v }), v => v.toFixed(1));
    const toggle = (name, read, write) => {
        const label = document.createElement('label'); label.className = 'studio-option';
        label.innerHTML = `<span>${name}</span><input type="checkbox" aria-label="${name}">`;
        const input = label.querySelector('input');
        input.addEventListener('change', () => write(input.checked));
        controls.push(() => { input.checked = read(); }); panel.append(label);
    };
    toggle('Caustics', () => water.config.caustics.enabled, v => water.set({ caustics: { enabled: v } }));
    toggle('Cinematic', () => post.cinematic, v => { post.cinematic = v; });
    const quality = document.createElement('label'); quality.className = 'studio-option';
    quality.innerHTML = `<span>Quality</span><select aria-label="Quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>`;
    const select = quality.querySelector('select');
    select.addEventListener('change', () => water.set({ quality: select.value }));
    controls.push(() => { select.value = water.config.quality; }); panel.append(quality);
    panel.querySelector('.studio-reset').addEventListener('click', () => { onReset(SHOTS[director.index]); controls.forEach(fn => fn()); });
    document.body.append(panel);
    return {
        refresh() { controls.forEach(fn => fn()); },
        show() { panel.hidden = false; },
        hide() { panel.hidden = true; },
        destroy() { panel.remove(); }
    };
}
