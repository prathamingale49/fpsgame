// STEP component collision selection, in millimeters. At the 0.90 mm player
// scale, 0402 and 0603 packages must not be discarded as decorative detail.
// Very thin copper/pad layers and enormous assembly envelopes remain excluded.
export const MIN_COMPONENT_HEIGHT = .2;
export const MIN_COMPONENT_FOOTPRINT = .35;

export function isCollidableComponent(height: number, width: number, depth: number, boardArea: number): boolean {
  return Number.isFinite(height) && Number.isFinite(width) && Number.isFinite(depth)
    && height >= MIN_COMPONENT_HEIGHT
    && width >= MIN_COMPONENT_FOOTPRINT && depth >= MIN_COMPONENT_FOOTPRINT
    && width * depth <= boardArea * .25;
}
