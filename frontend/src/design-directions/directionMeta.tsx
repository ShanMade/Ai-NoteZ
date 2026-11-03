import type { SVGProps } from "react";
import type { DesignDirection } from "../store/ui";

/**
 * Shared description of the three design directions. The palettes mirror the values in each
 * direction's tokens.css (light and dark) so the swatches shown in settings and on the design
 * switcher match what the app actually renders. Keep them in sync when a token changes.
 */

type GlyphProps = SVGProps<SVGSVGElement> & { size?: number };

function glyphBase({ size = 20, ...rest }: GlyphProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    ...rest,
  };
}

/** Precision: a target with a single guide axis, for focused, keyboard-first work. */
export function PrecisionGlyph(props: GlyphProps) {
  return (
    <svg {...glyphBase(props)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3.5v3.1M12 17.4v3.1M3.5 12h3.1M17.4 12h3.1" />
    </svg>
  );
}

/** Workspace: a notebook page with a turned corner and written lines. */
export function WorkspaceGlyph(props: GlyphProps) {
  return (
    <svg {...glyphBase(props)}>
      <path d="M6 3.5h8.6L19 7.9V19.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M14.5 3.7v4.5H19" />
      <path d="M8.5 11.5h7M8.5 14.8h7M8.5 18h4.2" />
    </svg>
  );
}

/** Graph: connected nodes, for ideas that link into a larger network. */
export function GraphGlyph(props: GlyphProps) {
  return (
    <svg {...glyphBase(props)}>
      <circle cx="6.5" cy="7" r="2.3" />
      <circle cx="17.5" cy="6" r="2.3" />
      <circle cx="12" cy="17.5" r="2.3" />
      <path d="M8.5 8.2 10.8 15.6M15.6 7.7 13.2 15.6M8.8 7.1l6.9-.9" />
    </svg>
  );
}

export interface DirectionPalette {
  accent: string;
  surface: string;
  ink: string;
}

export interface DirectionMeta {
  id: DesignDirection;
  /** i18n key suffix under `settings.*` */
  labelKey: "precision" | "workspace" | "graph";
  name: string;
  reference: string;
  summary: string;
  Glyph: (props: GlyphProps) => JSX.Element;
  light: DirectionPalette;
  dark: DirectionPalette;
}

export const DIRECTIONS: DirectionMeta[] = [
  {
    id: "a",
    labelKey: "precision",
    name: "Precision",
    reference: "Linear-inspired",
    summary: "Quiet, compact and keyboard-first.",
    Glyph: PrecisionGlyph,
    light: { accent: "#6d63d9", surface: "#f7f8fa", ink: "#20232a" },
    dark: { accent: "#a39cf7", surface: "#000000", ink: "#f0f0f3" },
  },
  {
    id: "b",
    labelKey: "workspace",
    name: "Workspace",
    reference: "Notion-inspired",
    summary: "Warm and spacious, with room for your words.",
    Glyph: WorkspaceGlyph,
    light: { accent: "#a7684a", surface: "#ffffff", ink: "#37352f" },
    dark: { accent: "#d29a7d", surface: "#191919", ink: "#f1f0ed" },
  },
  {
    id: "c",
    labelKey: "graph",
    name: "Graph",
    reference: "Obsidian-inspired",
    summary: "Connected thinking, with ideas linked into a network.",
    Glyph: GraphGlyph,
    light: { accent: "#b34bf2", surface: "#e5e8eb", ink: "#20272e" },
    dark: { accent: "#d58cff", surface: "#000000", ink: "#e9f0f3" },
  },
];

export function directionMeta(id: DesignDirection): DirectionMeta {
  return DIRECTIONS.find((direction) => direction.id === id) ?? DIRECTIONS[1];
}
