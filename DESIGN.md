---
name: Three-body sandbox
description: A scientific instrument sheet in graphite and warm white, with one vermilion accent.
colors:
  plate: "#060607"
  ground: "#0d0d0f"
  raised: "#121214"
  field: "#1a1a1d"
  rule: "#26262a"
  rule-strong: "#3b3b40"
  ink: "#e6e3dc"
  ink-2: "#a6a39b"
  ink-3: "#858279"
  accent: "#ff5a36"
  accent-ink: "#1a0803"
  ok: "#8fbf86"
  warning: "#e5a73c"
  body-1: "#f2b84b"
  body-2: "#6aa6ff"
  body-3: "#ece8dc"
typography:
  display:
    fontFamily: "Archivo Variable"
    fontSize: 56px
    fontWeight: 300
  headline:
    fontFamily: "Archivo Variable"
    fontSize: 30px
    fontWeight: 700
  title:
    fontFamily: "Archivo Variable"
    fontSize: 16px
    fontWeight: 650
  body:
    fontFamily: "Archivo Variable"
    fontSize: 13.5px
    fontWeight: 400
  reading:
    fontFamily: "Source Serif 4 Variable"
    fontSize: 18px
    fontWeight: 400
  label:
    fontFamily: "Archivo Variable"
    fontSize: 11.5px
    fontWeight: 400
rounded:
  control: 2px
spacing:
  gutter: 20px
  cell: 18px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    height: 32px
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: 32px
  segment-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    height: 24px
---

# Design System: Three-body sandbox

## Overview

**Creative North Star: "The Plate and the Specification"**

The simulator is laid out like a figure in a journal beside its specification sheet. The 3D view is the plate: a night sky with a caption and a large clock, never a card. Beside it runs a narrow column of ruled sections, each a module of controls. Along the top, one row of ruled cells holds the always-needed controls. Hierarchy comes from type size, weight and width against dense small text, and from 1px rules, not from fills, shadows or color.

The mode is Operate, so familiar affordances stay familiar: buttons look like buttons, selects like selects. The Learn page is Read mode and uses the same tokens with a serif reading column and oversized condensed chapter titles. Both are pages of one app, switched from the masthead.

**Key Characteristics:**
- Flat and ruled: no cards, shadows, gradients, glass or glow. Radius is 2px at most.
- One accent, used sparingly; the only other colors are the three bodies.
- Numbers are tabular everywhere, set in the same family as the labels.
- Dark only: the plate is a night sky and the chrome stays out of its way.

## Colors

Restrained: graphite neutrals tinted slightly warm, one vermilion accent.

### Primary
- **Signal Vermilion** (#ff5a36): the Play button when paused, the open tab's underline, the focus ring, text selection, the drag handle of the panel, the worst warning, and event marks on the charts. Nothing else.

### Secondary (the bodies)
- **Gold** (#f2b84b), **Cornflower** (#6aa6ff), **Bone** (#ece8dc): body 1, 2, 3, in the 3D view, the brand mark and the velocity arrows. Chosen as a set so each pair stays apart under protan, deutan and tritan simulation (minimum ΔE 36).

### Neutral
- **Plate** (#060607) is the 3D view. **Ground** (#0d0d0f) is the bar and the charts. **Raised** (#121214) is the panel and menus. **Field** (#1a1a1d) is inputs and hover. **Rule** (#26262a) and **Rule strong** (#3b3b40) are the 1px lines.
- **Ink** (#e6e3dc), **Ink 2** (#a6a39b), **Ink 3** (#858279): text, secondary text, labels (all at least 4.5:1 on Ground).

### Named Rules
**The One Accent Rule.** Vermilion is for acting and for the worst problem. If it appears twice in one view for different reasons, one of them is wrong.
**The Body Colors Are Data.** Gold, cornflower and bone mean "this body" and never decorate the chrome.

## Typography

**Interface font:** Archivo Variable (weight 100-900, width 62-125%), self-hosted.
**Reading font:** Source Serif 4 Variable (optical sizes), Learn page only.

- **Display** (300, 56px, width 78%): the simulated time on the plate.
- **Headline** (700, 30px, width 76%): the preset's name; chapter titles on the Learn page go up to 62px at width 70%.
- **Title** (650, 16px): module names, banner titles.
- **Body** (400, 13.5px): panel text, at most 62ch.
- **Label** (400, 11.5px): the name above each bar control.

### Named Rules
**Width Is the Display Voice.** Large type is condensed (width 66-86%), never a different family.
**No Costume Mono.** Numbers use tabular figures of the same family; monospace is not used.

## Elevation

None. Depth is a 1px rule or a step in ground (Ground, Raised, Field). The Modules menu hangs from the bar with a border, not a shadow.

## Components

- **Bar cells:** a caption above, the value below in 15px/600, ruled off by 1px verticals. Selects are borderless.
- **Buttons:** 32px, 1px Rule-strong outline, 2px radius. The primary (Play while paused) is filled Vermilion. Hover lifts the border to Ink 3.
- **Bodies switch:** a 24px segmented control, the selected segment filled Ink.
- **Tabs (pages, panel groups, Charts and Modules switches):** flat cells, the open one underlined 2px in Vermilion.
- **Module sections:** a 16px title with a chevron and a close, a rule between sections, no background.
- **Banners:** a full-width strip across the top of the plate, a title column and a text column, a square the color of the tone beside the title.
- **Menus:** ruled sheets hung from a bar: the module chooser is one column of checkbox rows grouped by tab; the Layout menu is four rows, each with a line sketch of the page it makes and a tick on the current one.
- **Charts:** Ink lines on Ground, decade grid lines only, Vermilion event marks, and a 1px Ink 3 line that follows the pointer across every plot at once, with the time and value in each plot's title row.

## Layout

For a desktop window, 1200 by 680 and up; below that the page scrolls rather than reflows. A 44px masthead runs across the top of both pages: the name, the pages as flat tabs (Simulator, Learn; the open one underlined 2px in Vermilion), and on the simulator a Layout menu at the far right. On the Plate color so it reads as a title strip.

The simulator is asymmetric by design: the plate about two thirds, a tabbed specification column of 420px (resizable, 340-720), and a 64px instrument bar. The column has four tabs (System, Method, Analysis, View) and a chooser at the end of the strip; modules inside are 54px heads with 24px side padding. The charts drawer under the plate is a share of the plate's height set by the user (a 1px rule on its top edge that turns Vermilion on hover, and a Height slider in its header); its plots are laid out to fill it, one row when short and rows of larger plots when tall.

The Learn page keeps the Read mode: a 288px contents column (grouped Foundations, The methods, Behaviour, Reference), then chapters of two columns each: the chapter title, large and condensed, stays at the left while a 74ch serif column scrolls at the right. Lists of short entries (presets, glossary, references) run across the full width in two columns.

## Do's and Don'ts

**Do** keep every control reachable by keyboard, with a 2px Vermilion focus ring. **Do** name a tone in words as well as color.
**Don't** use cards, shadows, gradients, glass, glow, colored side borders, section numbers, or icon circles. **Don't** use Vermilion for decoration, or the body colors for chrome.
