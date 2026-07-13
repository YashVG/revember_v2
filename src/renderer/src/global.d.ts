import type { RevemberAPI } from "../../../shared/types";

declare global {
  interface Window {
    revember: RevemberAPI;
  }
}

export {};
