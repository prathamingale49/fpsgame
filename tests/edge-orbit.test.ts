import { expect, it } from 'vitest';
import * as THREE from 'three';
import { EdgeOrbit } from '../client/edge-orbit';
import { testMap } from '../shared/game';

const map = { ...testMap, back: { enabled: true, thickness: 1.82, boxes: [] } };
const changeSide = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
for (const xEdge of [false, true]) for (const sign of [-1, 1]) for (const back of [false, true]) {
  it(`orbits ${xEdge ? 'X' : 'Z'} ${sign} from ${back ? 'back' : 'front'} continuously outside the edge`, () => {
    const edge = sign * (xEdge ? map.width : map.depth) / 2;
    const start = new THREE.Vector3(xEdge ? edge - sign * .1 : 4, 1.2, xEdge ? 7 : edge - sign * .1);
    const endSource = new THREE.Vector3(xEdge ? edge - sign * .48 : 4, -map.back.thickness - 2, xEdge ? 7 : edge - sign * .48);
    const target = new THREE.Vector3(endSource.x, -endSource.y - map.back.thickness, -endSource.z);
    const orbit = new EdgeOrbit(start, map, .9, xEdge);
    const yaw = .37, pitch = -.22;
    const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    const position = new THREE.Vector3(), orientation = new THREE.Quaternion();
    orbit.sample(0, target, look, position, orientation);
    const convertedStart = new THREE.Vector3(start.x, -start.y - map.back.thickness, -start.z);
    expect(position.distanceTo(convertedStart)).toBeLessThan(1e-10);
    expect(orientation.angleTo(changeSide.clone().multiply(look))).toBeLessThan(1e-7);
    let previous = position.clone(), previousQ = orientation.clone();
    for (let i = 1; i <= 180; i++) {
      orbit.sample(i / 180, target, look, position, orientation);
      expect(position.distanceTo(previous)).toBeLessThan(.13);
      expect(orientation.angleTo(previousQ)).toBeLessThan(.04);
      const source = new THREE.Vector3(position.x, -position.y - map.back.thickness, -position.z);
      if (source.y < 0 && source.y > -map.back.thickness) {
        expect((xEdge ? source.x : source.z) * sign).toBeGreaterThan(Math.abs(edge) + .5);
      }
      previous.copy(position); previousQ.copy(orientation);
    }
    expect(position.distanceTo(target)).toBeLessThan(1e-10);
    const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw + (xEdge ? Math.PI : 0), 0, 'YXZ'));
    expect(orientation.angleTo(expected)).toBeLessThan(1e-7);
    // Both surface transforms preserve the same physical start/end poses.
    const surface = back ? changeSide : new THREE.Quaternion();
    expect(surface.clone().multiply(orientation).angleTo(surface.clone().multiply(expected))).toBeLessThan(1e-7);
  });
}
