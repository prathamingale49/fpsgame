import * as THREE from 'three';

export type FlightPose = { boosting: boolean; grounded: boolean; vx: number; vz: number; vy: number; yaw: number; speed: number };

/** Decorative only: never changes the root position, hitbox, or aiming camera. */
export class RocketFlightVisual {
  readonly exhaust = new THREE.Group();
  private flame: THREE.Mesh;
  private core: THREE.Mesh;
  private particles: THREE.Points;
  private positions = new Float32Array(12 * 3);
  private grounded = true;
  private impact = 0;
  private previousVy = 0;
  constructor(private body: THREE.Group) {
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(.27, 1, 7), new THREE.MeshBasicMaterial({ color: '#ff8428', transparent: true, opacity: .85, depthWrite: false }));
    this.core = new THREE.Mesh(new THREE.ConeGeometry(.14, .7, 7), new THREE.MeshBasicMaterial({ color: '#ffef8a', depthWrite: false }));
    this.flame.rotation.z = this.core.rotation.z = Math.PI;
    this.flame.position.y = -.4; this.core.position.y = -.23;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.particles = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#ffc44f', size: .07, transparent: true, opacity: .7, depthWrite: false }));
    this.exhaust.position.y = .12; this.exhaust.add(this.flame, this.core, this.particles); this.exhaust.visible = false; body.add(this.exhaust);
  }
  update(dt: number, time: number, pose: FlightPose) {
    this.exhaust.visible = pose.boosting;
    const intensity = 1 + Math.min(1, Math.max(0, pose.vy) / Math.max(1, pose.speed)) * .6;
    this.exhaust.scale.y = intensity * (1 + Math.sin(time * .065) * .09);
    for (let i = 0; i < 12; i++) {
      const phase = (time * .0016 + i / 12) % 1;
      this.positions[i * 3] = Math.sin(i * 9.3) * (.08 + phase * .22);
      this.positions[i * 3 + 1] = -phase * 2;
      this.positions[i * 3 + 2] = Math.cos(i * 7.1) * (.08 + phase * .22);
    }
    if (pose.boosting) this.particles.geometry.attributes.position.needsUpdate = true;
    const right = (pose.vx * Math.cos(pose.yaw) - pose.vz * Math.sin(pose.yaw)) / Math.max(1, pose.speed);
    const forward = (-pose.vx * Math.sin(pose.yaw) - pose.vz * Math.cos(pose.yaw)) / Math.max(1, pose.speed);
    const tilt = pose.grounded ? .035 : .16;
    this.body.rotation.x = THREE.MathUtils.damp(this.body.rotation.x, -THREE.MathUtils.clamp(forward, -1, 1) * tilt, 12, dt);
    this.body.rotation.z = THREE.MathUtils.damp(this.body.rotation.z, -THREE.MathUtils.clamp(right, -1, 1) * tilt, 12, dt);
    if (pose.grounded && !this.grounded) this.impact = Math.min(.16, Math.abs(this.previousVy) * .012);
    this.impact *= Math.exp(-dt * 14);
    this.body.scale.set(1 + this.impact * .35, 1 - this.impact + (pose.boosting ? .025 : 0), 1 + this.impact * .35);
    this.grounded = pose.grounded; this.previousVy = pose.vy;
  }
  dispose() {
    this.body.remove(this.exhaust);
    for (const object of [this.flame, this.core, this.particles]) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); }
  }
}
