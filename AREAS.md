# UI Areas Reference

This document shows exactly which parts of the VS Code window each `wtColor.areas` option colors.

```
┌─────────────────────────────────────────────────────────────────────┐
│                           titleBar                                  │
├───┬─────────────────────────────────────────────────────────────┬───┤
│   │  tab tab tab tab tab tab                                    │   │
│   ├─────────────────────────────────────────────────────────────┤   │
│   │  breadcrumb > path > shown here  (part of "tab")            │   │
│ a ├──────────────────┬──────────────────────────────────────────┤ s │
│ c │                  │                                          │ e │
│ t │                  │                                          │ s │
│ i │    sideBar       │           editor                         │ s │
│ v │                  │       (not colored)                      │ i │
│ i │                  │                                          │ o │
│ t │                  │                                          │ n │
│ y │                  │                                          │ s │
│ B │                  │                                          │   │
│ a │                  │                                          │   │
│ r │                  ├──────────────────────────────────────────┤   │
│   │                  │           panel                          │   │
│   │                  │    (terminal, output, problems)          │   │
│   │                  │                                          │   │
├───┴──────────────────┴──────────────────────────────────────────┴───┤
│                           statusBar                                 │
└─────────────────────────────────────────────────────────────────────┘

"border" adds a colored line between each of these sections.
```

## Area details

### `titleBar`
The bar at the very top of the window showing the file/workspace name.
- Colors: active background, inactive (unfocused) background, foreground text

### `activityBar`
The narrow icon strip on the far left (or right, if you've moved it). Contains icons for
Explorer, Search, Source Control, Extensions, etc.
- Colors: background, active icon foreground, inactive icon foreground

### `statusBar`
The bar at the very bottom of the window showing branch name, language, line/column, etc.
- Colors: background (normal + debugging mode), foreground text

### `sideBar`
The wider panel next to the activity bar — typically the file explorer, but also search results,
source control changes, etc. Includes section headers (OPEN EDITORS, OUTLINE, TIMELINE).
- Colors: background, section header backgrounds, foreground text

### `tab`
The editor tab strip at the top of the editor area, plus the breadcrumb bar below it.
Covers active tabs, inactive tabs, unfocused tabs, and the breadcrumb path.
- Colors: tab bar background, active/inactive/unfocused tab backgrounds, breadcrumb background, foreground text

### `panel`
The bottom panel area containing the integrated terminal, Output, Problems, and Debug Console.
Includes the panel section headers.
- Colors: background, section header background, active/inactive title foreground

### `border`
Does not fill any area — instead adds a colored border *between* the major sections:
activity bar, sidebar, panel, title bar, status bar, and tab strip. Useful as a subtle
accent when you don't want to change large background areas.
