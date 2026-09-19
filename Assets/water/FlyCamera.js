import { Vec3, Quat } from 'playcanvas';

/** Minimal fly camera: drag to look, WASD / QE to move, shift to sprint, wheel to change speed. */
export class FlyCamera {
    constructor(app, entity) {
        this.app = app;
        this.entity = entity;
        this.speed = 12;
        this.keys = new Set();
        this.dragging = false;
        this.last = { x: 0, y: 0 };
        const e = entity.getEulerAngles();
        this.pitch = e.x;
        this.yaw = e.y;

        const canvas = app.graphicsDevice.canvas;
        canvas.addEventListener('pointerdown', (ev) => { if (ev.button === 0) { this.dragging = true; this.last = { x: ev.clientX, y: ev.clientY }; canvas.setPointerCapture(ev.pointerId); } });
        canvas.addEventListener('pointerup', () => { this.dragging = false; });
        canvas.addEventListener('pointermove', (ev) => {
            if (!this.dragging) return;
            const dx = ev.clientX - this.last.x, dy = ev.clientY - this.last.y;
            this.last = { x: ev.clientX, y: ev.clientY };
            this.yaw -= dx * 0.15;
            this.pitch = Math.max(-89, Math.min(89, this.pitch - dy * 0.15));
        });
        canvas.addEventListener('wheel', (ev) => { this.speed *= ev.deltaY > 0 ? 0.8 : 1.25; this.speed = Math.max(0.5, Math.min(500, this.speed)); }, { passive: true });
        window.addEventListener('keydown', (ev) => { if (!ev.target.closest('.lil-gui')) this.keys.add(ev.code); });
        window.addEventListener('keyup', (ev) => this.keys.delete(ev.code));
        window.addEventListener('blur', () => this.keys.clear());
        this._q = new Quat();
        this._v = new Vec3();
    }

    /** Adopt the entity's current orientation, so taking over from a scripted camera doesn't snap. */
    syncFrom(entity) {
        const e = entity.getEulerAngles();
        this.pitch = e.x;
        this.yaw = e.y;
    }

    update(dt) {
        const e = this.entity;
        e.setEulerAngles(this.pitch, this.yaw, 0);
        const k = this.keys;
        const s = this.speed * dt * (k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1);
        const v = this._v.set(0, 0, 0);
        if (k.has('KeyW') || k.has('ArrowUp')) v.add(e.forward);
        if (k.has('KeyS') || k.has('ArrowDown')) v.sub(e.forward);
        if (k.has('KeyD') || k.has('ArrowRight')) v.add(e.right);
        if (k.has('KeyA') || k.has('ArrowLeft')) v.sub(e.right);
        if (k.has('KeyE')) v.y += 1;
        if (k.has('KeyQ')) v.y -= 1;
        if (v.length() > 0) e.translate(v.normalize().mulScalar(s));
    }
}
