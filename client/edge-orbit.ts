import * as THREE from 'three';
import type { MapData } from '../shared/game';

const smooth = (t: number) => { t = THREE.MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const changeSide = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);

/** A half orbit in the departing surface's frame, then expressed in the arrival frame. */
export class EdgeOrbit {
  readonly axis: THREE.Vector3;
  readonly outward: THREE.Vector3;
  readonly pivot: THREE.Vector3;
  private readonly start: THREE.Vector3;
  private readonly thickness: number;
  private readonly rotation = new THREE.Quaternion();
  private readonly destination = new THREE.Vector3();
  private readonly edgeLook = new THREE.Quaternion();

  constructor(start: THREE.Vector3, map: MapData, readonly height: number, xEdge: boolean, boundary?: { x: number; z: number; nx: number; nz: number }) {
    this.start = start.clone();
    this.thickness = map.back!.thickness;
    this.outward = xEdge ? new THREE.Vector3(Math.sign(start.x) || 1, 0, 0) : new THREE.Vector3(0, 0, Math.sign(start.z) || 1);
    if (boundary) this.outward.set(boundary.nx, 0, boundary.nz);
    this.axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.outward);
    this.pivot = new THREE.Vector3(xEdge ? this.outward.x * map.width / 2 : start.x, -this.thickness / 2, xEdge ? start.z : this.outward.z * map.depth / 2);
    if (boundary) this.pivot.set(boundary.x, -this.thickness / 2, boundary.z);
  }

  sample(t: number, target: THREE.Vector3, sourceLook: THREE.Quaternion, position: THREE.Vector3, orientation: THREE.Quaternion) {
    t = THREE.MathUtils.clamp(t, 0, 1);
    // Front/back conversion is its own inverse. Geometry stays fixed relative to this orbit.
    this.destination.set(target.x, -target.y - this.thickness, -target.z);
    const eased = smooth(t), angle = Math.PI * eased;
    const startRadius = this.start.y - this.pivot.y;
    const endRadius = this.pivot.y - this.destination.y;
    const radius = THREE.MathUtils.lerp(startRadius, endRadius, eased) + this.height * .45 * Math.sin(Math.PI * t) ** 2;
    const startInset = this.start.clone().sub(this.pivot).dot(this.outward);
    const endInset = this.destination.clone().sub(this.pivot).dot(this.outward);
    const outwardDistance = radius * Math.sin(angle) + startInset * (1 - smooth(t / .25)) + endInset * smooth((t - .75) / .25);
    position.lerpVectors(this.start, this.destination, eased);
    if (this.outward.x) position.x = this.pivot.x + this.outward.x * outwardDistance;
    else position.z = this.pivot.z + this.outward.z * outwardDistance;
    position.y = this.pivot.y + radius * Math.cos(angle);
    // A small compression only after reaching the underside; zero at both endpoints.
    const landing = THREE.MathUtils.clamp((t - .84) / .16, 0, 1);
    position.y += this.height * .09 * Math.sin(Math.PI * landing) ** 2;
    position.set(position.x, -position.y - this.thickness, -position.z);
    this.rotation.setFromAxisAngle(this.axis, angle);
    orientation.copy(changeSide).multiply(this.rotation).multiply(sourceLook);
    // Glance toward the edge while rounding it, keeping the board in view.
    this.edgeLook.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1.1 * Math.sin(Math.PI * t) ** 2);
    orientation.multiply(this.edgeLook);
  }
}
