import { execSync } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Built-in palette: muted, dark background colors inspired by Monokai Pro's
 * accent hues. Each is dark enough to serve as a title bar background while
 * still being visually distinct from one another.
 */
const DEFAULT_PALETTE = [
  "#2d1b36", // muted purple
  "#1b2d36", // muted teal
  "#362d1b", // muted amber
  "#1b362d", // muted green
  "#361b2d", // muted magenta
  "#1b2536", // muted blue
  "#36351b", // muted yellow
  "#2b1b36", // muted violet
  "#1b3625", // muted emerald
  "#361b1b", // muted red
  "#1b3636", // muted cyan
  "#36261b", // muted orange
];

type Area =
  | "titleBar"
  | "activityBar"
  | "statusBar"
  | "sideBar"
  | "tab"
  | "panel"
  | "border";

/**
 * Maps each UI area to the colorCustomization keys it controls.
 * "bg" keys get the branch color, "fg" keys get the readable foreground,
 * "bgDim" keys get the dimmed (inactive) variant.
 */
const AREA_KEYS: Record<
  Area,
  { bg: string[]; bgDim: string[]; fg: string[]; fgDim: string[] }
> = {
  titleBar: {
    bg: ["titleBar.activeBackground"],
    bgDim: ["titleBar.inactiveBackground"],
    fg: ["titleBar.activeForeground"],
    fgDim: ["titleBar.inactiveForeground"],
  },
  activityBar: {
    bg: [
      "activityBar.background",
      // When activity bar is positioned at the top of the sidebar:
      "activityBarTop.background",
    ],
    bgDim: [],
    fg: ["activityBar.foreground", "activityBarTop.foreground"],
    fgDim: [
      "activityBar.inactiveForeground",
      "activityBarTop.inactiveForeground",
    ],
  },
  statusBar: {
    bg: [
      "statusBar.background",
      "statusBar.debuggingBackground",
      "statusBar.noFolderBackground",
      "statusBarItem.remoteBackground",
    ],
    bgDim: [],
    fg: [
      "statusBar.foreground",
      "statusBar.debuggingForeground",
      "statusBar.noFolderForeground",
      "statusBarItem.remoteForeground",
    ],
    fgDim: [],
  },
  sideBar: {
    bg: [
      "sideBar.background",
      "sideBarSectionHeader.background",
      "sideBarTitle.background",
      "sideBarStickyScroll.background",
    ],
    bgDim: [],
    fg: [
      "sideBar.foreground",
      "sideBarTitle.foreground",
      "sideBarSectionHeader.foreground",
    ],
    fgDim: [],
  },
  tab: {
    bg: [
      "editorGroupHeader.tabsBackground",
      "tab.activeBackground",
      "tab.inactiveBackground",
      "tab.unfocusedActiveBackground",
      "tab.unfocusedInactiveBackground",
      "breadcrumb.background",
    ],
    bgDim: [],
    fg: ["tab.activeForeground", "breadcrumb.foreground"],
    fgDim: [
      "tab.inactiveForeground",
      "tab.unfocusedActiveForeground",
      "tab.unfocusedInactiveForeground",
      "breadcrumb.focusForeground",
    ],
  },
  panel: {
    bg: [
      "panel.background",
      "panelSectionHeader.background",
      "panelStickyScroll.background",
    ],
    bgDim: [],
    fg: ["panelTitle.activeForeground", "panelSectionHeader.foreground"],
    fgDim: ["panelTitle.inactiveForeground"],
  },
  border: {
    bg: [
      "activityBar.border",
      "sideBar.border",
      "panel.border",
      "titleBar.border",
      "statusBar.border",
      "tab.border",
    ],
    bgDim: [],
    fg: [],
    fgDim: [],
  },
};

/** All colorCustomization keys we might write, used for cleanup. */
const ALL_MANAGED_KEYS = new Set(
  Object.values(AREA_KEYS).flatMap((v) => [
    ...v.bg,
    ...v.bgDim,
    ...v.fg,
    ...v.fgDim,
  ])
);

export function activate(context: vscode.ExtensionContext) {
  // Apply color on startup.
  applyBranchColor();

  // Re-apply when the user switches branches (fires on HEAD change).
  const gitExt = vscode.extensions.getExtension("vscode.git");
  if (gitExt) {
    const gitApi = gitExt.exports?.getAPI(1);
    if (gitApi) {
      // When repositories change or HEAD moves, re-evaluate.
      gitApi.onDidOpenRepository(() => applyBranchColor());
      for (const repo of gitApi.repositories) {
        repo.state.onDidChange(() => applyBranchColor());
      }
    }
  }

  // Also watch for config changes so the user can live-edit the palette.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("wtColor")) {
        applyBranchColor();
      }
    })
  );

  // Register commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("wt-color.refresh", () => {
      applyBranchColor();
      vscode.window.showInformationMessage("Worktree Color: refreshed.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wt-color.showBranch", () => {
      const branch = getCurrentBranch();
      if (branch) {
        const color = pickColor(branch);
        vscode.window.showInformationMessage(
          `Branch: ${branch}  →  Title bar: ${color}`
        );
      } else {
        vscode.window.showWarningMessage(
          "Worktree Color: no git branch detected."
        );
      }
    })
  );
}

export function deactivate() {}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

