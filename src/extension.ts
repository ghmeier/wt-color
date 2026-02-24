import { execFile, execSync } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

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

interface AreaMapping {
  bg: string[];
  bgDim: string[];
  fg: string[];
  fgDim: string[];
}

/**
 * Maps each UI area to the colorCustomization keys it controls.
 * "bg" keys get the branch color, "fg" keys get the readable foreground,
 * "bgDim" keys get the dimmed (inactive) variant.
 */
const AREA_KEYS: Record<Area, AreaMapping> = {
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

const ALL_MANAGED_KEYS = new Set(
  Object.values(AREA_KEYS).flatMap((v) => [
    ...v.bg,
    ...v.bgDim,
    ...v.fg,
    ...v.fgDim,
  ])
);

const state = {
  isSecondaryWorktree: false,
  lastAppliedBranch: undefined as string | undefined,
  lastAppliedAreas: undefined as string | undefined,
  // biome-ignore lint/suspicious/noExplicitAny: VS Code git extension API is untyped
  gitApi: undefined as any,
};

export async function activate(context: vscode.ExtensionContext) {
  state.gitApi = resolveGitApi();

  state.isSecondaryWorktree = await computeIsSecondaryWorktree();

  applyBranchColor();

  // Re-apply when the user switches branches (fires on HEAD change).
  if (state.gitApi) {
    context.subscriptions.push(
      state.gitApi.onDidOpenRepository((repo: GitRepository) => {
        context.subscriptions.push(
          repo.state.onDidChange(() => applyBranchColor())
        );
        applyBranchColor();
      })
    );
    for (const repo of state.gitApi.repositories) {
      context.subscriptions.push(
        repo.state.onDidChange(() => applyBranchColor())
      );
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

  // Register command pallette commands
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
          `Branch: ${branch}  →  Color: ${color}`
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

function applyBranchColor() {
  const config = vscode.workspace.getConfiguration("wtColor");
  if (!config.get<boolean>("enabled", true)) {
    return;
  }

  if (!state.isSecondaryWorktree) {
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
  const areasKey = [...areas].sort().join(",");

  // Avoid redundant writes when nothing has changed.
  if (
    branch === state.lastAppliedBranch &&
    areasKey === state.lastAppliedAreas
  ) {
    return;
  }
  state.lastAppliedBranch = branch;
  state.lastAppliedAreas = areasKey;

  const bg = pickColor(branch);
  const autoFg = config.get<boolean>("colorTitleBarText", true);
  const fg = autoFg ? readableForeground(bg) : undefined;
  const fgDim = fg ? adjustAlpha(fg, 0.6) : undefined;
  const bgDim = adjustAlpha(bg, 0.6);

  const colors = buildColorMap(areas, { bg, bgDim, fg, fgDim });
  updateColorCustomizations(colors);
}

/**
 * Build a map of VS Code color keys from the selected areas and colors.
 */
function buildColorMap(
  areas: Area[],
  colors: { bg: string; bgDim: string; fg?: string; fgDim?: string }
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const area of areas) {
    const mapping = AREA_KEYS[area];
    if (!mapping) {
      continue;
    }
    for (const key of mapping.bg) {
      result[key] = colors.bg;
    }
    for (const key of mapping.bgDim) {
      result[key] = colors.bgDim;
    }
    if (colors.fg) {
      for (const key of mapping.fg) {
        result[key] = colors.fg;
      }
    }
    if (colors.fgDim) {
      for (const key of mapping.fgDim) {
        result[key] = colors.fgDim;
      }
    }
  }
  return result;
}

/**
 * Merge new color keys into workbench.colorCustomizations, replacing any
 * previously managed keys while preserving user-defined ones.
 */
function updateColorCustomizations(newColors: Record<string, string>) {
  const workbench = vscode.workspace.getConfiguration("workbench");
  const existing =
    workbench.get<Record<string, string>>("colorCustomizations") ?? {};

  const updated = stripManagedKeys(existing);
  Object.assign(updated, newColors);

  workbench.update(
    "colorCustomizations",
    updated,
    vscode.ConfigurationTarget.Workspace
  );
}

/**
 * Remove all color keys managed by this extension from workspace settings.
 * Called when we're in the main worktree so it stays at default colors.
 */
function clearManagedColors() {
  const workbench = vscode.workspace.getConfiguration("workbench");
  const existing =
    workbench.get<Record<string, string>>("colorCustomizations") ?? {};

  const updated = stripManagedKeys(existing);
  if (Object.keys(updated).length === Object.keys(existing).length) {
    return;
  }

  state.lastAppliedBranch = undefined;
  state.lastAppliedAreas = undefined;
  workbench.update(
    "colorCustomizations",
    Object.keys(updated).length > 0 ? updated : undefined,
    vscode.ConfigurationTarget.Workspace
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GitRepository {
  state: {
    HEAD?: { name?: string };
    onDidChange: (cb: () => void) => vscode.Disposable;
  };
}

function resolveGitApi() {
  const gitExt = vscode.extensions.getExtension("vscode.git");
  return gitExt?.exports?.getAPI(1) ?? null;
}

/**
 * Computes whether the current workspace is a secondary git worktree
 * (not the main/root worktree). Compares --git-dir to --git-common-dir:
 * in the main worktree they resolve to the same path, in a linked
 * worktree --git-dir points to .git/worktrees/<name>.
 *
 * Runs both git calls in parallel. Called once at activation and cached
 * for the session lifetime.
 */
async function computeIsSecondaryWorktree(): Promise<boolean> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return false;
  }
  try {
    const cwd = folders[0].uri.fsPath;
    const opts = { cwd, timeout: 3000 };
    const [gitDirResult, gitCommonDirResult] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--git-dir"], opts),
      execFileAsync("git", ["rev-parse", "--git-common-dir"], opts),
    ]);
    const gitDir = gitDirResult.stdout.trim();
    const gitCommonDir = gitCommonDirResult.stdout.trim();
    const abs = (p: string) =>
      path.isAbsolute(p) ? path.resolve(p) : path.resolve(cwd, p);
    return abs(gitDir) !== abs(gitCommonDir);
  } catch {
    return false;
  }
}

/** Return a copy of `colors` with all extension-managed keys removed. */
function stripManagedKeys(
  colors: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    if (!ALL_MANAGED_KEYS.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

function getCurrentBranch(): string | undefined {
  if (state.gitApi && state.gitApi.repositories.length > 0) {
    const head = state.gitApi.repositories[0].state.HEAD;
    if (head?.name) {
      return head.name;
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
