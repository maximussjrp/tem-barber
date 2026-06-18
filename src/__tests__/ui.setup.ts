import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock HTMLDialogElement
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    this.setAttribute("open", "");
    // Trigger any native behaviors if needed
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.removeAttribute("open");
  };
}
