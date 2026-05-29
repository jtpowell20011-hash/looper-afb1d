// @ts-check
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function normalize(x, y) {
  const length = Math.hypot(x, y);
  if (length <= 0.0001) {
    return { x: 1, y: 0 };
  }
  return { x: x / length, y: y / length };
}

export function randRange(min, max) {
  return min + Math.random() * (max - min);
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function circleIntersects(a, b) {
  const radius = (a.radius || 0) + (b.radius || 0);
  return distanceSq(a, b) <= radius * radius;
}

export function clampPointToWorld(point, world) {
  return {
    x: clamp(point.x, 0, world.width),
    y: clamp(point.y, 0, world.height)
  };
}

export function toward(from, to) {
  return normalize(to.x - from.x, to.y - from.y);
}







