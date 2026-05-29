// @ts-check
import { DEFAULT_KEYBINDINGS, KEYBINDING_GROUPS, labelForKeyCode, normalizeKeybindings } from "./InputBindings.js?v=1.8.56";

const STORAGE_KEY = "basebound.keybindings.v2";

export class SettingsManager {
  constructor({ onChange = () => {}, onLeaveGame = () => {} } = {}) {
    this.onChange = onChange;
    this.onLeaveGame = onLeaveGame;
    this.keybindings = this.load();
    this.listeningAction = null;
    this.els = {
      overlay: byId("settingsOverlay"),
      closeButton: byId("settingsCloseButton"),
      resetButton: byId("settingsResetButton"),
      keybindingList: byId("keybindingList"),
      statusText: byId("settingsStatusText"),
      menuSettingsButton: byId("menuSettingsButton"),
      gameSettingsButton: byId("settingsButton"),
      leaveGameButton: byId("leaveGameButton"),
      leaveConfirmPanel: byId("leaveConfirmPanel"),
      confirmLeaveButton: byId("confirmLeaveButton"),
      cancelLeaveButton: byId("cancelLeaveButton")
    };
    this.bind();
    this.render();
  }

  bind() {
    this.els.menuSettingsButton.addEventListener("click", () => this.open());
    this.els.gameSettingsButton.addEventListener("click", () => this.open());
    this.els.closeButton.addEventListener("click", () => this.close());
    this.els.resetButton.addEventListener("click", () => this.reset());
    this.els.leaveGameButton.addEventListener("click", () => {
      this.els.leaveConfirmPanel.hidden = false;
      this.els.statusText.textContent = "Confirm that you want to leave the current match.";
    });
    this.els.cancelLeaveButton.addEventListener("click", () => {
      this.els.leaveConfirmPanel.hidden = true;
      this.els.statusText.textContent = "Leave cancelled.";
    });
    this.els.confirmLeaveButton.addEventListener("click", () => {
      this.els.leaveConfirmPanel.hidden = true;
      this.close();
      this.onLeaveGame();
    });
    this.els.overlay.addEventListener("pointerdown", (event) => {
      if (event.target === this.els.overlay) {
        this.close();
      }
    });
    this.els.keybindingList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-binding-action]");
      if (!button) {
        return;
      }
      this.listeningAction = button.dataset.bindingAction;
      this.els.statusText.textContent = `Press a key for ${button.dataset.bindingLabel}.`;
      this.render();
    });
    window.addEventListener("keydown", (event) => {
      if (!this.listeningAction) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        this.listeningAction = null;
        this.els.statusText.textContent = "Keybinding change cancelled.";
        this.render();
        return;
      }
      this.keybindings = normalizeKeybindings({
        ...this.keybindings,
        [this.listeningAction]: event.code
      });
      this.save();
      this.els.statusText.textContent = `${labelForAction(this.listeningAction)} set to ${labelForKeyCode(event.code)}.`;
      this.listeningAction = null;
      this.render();
      this.onChange(this.keybindings);
    }, true);
  }

  open() {
    this.els.leaveConfirmPanel.hidden = true;
    this.els.overlay.hidden = false;
    this.render();
  }

  close() {
    this.listeningAction = null;
    this.els.leaveConfirmPanel.hidden = true;
    this.els.overlay.hidden = true;
    this.render();
  }

  reset() {
    this.keybindings = { ...DEFAULT_KEYBINDINGS };
    this.save();
    this.listeningAction = null;
    this.els.statusText.textContent = "Keybindings reset.";
    this.render();
    this.onChange(this.keybindings);
  }

  load() {
    try {
      return normalizeKeybindings(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
    } catch {
      return { ...DEFAULT_KEYBINDINGS };
    }
  }

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.keybindings));
  }

  render() {
    const inGame = document.body.dataset.gameStarted === "true";
    this.els.leaveGameButton.hidden = !inGame;
    this.els.keybindingList.innerHTML = KEYBINDING_GROUPS.map(
      (group) =>
        `<section class="keybind-group"><h3>${group.label}</h3>${group.actions
          .map(([action, label]) => {
            const listening = this.listeningAction === action;
            return `<div class="keybind-row"><span>${label}</span><button type="button" data-binding-action="${action}" data-binding-label="${label}" class="${
              listening ? "is-listening" : ""
            }">${listening ? "Press key..." : labelForKeyCode(this.keybindings[action])}</button></div>`;
          })
          .join("")}</section>`
    ).join("");
  }
}

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing settings element #${id}`);
  return element;
}

function labelForAction(action) {
  for (const group of KEYBINDING_GROUPS) {
    const match = group.actions.find(([id]) => id === action);
    if (match) {
      return match[1];
    }
  }
  return action;
}










