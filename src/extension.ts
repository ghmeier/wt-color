import * as vscode from "vscode";
import type { API, GitExtension, Repository, RepositoryKind } from "./git";

let log: vscode.LogOutputChannel;

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
      "tab.selectedBackground",
      "tab.inactiveBackground",
      "tab.unfocusedActiveBackground",
      "tab.unfocusedInactiveBackground",
      "breadcrumb.background",
    ],
    bgBright: ["tab.hoverBackground", "tab.unfocusedHoverBackground"],
    bgDim: [],
    fg: [
      "tab.activeForeground",
      "tab.selectedForeground",
      "breadcrumb.foreground",
    ],
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
  appliedBranch: undefined as string | undefined,
};

export async function activate(context: vscode.ExtensionContext) {
  log = vscode.window.createOutputChannel("Worktree Color", { log: true });
  context.subscriptions.push(log);
  log.info("Activating wt-color extension");

  state.gitApi = resolveGitApi();
  // The git extension is required.
  if (!state.gitApi) {
    log.warn("Git extension not found — deactivating");
    return;
  }
  log.info("Git API resolved");

  // Subscribe to state changes for a repository with debounce.
  const watchRepo = (repo: Repository) => {
    log.info(`Watching repository: ${repo.rootUri.fsPath} (kind=${repo.kind})`);
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    context.subscriptions.push(
      repo.state.onDidChange(() => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          log.debug(`Repository state changed: ${repo.rootUri.fsPath}`);
          applyBranchColor(repo);
        }, 150);
      })
    );
    applyBranchColor(repo);
  };

  // Handle repos that were already open before we activated.
  for (const repo of state.gitApi.repositories) {
    watchRepo(repo);
  }

  // Also handle repos that open after activation.
  context.subscriptions.push(
    state.gitApi.onDidOpenRepository((repo) => watchRepo(repo))
  );

  // Also watch for config changes so the user can live-edit the palette.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      const repo = state.gitApi?.repositories?.[0];
      if (!repo || !e.affectsConfiguration("wtColor")) {
        return;
      }
      log.info("wtColor configuration changed — reinitializing");
      state.initialized = false;
      state.appliedBranch = undefined;
      applyBranchColor(repo);
    })
  );

  // Register command pallette commands
  context.subscriptions.push(
    vscode.commands.registerCommand("wt-color.refresh", () => {
      log.info("Manual refresh triggered");
      const repo = state.gitApi?.repositories?.[0];
      if (!repo) {
        log.warn("No repository found for refresh");
        return;
      }
      state.initialized = false;
      state.appliedBranch = undefined;
      applyBranchColor(repo);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wt-color.showBranch", () => {
      const repo = state.gitApi?.repositories?.[0];
      const branch = repo?.state.HEAD?.name;

      if (branch) {
        const ix = pickIndex(branch);
        vscode.window.showInformationMessage(
          `Worktree Color: branch=${branch}, color=${state.colors[ix]?.bg ?? "default"}`
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

export type ColorAction =
  | { type: "apply"; branch: string }
  | { type: "clear" }
  | { type: "skip" };

/**
 * Decide what a single repository's state change should do to the shared,
 * window-wide color customizations. Pure so the strobing behavior can be
 * tested without the VS Code runtime.
 *
 * The git extension tracks one `Repository` per worktree, submodule, and
 * parent repo, and every one of them fires state-change events. Coloring is
 * global, so only the repository backing the open workspace folder may drive
 * it: a repo whose root is not an open folder returns "skip" rather than
 * "clear". Without that, a submodule or parent repo would clear the colors the
 * open worktree just applied on every git poll — the extension strobing on
 * and off.
 */
export function decideColorAction(
  repo: {
    kind: RepositoryKind;
    rootPath: string;
    branch: string | undefined;
  },
  workspaceFolderPaths: string[],
  appliedBranch: string | undefined
): ColorAction {
  const isOpenFolder = workspaceFolderPaths.includes(repo.rootPath);

  // A repository that isn't the open workspace folder must not touch the
  // shared color state, or it fights the open worktree's apply and strobes.
  if (!isOpenFolder) {
    return { type: "skip" };
  }

  if (repo.kind !== "worktree" || !repo.branch) {
    return { type: "clear" };
  }

  // Colors for this branch are already applied — nothing to do.
  if (repo.branch === appliedBranch) {
    return { type: "skip" };
  }

  return { type: "apply", branch: repo.branch };
}

function applyBranchColor(repository: Repository) {
  initializeColors();

  const workspaceFolderPaths =
    vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
  const action = decideColorAction(
    {
      kind: repository.kind,
      rootPath: repository.rootUri.fsPath,
      branch: repository.state.HEAD?.name,
    },
    workspaceFolderPaths,
    state.appliedBranch
  );

  if (action.type === "skip") {
    log.debug(
      `Skipping color for ${repository.rootUri.fsPath} (kind=${repository.kind})`
    );
    return;
  }

  if (action.type === "clear") {
    log.info(
      `Clearing color — kind=${repository.kind}, branch=${repository.state.HEAD?.name ?? "none"}`
    );
    clearColors();
    return;
  }

  const branch = action.branch;
  const ix = pickIndex(branch);
  if (!state.colors[ix]) {
    log.warn(`No color at index ${ix} for branch "${branch}" — clearing`);
    clearColors();
    return;
  }

  log.info(
    `Applying color index=${ix} for branch="${branch}" (${state.colors[ix]["titleBar.activeBackground"] ?? "n/a"})`
  );

  const workbench = vscode.workspace.getConfiguration("workbench");
  const existing =
    workbench.get<Record<string, string>>("colorCustomizations") ?? {};

  workbench.update(
    "colorCustomizations",
    { ...existing, ...state.colors[ix] },
    vscode.ConfigurationTarget.Workspace
  );
  state.appliedBranch = branch;
}

function clearColors() {
  log.debug("clearColors called");
  state.appliedBranch = undefined;
  const workbench = vscode.workspace.getConfiguration("workbench");
  const existing =
    workbench.get<Record<string, string>>("colorCustomizations") ?? {};
  const updated = stripManagedKeys(existing);
  if (Object.keys(updated).length === Object.keys(existing).length) {
    log.debug("No managed keys to clear");
    return;
  }

  log.info(
    `Clearing ${Object.keys(existing).length - Object.keys(updated).length} managed color keys`
  );
  workbench.update(
    "colorCustomizations",
    Object.keys(updated).length > 0 ? updated : undefined,
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
    log.info("Extension disabled via wtColor.enabled — no colors loaded");
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

  log.info(
    `Initializing ${palette.length} colors for areas: [${areas.join(", ")}]`
  );

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
export function buildColorMap(
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
export function stripManagedKeys(
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
export function pickIndex(branch: string): number {
  let hash = 5381;
  for (let i = 0; i < branch.length; i++) {
    hash = (hash * 33) ^ branch.charCodeAt(i);
  }

  return Math.abs(hash) % state.colors.length;
}

const FG_DARK = "#1a1a1a";
const FG_LIGHT = "#f8f8f2";

/**
 * Return whichever foreground token (dark or light) has the higher WCAG
 * contrast ratio against `hex`.
 *
 * Linearize the contrast ratio to relative luminance and compare the actual
 * contrast ratios. Pick white or black depending on which has a higher contrast.
 */
export function readableForeground(hex: string): string {
  return contrastRatio(hex, FG_DARK) >= contrastRatio(hex, FG_LIGHT)
    ? FG_DARK
    : FG_LIGHT;
}

/** WCAG relative luminance (0-1) of a 7-char sRGB hex color. */
function relativeLuminance(hex: string): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1-21) between two 7-char hex colors. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Lighten a hex color by mixing it toward white by `amount` (0-1).
 * Used to make borders and hover states visibly brighter than the base color.
 */
export function lighten(hex: string, amount: number): string {
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
export function adjustAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return hex.slice(0, 7) + a;
}
