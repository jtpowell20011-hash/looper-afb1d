// @ts-check

export const DEFAULT_KEYBINDINGS = Object.freeze({
  moveUp: "KeyW",
  moveDown: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  basicAttack: "MouseLeft",
  skillshot: "KeyQ",
  area: "KeyE",
  ultimate: "KeyR",
  placeBase: "KeyB",
  recall: "KeyT",
  cameraLock: "KeyC",
  usePotion: "Digit1",
  quickWard: "Digit2",
  placeWard: "KeyV",
  reset: "F6",
  debugCurrency: "F1",
  debugXp: "F2",
  debugCore: "F3",
  debugMob: "F4",
  debugPhase: "F5"
});

export const KEYBINDING_GROUPS = Object.freeze([
  {
    label: "Movement",
    actions: [
      ["moveUp", "Move Up"],
      ["moveDown", "Move Down"],
      ["moveLeft", "Move Left"],
      ["moveRight", "Move Right"]
    ]
  },
  {
    label: "Combat",
    actions: [
      ["basicAttack", "Basic Attack"],
      ["skillshot", "Skill Shot"],
      ["area", "Area Field"],
      ["ultimate", "Ultimate"]
    ]
  },
  {
    label: "Base And Utility",
    actions: [
      ["placeBase", "Base / Shop"],
      ["recall", "Recall Home"],
      ["cameraLock", "Camera Lock"],
      ["usePotion", "Use Potion"],
      ["quickWard", "Use Ward"],
      ["placeWard", "Place Ward"],
      ["reset", "Reset Match"]
    ]
  },
  {
    label: "Debug",
    actions: [
      ["debugCurrency", "Add Funds"],
      ["debugXp", "Add XP"],
      ["debugCore", "Damage Core"],
      ["debugMob", "Spawn Mobs"],
      ["debugPhase", "Advance Phase"]
    ]
  }
]);

const SPECIAL_LABELS = Object.freeze({
  MouseLeft: "Click",
  Space: "Space",
  Escape: "Esc",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right"
});

export function normalizeKeybindings(bindings = {}) {
  return {
    ...DEFAULT_KEYBINDINGS,
    ...Object.fromEntries(
      Object.entries(bindings).filter(([action, code]) => Object.hasOwn(DEFAULT_KEYBINDINGS, action) && typeof code === "string")
    )
  };
}

export function labelForKeyCode(code) {
  if (!code) {
    return "-";
  }
  if (SPECIAL_LABELS[code]) {
    return SPECIAL_LABELS[code];
  }
  if (code.startsWith("Key")) {
    return code.slice(3);
  }
  if (code.startsWith("Digit")) {
    return code.slice(5);
  }
  if (code.startsWith("Numpad")) {
    return `Num ${code.slice(6)}`;
  }
  return code.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function actionForKey(bindings, code) {
  return Object.entries(bindings).find(([, boundCode]) => boundCode === code)?.[0] || null;
}







