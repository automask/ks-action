/** Reveal a new study only after its lighting and at least two complete frames agree. */
export class ShotTransition {
    constructor(element) {
        this.element = element;
        this.active = false;
        this.frames = 0;
        this.elapsed = 0;
    }
    begin() {
        this.active = true;
        this.frames = 0;
        this.elapsed = 0;
        this.element.classList.add('covered');
    }
    frame(dt, ready) {
        if (!this.active) return;
        this.elapsed += dt;
        this.frames = ready ? this.frames + 1 : 0;
        if (this.frames >= 3 && this.elapsed >= 0.18) {
            this.active = false;
            this.element.classList.remove('covered');
        }
    }
}
