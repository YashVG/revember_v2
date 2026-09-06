import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { RevemberState, type StatePaths } from "./app-state";
import { strictIdentifier } from "./input-validation";
import { writeJsonAtomically } from "./persistence";

/** Separates accounts sharing one OS login; local files remain OS-user owned. */
export class AccountVaults {
  private active?: { userID: string; state: RevemberState };
  private readonly legacyOwnerID?: string;

  constructor(private readonly userDataPath: string, private readonly legacyPaths: StatePaths) {
    const ownerPath = path.join(userDataPath, "legacy-vault-owner.json");
    if (existsSync(ownerPath)) {
      this.legacyOwnerID = strictIdentifier(JSON.parse(readFileSync(ownerPath, "utf8")).userID, "legacy owner");
    } else {
      // Upgrade only the account already recorded on this installation. A
      // newly signed-in account must never silently inherit an unowned vault.
      let previousOwner: string;
      try {
        const saved = JSON.parse(readFileSync(path.join(userDataPath, "supabase-session.json"), "utf8"));
        previousOwner = strictIdentifier(saved.user.id, "legacy owner");
      } catch { return; /* No identifiable prior owner: keep the legacy files untouched. */ }
      writeJsonAtomically(ownerPath, { userID: previousOwner });
      this.legacyOwnerID = previousOwner;
    }
  }

  activate(rawUserID: string): RevemberState {
    const userID = strictIdentifier(rawUserID, "account id");
    if (this.active?.userID === userID) return this.active.state;
    this.deactivate();
    const accountRoot = path.join(this.userDataPath, "accounts", userID);
    mkdirSync(accountRoot, { recursive: true, mode: 0o700 });
    const state = new RevemberState(userID === this.legacyOwnerID ? this.legacyPaths : {
      settingsPath: path.join(accountRoot, "settings.json"),
      bundledKnowledgeRoot: this.legacyPaths.bundledKnowledgeRoot,
      personalKnowledgeRoot: path.join(accountRoot, "knowledge"),
      legacyProgressPath: path.join(accountRoot, "progress.json"),
      isolatedAccount: true
    });
    this.active = { userID, state };
    return state;
  }

  requireActive(userID: string | undefined): RevemberState {
    if (!userID || this.active?.userID !== userID) throw new Error("Sign in before accessing your vault.");
    return this.active.state;
  }

  deactivate(): void {
    this.active?.state.dispose();
    this.active = undefined;
  }
}
