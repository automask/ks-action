import {
    CameraFrame as EngineCameraFrame, FramePassCameraFrame, ShaderUtils,
    SEMANTIC_POSITION, PROJECTION_PERSPECTIVE
} from 'playcanvas';
import { CameraFrame } from 'playcanvas/scripts/esm/camera-frame.mjs';

/**
 * Demo-only focus approximation for a calm water surface. The ray is deliberately unnormalized:
 * forward + right * x + up * y has a forward projection of one, so its intersection parameter
 * is linear view depth, matching getLinearScreenDepth. The actual opaque depth texture is untouched.
 */
export function waterFocusDepth(opaqueDepth, cameraY, rayY, seaLevel = 0, nearClip = 0.1) {
    if (cameraY <= seaLevel || rayY >= -1e-5) return opaqueDepth;
    const depth = (seaLevel - cameraY) / rayY;
    return depth >= nearClip ? Math.min(opaqueDepth, depth) : opaqueDepth;
}

const COC_GLSL = /* glsl */`
#include "screenDepthPS"
varying vec2 uv0;
uniform vec3 params;
uniform vec4 uDemoCocCamera;   // camera world position, sea level
uniform vec3 uDemoCocRight;
uniform vec3 uDemoCocUp;
uniform vec3 uDemoCocForward;
uniform vec4 uDemoCocLens;     // tan half horizontal/vertical FOV, enabled, near clip
void main() {
    float depth = getLinearScreenDepth(uv0);
    if (uDemoCocLens.z > 0.5 && uDemoCocCamera.y > uDemoCocCamera.w) {
        // Undo the image-effect UV convention to recover NDC; this handles WebGPU's Y flip.
        vec2 ndc = getImageEffectUV(uv0) * 2.0 - 1.0;
        vec3 ray = uDemoCocForward + uDemoCocRight * (ndc.x * uDemoCocLens.x)
            + uDemoCocUp * (ndc.y * uDemoCocLens.y);
        if (ray.y < -0.00001) {
            float waterDepth = (uDemoCocCamera.w - uDemoCocCamera.y) / ray.y;
            if (waterDepth >= uDemoCocLens.w) depth = min(depth, waterDepth);
        }
    }
    // Lens defocus varies with reciprocal depth. A linear metre ramp hits full blur
    // just behind the subject, making a horizontal stripe on a receding water plane.
    // Keep the focus tolerance, but let far blur approach its limit at infinity.
    depth = max(depth, 0.0001);
    float farRange = params.x + params.y * 0.5;
    float cocFar = clamp(1.0 - farRange / depth, 0.0, 1.0);
    #ifdef NEAR_BLUR
        float nearRange = params.x - params.y * 0.5;
        float cocNear = clamp(nearRange / depth - 1.0, 0.0, 1.0);
    #else
        float cocNear = 0.0;
    #endif
    gl_FragColor = vec4(cocFar, cocNear, 0.0, 0.0);
}
`;

const COC_WGSL = /* wgsl */`
#include "screenDepthPS"
varying uv0: vec2f;
uniform params: vec3f;
uniform uDemoCocCamera: vec4f;
uniform uDemoCocRight: vec3f;
uniform uDemoCocUp: vec3f;
uniform uDemoCocForward: vec3f;
uniform uDemoCocLens: vec4f;
@fragment
fn fragmentMain(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    var depth = getLinearScreenDepth(uv0);
    if (uniform.uDemoCocLens.z > 0.5 && uniform.uDemoCocCamera.y > uniform.uDemoCocCamera.w) {
        let ndc = getImageEffectUV(uv0) * 2.0 - vec2f(1.0);
        let ray = uniform.uDemoCocForward + uniform.uDemoCocRight * (ndc.x * uniform.uDemoCocLens.x)
            + uniform.uDemoCocUp * (ndc.y * uniform.uDemoCocLens.y);
        if (ray.y < -0.00001) {
            let waterDepth = (uniform.uDemoCocCamera.w - uniform.uDemoCocCamera.y) / ray.y;
            if (waterDepth >= uniform.uDemoCocLens.w) { depth = min(depth, waterDepth); }
        }
    }
    depth = max(depth, 0.0001);
    let farRange = uniform.params.x + uniform.params.y * 0.5;
    let cocFar = clamp(1.0 - farRange / depth, 0.0, 1.0);
    #ifdef NEAR_BLUR
        let nearRange = uniform.params.x - uniform.params.y * 0.5;
        let cocNear = clamp(nearRange / depth - 1.0, 0.0, 1.0);
    #else
        let cocNear = 0.0;
    #endif
    output.color = vec4f(cocFar, cocNear, 0.0, 0.0);
    return output;
}
`;