let lastAppliedBranch: string | undefined;
let lastAppliedAreas: string | undefined;

function applyBranchColor() {
  const config = vscode.workspace.getConfiguration("wtColor");
  if (!config.get<boolean>("enabled", true)) {
    return;
  }

  // Don't color the main worktree — only color secondary worktrees.
  if (!isSecondaryWorktree()) {
    clearManagedColors();
    return;
  }

  const branch = getCurrentBranch();
  if (!branch) {
    return;
  }

  const areas = config.get<Area[]>("areas", [
    "titleBar",
    "activityBar",
    "statusBar",
  ]);
  const areasKey = areas.sort().join(",");

  // Avoid redundant writes when nothing has changed.
  if (branch === lastAppliedBranch && areasKey === lastAppliedAreas) {
    return;
  }
  lastAppliedBranch = branch;
  lastAppliedAreas = areasKey;

  const bg = pickColor(branch);
  const autoFg = config.get<boolean>("colorTitleBarText", true);
  const fg = autoFg ? readableForeground(bg) : undefined;
  const fgDim = fg ? adjustAlpha(fg, 0.6) : undefined;
  const bgDim = adjustAlpha(bg, 0.6);

  const workbench = vscode.workspace.getConfiguration("workbench");
  const existing =
    workbench.get<Record<string, string>>("colorCustomizations") ?? {};

  // Start fresh: copy existing settings but remove all keys we manage,
  // then add back only the ones for currently-enabled areas.
  const updated: Record<string, string> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (!ALL_MANAGED_KEYS.has(key)) {
      updated[key] = value;
    }
  }

  for (const area of areas) {
    const mapping = AREA_KEYS[area];
    if (!mapping) {
      continue;
    }
    for (const key of mapping.bg) {
      updated[key] = bg;
    }
    for (const key of mapping.bgDim) {
      updated[key] = bgDim;
    }
    if (fg) {
      for (const key of mapping.fg) {
        updated[key] = fg;
      }
    }
    if (fgDim) {
      for (const key of mapping.fgDim) {
        updated[key] = fgDim;
      }
    }
  }

  workbench.update(
    "colorCustomizations",
    updated,
    vscode.ConfigurationTarget.Workspace
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the current workspace is a secondary git worktree
 * (not the main/root worktree). Compares --git-dir to --git-common-dir:
 * in the main worktree they resolve to the same path, in a linked
 * worktree --git-dir points to .git/worktrees/<name>.
 */
function isSecondaryWorktree(): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return false;
  }
  try {
    const cwd = folders[0].uri.fsPath;
    const gitDir = execSync("git rev-parse --git-dir", {
      cwd,
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd,
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    // Resolve to absolute paths for a reliable comparison.
    const abs = (p: string) =>
      path.isAbsolute(p) ? path.resolve(p) : path.resolve(cwd, p);
    return abs(gitDir) !== abs(gitCommonDir);
  } catch {
    return false;
  }
}

/**
 * Remove all color keys managed by this extension from workspace settings.
 * Called when we're in the main worktree so it stays at default colors.
 */
function clearManagedColors() {
  const workbench = vscode.workspace.getConfiguration("workbench");
  const existing =
    workbench.get<Record<string, string>>("colorCustomizations") ?? {};

  let changed = false;
  const updated: Record<string, string> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (ALL_MANAGED_KEYS.has(key)) {
      changed = true;
    } else {
      updated[key] = value;
    }
  }

  if (changed) {
    lastAppliedBranch = undefined;
    lastAppliedAreas = undefined;
    workbench.update(
      "colorCustomizations",
      Object.keys(updated).length > 0 ? updated : undefined,
      vscode.ConfigurationTarget.Workspace
    );
  }
}

function getCurrentBranch(): string | undefined {
  // Prefer the VS Code git extension API.
  const gitExt = vscode.extensions.getExtension("vscode.git");
  if (gitExt) {
    const gitApi = gitExt.exports?.getAPI(1);
    if (gitApi && gitApi.repositories.length > 0) {
      const head = gitApi.repositories[0].state.HEAD;
      if (head?.name) {
        return head.name;
      }
    }
  }

  // Fallback: shell out.
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  try {
    const cwd = folders[0].uri.fsPath;
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
  } catch {
    return undefined;
  }
}

function getPalette(): string[] {
  const config = vscode.workspace.getConfiguration("wtColor");
  const custom = config.get<string[]>("palette", []);
  return custom.length > 0 ? custom : DEFAULT_PALETTE;
}

/**
 * Simple string hash (djb2) mapped to a palette index.
 * Deterministic: the same branch name always yields the same color.
 */
function pickColor(branch: string): string {
  const palette = getPalette();
  let hash = 5381;
  for (let i = 0; i < branch.length; i++) {
    hash = (hash * 33) ^ branch.charCodeAt(i);
  }
  const index = Math.abs(hash) % palette.length;
  return palette[index];
}

/**
 * Return white or black depending on which has better contrast with `hex`.
 */
function readableForeground(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Relative luminance approximation.
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 140 ? "#1a1a1a" : "#f8f8f2";
}

/**
 * Produce an 8-digit hex color with the given alpha (0-1).
 * Used for the inactive title bar to make it subtly dimmer.
 */
function adjustAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return hex.slice(0, 7) + a;
}
