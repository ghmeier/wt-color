import * as vscode from "vscode";
import type { API, GitExtension, Repository } from "./git";

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
  bgBright: string[];
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
    bgBright: [],
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
    bgBright: [],
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
    bgBright: [],
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
    bgBright: [],
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
    bgBright: ["tab.hoverBackground", "tab.unfocusedHoverBackground"],
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
    bgBright: [],
    bgDim: [],
    fg: ["panelTitle.activeForeground", "panelSectionHeader.foreground"],
    fgDim: ["panelTitle.inactiveForeground"],
  },
  border: {
    bg: [],
    bgBright: [
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
    ...v.bgBright,
    ...v.bgDim,
    ...v.fg,
    ...v.fgDim,
  ])
);

const state = {
  initialized: false,
  colors: [] as Record<string, string>[],
  gitApi: undefined as API | undefined,
};

export async function activate(context: vscode.ExtensionContext) {
  state.gitApi = resolveGitApi();
  // The git extension is required.
  if (!state.gitApi) {
    return;
  }

  // Re-apply when the user switches branches (fires on HEAD change).
  context.subscriptions.push(
    state.gitApi.onDidOpenRepository((repo) => {
      context.subscriptions.push(
        repo.state.onDidChange(() => applyBranchColor(repo))
      );
      applyBranchColor(repo);
    })
  );

  // Also watch for config changes so the user can live-edit the palette.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      const repo = state.gitApi?.repositories?.[0];
      if (!repo || !e.affectsConfiguration("wtColor")) {
        return;
      }
      state.initialized = false;
      applyBranchColor(repo);
    })
  );

  // Register command pallette commands
  context.subscriptions.push(
    vscode.commands.registerCommand("wt-color.refresh", () => {
      const repo = state.gitApi?.repositories?.[0];
      if (!repo) {
        return;
      }
      state.initialized = false;
      applyBranchColor(repo);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wt-color.showBranch", () => {
      const branch = state.gitApi?.repositories?.[0]?.state.HEAD?.name;
      if (branch) {
        const ix = pickIndex(branch);
        vscode.window.showInformationMessage(
          `Worktree Color: branch=${branch}, color=${state.colors[ix].bg}`
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

function applyBranchColor(repository: Repository) {
  initializeColors();

  if (!repository || repository.kind !== "worktree") {
    return;
  }

  const branch = repository.state.HEAD?.name;
  if (!branch) {
    return;
  }

  const ix = pickIndex(branch);
  if (!state.colors[ix]) {
    return;
  }

  const workbench = vscode.workspace.getConfiguration("workbench");
  const existing =
    workbench.get<Record<string, string>>("colorCustomizations") ?? {};

  // Merge other colors with extension-managed colors to apply them.
  const updated = stripManagedKeys(existing);
  Object.assign(updated, state.colors[ix]);

  workbench.update(
    "colorCustomizations",
    updated,
    vscode.ConfigurationTarget.Workspace
  );
}

function initializeColors() {
  if (state.initialized) {
    return;
  }

  const config = vscode.workspace.getConfiguration("wtColor");
  state.initialized = true;

  if (!config.get<boolean>("enabled", true)) {
    state.colors = [];
    return;
  }

  const areas = config.get<Area[]>("areas", [
    "titleBar",
    "activityBar",
    "statusBar",
  ]);
  let palette = config.get<string[]>("palette", []);
  if (!palette.length) {
    palette = DEFAULT_PALETTE;
  }

  for (const bg of palette) {
    const fg = readableForeground(bg);
    const fgDim = adjustAlpha(fg, 0.6);
    const bgDim = adjustAlpha(bg, 0.6);
    const bgBright = lighten(bg, 0.1);
    state.colors.push(buildColorMap(areas, { bg, bgBright, bgDim, fg, fgDim }));
  }
}

/**
 * Build a map of VS Code color keys from the selected areas and colors.
 */
function buildColorMap(
  areas: Area[],
  colors: {
    bg: string;
    bgBright: string;
    bgDim: string;
    fg: string;
    fgDim: string;
  }
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
    for (const key of mapping.bgBright) {
      result[key] = colors.bgBright;
    }
    for (const key of mapping.bgDim) {
      result[key] = colors.bgDim;
    }
    for (const key of mapping.fg) {
      result[key] = colors.fg;
    }
    for (const key of mapping.fgDim) {
      result[key] = colors.fgDim;
    }
  }

  return result;
}

function resolveGitApi() {
  const gitExtension =
    vscode.extensions.getExtension<GitExtension>("vscode.git")?.exports;
  return gitExtension?.getAPI(1);
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

/**
 * Return an index into a list of `size` items.
 * - "hash": djb2 hash of the branch name (deterministic per branch name).
 * - "index": the worktree's position in `git worktree list` (sequential rotation).
 */
function pickIndex(branch: string): number {
  let hash = 5381;
  for (let i = 0; i < branch.length; i++) {
    hash = (hash * 33) ^ branch.charCodeAt(i);
  }

  return Math.abs(hash) % state.colors.length;
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
 * Lighten a hex color by mixing it toward white by `amount` (0-1).
 * Used to make borders and hover states visibly brighter than the base color.
 */
function lighten(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
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