class WaterFocusFramePass extends FramePassCameraFrame {
    setupDofPass(options, inputTexture, inputTextureHalf) {
        super.setupDofPass(options, inputTexture, inputTextureHalf);
        const pass = this.dofPass?.cocPass;
        if (!pass) return;
        const defines = new Map();
        if (options.dofNearBlur) defines.set('NEAR_BLUR', '');
        const depthKey = ShaderUtils.addScreenDepthChunkDefines(this.cameraComponent.shaderParams, defines);
        pass.shader = ShaderUtils.createShader(this.device, {
            uniqueName: `DemoWaterFocusCoC-${options.dofNearBlur}${depthKey}`,
            attributes: { aPosition: SEMANTIC_POSITION }, vertexChunk: 'quadVS',
            fragmentGLSL: COC_GLSL, fragmentWGSL: COC_WGSL, fragmentDefines: defines
        });
        const names = ['Camera', 'Right', 'Up', 'Forward', 'Lens'];
        const handles = names.map(name => this.device.scope.resolve(`uDemoCoc${name}`));
        const values = names.map(name => new Float32Array(name === 'Camera' || name === 'Lens' ? 4 : 3));
        const before = pass.before?.bind(pass);
        pass.before = () => {
            before?.();
            const camera = this.cameraComponent, entity = camera.entity;
            const position = entity.getPosition();
            values[0].set([position.x, position.y, position.z, this.cameraFrame.seaLevel ?? 0]);
            const basis = [entity.right, entity.up, entity.forward];
            for (let i = 0; i < basis.length; i++) values[i + 1].set([basis[i].x, basis[i].y, basis[i].z]);
            const tanHalf = Math.tan(camera.fov * Math.PI / 360);
            const aspect = Math.max(camera.aspectRatio, 1e-6);
            const tanX = camera.horizontalFov ? tanHalf : tanHalf * aspect;
            const tanY = camera.horizontalFov ? tanHalf / aspect : tanHalf;
            const supported = camera.projection === PROJECTION_PERSPECTIVE && !camera.calculateProjection;
            values[4].set([tanX, tanY, this.cameraFrame.waterFocus && supported ? 1 : 0, camera.nearClip]);
            for (let i = 0; i < handles.length; i++) handles[i].setValue(values[i]);
        };
    }
}

class WaterFocusEngineFrame extends EngineCameraFrame {
    waterFocus = false;
    seaLevel = 0;
    createRenderPass() {
        return new WaterFocusFramePass(this.app, this, this.cameraComponent, this.options);
    }
}

/**
 * CameraFrame settings remain inherited. Enable waterFocus only for the calm close buoy shot:
 * displaced wave crests, underwater views and arbitrary transparent objects need actual depth.
 * Uses the documented CameraFrame/FramePassCameraFrame extension points; no engine internals.
 */
export class CinematicFrame extends CameraFrame {
    static scriptName = 'cinematicFrame';
    waterFocus = false;
    seaLevel = 0;

    initialize() {
        this.engineCameraFrame = new WaterFocusEngineFrame(this.app, this.entity.camera);
        this.on('enable', () => { this.engineCameraFrame.enabled = true; });
        this.on('disable', () => { this.engineCameraFrame.enabled = false; });
        this.on('destroy', () => { this.engineCameraFrame.destroy(); });
        this.on('state', enabled => { this.engineCameraFrame.enabled = enabled; });
    }

    postUpdate(dt) {
        this.engineCameraFrame.waterFocus = this.waterFocus;
        this.engineCameraFrame.seaLevel = this.seaLevel;
        super.postUpdate(dt);
    }
}
