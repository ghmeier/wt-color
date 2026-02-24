# Worktree Color

A VS Code extension that **deterministically colors your VS Code window** based on the current git branch name. When you have multiple worktree windows open, each one gets a distinct, consistent color so you can tell them apart at a glance. You choose which parts of the UI get colored — title bar, activity bar, status bar, sidebar, tabs, panels, or borders.

Same branch = same color, every time.

## How it works

1. On startup (and whenever you switch branches), the extension reads the current git branch name.
2. It hashes the branch name and maps it to a color from a palette.
3. It sets `titleBar.activeBackground` (and related properties) in your **workspace** settings.
4. The title bar updates immediately — no reload needed.

Because the color is derived from a hash of the branch name, the same branch always produces the same color regardless of which machine you're on or when you open the window.

## Installation

### Prerequisites

- Node.js (v18+) and npm
- VS Code or VS Code Insiders

### Build & install from source

```bash
# Clone / navigate to the extension directory
cd ~/git/wt-color

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package into a .vsix file
npm run package
```

This produces a file like `wt-color-0.1.0.vsix` in the project root.

```bash
# Install the .vsix into VS Code Insiders
code-insiders --install-extension wt-color-0.1.0.vsix
```

Then **reload** VS Code (`Cmd+Shift+P` → `Developer: Reload Window`). The title bar should change color immediately if you're in a git repo.

### Quick install (no packaging)

For development or if you just want it running fast:

```bash
cd ~/git/wt-color
npm install
npm run compile
```

Then symlink the extension into your VS Code extensions directory:

```bash
ln -s ~/git/wt-color ~/.vscode-insiders/extensions/wt-color
```

Reload VS Code and you're done.

## Usage

Once installed, the extension activates automatically in any workspace that has a git repository. There's nothing to do — just open your worktrees and each window gets its own color.

### Commands

Open the command palette (`Cmd+Shift+P`) and type:

| Command | What it does |
|---|---|
| `Worktree Color: Refresh Title Bar Color` | Force-refresh the color (useful if something gets out of sync) |
| `Worktree Color: Show Current Branch & Color` | Show the detected branch name and its assigned hex color |

### Settings

All settings live under `wtColor.*` in your VS Code settings:

| Setting | Type | Default | Description |
|---|---|---|---|
| `wtColor.enabled` | boolean | `true` | Turn the extension on/off without uninstalling. |
| `wtColor.palette` | string[] | `[]` (uses built-in) | Custom palette of hex color codes. See below. |
| `wtColor.colorTitleBarText` | boolean | `true` | Auto-pick a readable text color (white/dark) for colored areas. |
| `wtColor.areas` | string[] | `["titleBar", "activityBar", "statusBar"]` | Which UI areas to color. See below. |

### Choosing UI areas

By default the extension colors the **title bar**, **activity bar**, and **status bar**. You can customize this with `wtColor.areas`:

```json
{
  "wtColor.areas": ["titleBar", "activityBar", "statusBar", "border"]
}
```

Available areas:

```
┌──────────────────────────────────────────────────────────────┐
│                        titleBar                              │
├───┬──────────────────────────────────────────────────────┬───┤
│   │  tab tab tab tab                                     │   │
│   ├──────────────────────────────────────────────────────┤   │
│   │  breadcrumb > path  (part of "tab")                  │   │
│ a ├───────────────┬──────────────────────────────────────┤   │
│ c │               │                                      │   │
│ t │   sideBar     │         editor (not colored)         │   │
│ i │               │                                      │   │
│ v │               ├──────────────────────────────────────┤   │
│ i │               │         panel                        │   │
│ t │               │  (terminal, output, problems)        │   │
│ y │               │                                      │   │
│ B ├───────────────┴──────────────────────────────────────┤   │
│ a │                                                      │   │
│ r │                     statusBar                        │   │
└───┴──────────────────────────────────────────────────────┴───┘

"border" adds a colored line between each of these sections.
```

| Area | What it colors |
|---|---|
| `titleBar` | The top title/menu bar (active + inactive backgrounds and text) |
| `activityBar` | The narrow icon strip on the far left/right (background, active + inactive icon foreground) |
| `statusBar` | The bottom status bar (background in normal + debug modes, foreground text) |
| `sideBar` | The file explorer sidebar, including section headers like OPEN EDITORS, OUTLINE, TIMELINE |
| `tab` | The editor tab strip (active, inactive, and unfocused tabs) plus the breadcrumb bar below it |
| `panel` | The bottom panel (terminal, output, problems) including panel section headers |
| `border` | Does not fill any area — adds a colored border *between* major sections as a subtle accent |

For full details on exactly which VS Code color keys each area sets, see `AREAS.md` in the repo.

Mix and match to taste. If the title bar alone isn't distinctive enough, adding `activityBar` and `border` makes the color much more prominent. Changes take effect immediately when you save settings.

### Custom palette

The built-in palette has 12 dark, muted colors inspired by Monokai Pro that work well as title bar backgrounds. If you want your own colors, set `wtColor.palette` in your **user** settings (`Cmd+,` → search "wtColor.palette"):

```json
{
  "wtColor.palette": [
    "#2d1b36",
    "#1b2d36",
    "#362d1b",
    "#1b362d",
    "#361b2d"
  ]
}
```

Tips for choosing colors:
- Use dark/muted colors (title bar text needs to be readable on top).
- More colors = fewer collisions between branches.
- The extension picks a color by hashing the branch name and taking `hash % palette.length`, so changing the palette size will reshuffle assignments.

## How the color is stored

The extension writes to the **workspace-level** `.vscode/settings.json` under `workbench.colorCustomizations`. It only touches the keys for areas you have enabled — your other color customizations are preserved. When you remove an area from `wtColor.areas`, its keys are cleaned up automatically.

If you use worktrees, each worktree has its own `.vscode/settings.json`, so the colors don't interfere with each other.

## Uninstalling

```bash
code-insiders --uninstall-extension ghmeier.wt-color
```

If you used the symlink method:

```bash
rm ~/.vscode-insiders/extensions/wt-color
```

After uninstalling, you may want to remove the `titleBar.*` entries from `.vscode/settings.json` in any workspaces where the extension was active.
