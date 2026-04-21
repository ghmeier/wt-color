# Worktree Color

Deterministically colors your VS Code window based on the current git worktree's branch name. It makes it easy to quickly identify worktrees at a glance when multiple windows are open. 

## Installation

[Install from the VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=ghmeier.wt-color).


### Manual Installation

```bash
npm install && npm run compile && npm run package
code-insiders --install-extension wt-color-0.1.0.vsix
```

Or for development, symlink directly:

```bash
npm install && npm run compile
ln -s ~/git/wt-color ~/.vscode-insiders/extensions/wt-color
```

Reload VS Code after installing.

## Settings

| Setting | Default | Description |
|---|---|---|
| `wtColor.enabled` | `true` | Turn the extension on/off. |
| `wtColor.palette` | `["#2d1b36","#1b2d36","#362d1b","#1b362d","#361b2d","#1b2536","#36351b","#2b1b36","#1b3625","#361b1b","#1b3636","#36261b",]` | Custom hex color palette. |
| `wtColor.colorTitleBarText` | `true` | Auto-pick readable text color for colored areas. |
| `wtColor.areas` | `["titleBar", "activityBar", "statusBar"]` | Which UI areas to color. |

### Areas

You can customize the areas of your editor that are overriden with the worktree color. 

Available values: `titleBar`, `activityBar`, `statusBar`, `sideBar`, `tab`, `panel`, `border`.

```
┌──────────────────────────────────────────────────────────────┐
│                        titleBar                              │
├───┬──────────────────────────────────────────────────────────┤
│   │  tab tab tab                                             │
│ a ├──────────────────────────────────────────────────────────┤
│ c │               │                                          │
│ t │   sideBar     │         editor (not colored)             │
│ i │               │                                          │
│ v │               ├──────────────────────────────────────────┤
│ i │               │         panel                            │
│ t │               │  (terminal, output, problems)            │
│ y ├───────────────┴──────────────────────────────────────────┤
│ B │                                                          │
│ a │                     statusBar                            │
│ r │                                                          │
└───┴──────────────────────────────────────────────────────────┘
"border" adds a colored line between sections.
```

### Custom palette

Override the built-in 12-color palette with your own hex codes:

```json
{
  "wtColor.palette": ["#2d1b36", "#1b2d36", "#362d1b", "#1b362d", "#361b2d"]
}
```

Use dark/muted colors so text stays readable. Changing palette size or order reshuffles assignments.

## Commands

| Command | Description |
|---|---|
| `Worktree Color: Refresh` | Force-refresh the color. |
| `Worktree Color: Show` | Show the detected branch and its assigned color. |

## How it works

The extension hashes the branch name (djb2) and maps it to a palette index. It writes to `workbench.colorCustomizations` in the **workspace-level** `.vscode/settings.json`, only touching keys for enabled areas. Your other color customizations are preserved.

## Uninstalling

```bash
code-insiders --uninstall-extension ghmeier.wt-color
```

You may want to clean up `titleBar.*` / `activityBar.*` entries from `.vscode/settings.json` in affected workspaces.
