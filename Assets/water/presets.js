/** Gallery art direction. All entries use only the supported water and sky controls. */
export const DEMO_PRESETS = {
    "Glass": {
        water: {
            wind: {"speed": 1.8, "direction": 20},
            swell: {"strength": 0.12, "direction": -60},
            waves: {"amplitude": 0.6, "choppiness": 0.45},
            roughness: 0.025,
            volume: {"color": [0.004, 0.07, 0.115], "visibility": 16},
            foam: 0.05,
            caustics: {"enabled": false},
        },
        sky: {"sunElevation": 12, "sunAzimuth": 108, "haze": 0.6, "exposure": 0.333333},
        grade: {"saturation": 1.02, "contrast": 1.02, "bloom": 0.02}
    },
    "Breeze": {
        water: {
            wind: {"speed": 9, "direction": 35},
            swell: {"strength": 0.6, "direction": -20},
            waves: {"amplitude": 1, "choppiness": 1.4},
            roughness: 0.06,
            volume: {"color": [0.003, 0.075, 0.11], "visibility": 10},
            foam: 1,
            caustics: {"enabled": false},
        },
        sky: {"sunElevation": 25, "sunAzimuth": 165, "haze": 0.5, "exposure": 0.6},
        grade: {"saturation": 1.05, "contrast": 1.03, "bloom": 0.025}
    },
    "Golden hour": {
        water: {
            wind: {"speed": 10.5, "direction": 158},
            swell: {"strength": 0.8, "direction": 150},
            waves: {"amplitude": 1.05, "choppiness": 1.5},
            roughness: 0.055,
            volume: {"color": [0.003, 0.045, 0.075], "visibility": 10},
            foam: 0.8,
            caustics: {"enabled": false},
        },
        sky: {"sunElevation": 2.2, "sunAzimuth": 160, "haze": 1.1, "exposure": 0.444444},
        grade: {"saturation": 1.06, "contrast": 1.05, "bloom": 0.045}
    },
    "Storm": {
        water: {
            wind: {"speed": 22, "direction": 60},
            swell: {"strength": 1.1, "direction": 30},
            waves: {"amplitude": 0.8, "choppiness": 1.2},
            roughness: 0.14,
            volume: {"color": [0.008, 0.05, 0.065], "visibility": 7},
            foam: 0.9,
            caustics: {"enabled": false},
        },
        sky: {"sunElevation": 9, "sunAzimuth": 25, "haze": 6, "exposure": 0.416667},
        grade: {"saturation": 0.25, "contrast": 0.98, "bloom": 0.02, "tint": [0.96, 0.99, 1]}
    },
    "Tropical shallows": {
        water: {
            wind: {"speed": 4.5, "direction": -10},
            swell: {"strength": 0.25, "direction": -40},
            waves: {"amplitude": 0.65, "choppiness": 0.8},
            roughness: 0.05,
            volume: {"color": [0.014, 0.112, 0.1295], "visibility": 14},
            foam: 0.25,
            caustics: {"enabled": true, "strength": 1.2, "scale": 0.55},
        },
        sky: {"sunElevation": 52, "sunAzimuth": 55, "haze": 0.35, "exposure": 0.222222},
        grade: {"saturation": 1.14, "contrast": 1.02, "bloom": 0.03}
    },
    "Afterglow": {
        water: {
            wind: {"speed": 8, "direction": -160},
            swell: {"strength": 0.7, "direction": -170},
            waves: {"amplitude": 0.95, "choppiness": 1.3},
            roughness: 0.05,
            volume: {"color": [0.0096, 0.048, 0.0992], "visibility": 10},
            foam: 0.7,
            caustics: {"enabled": false},
        },
        sky: {"sunElevation": -2, "sunAzimuth": 15, "haze": 0.7, "exposure": 1.6},
        grade: {"saturation": 1.04, "contrast": 0.98, "bloom": 0.018}
    },
};

/**
 * Apply a complete gallery look. Resetting through the libraries prevents previous edits or
 * presets from leaking into this scene; hardware quality and attached bathymetry are retained.
 *
 * @param {import('../src/water/Water.js').Water} water
 * @param {import('../src/sky/Sky.js').Sky} sky
 * @param {string} name
 * @param {object} [cameraFrame] PlayCanvas CameraFrame to receive the presentation grade.
 */
export function applyPreset(water, sky, name, cameraFrame) {
    const preset = DEMO_PRESETS[name];
    if (!preset) throw new RangeError(`Unknown demo preset: ${name}`);
    water.reset({ ...preset.water, quality: water.config.quality });
    sky.resetParams(preset.sky);

    if (cameraFrame) {
        const grade = preset.grade ?? {};
        cameraFrame.grading.saturation = grade.saturation ?? 1;
        cameraFrame.grading.contrast = grade.contrast ?? 1;
        cameraFrame.grading.brightness = grade.brightness ?? 1;
        cameraFrame.grading.tint.set(...(grade.tint ?? [1, 1, 1]));
        cameraFrame.bloom.intensity = grade.bloom ?? 0;
    }
}
