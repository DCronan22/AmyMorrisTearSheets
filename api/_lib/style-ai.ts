// AI style detection — analyzes an uploaded sample tear sheet and suggests a
// reusable export style. SERVER-SIDE ONLY: reads ANTHROPIC_API_KEY from
// process.env, never the client. DORMANT until that key is set.
//
// Same cost discipline as ai-extract.ts: Haiku, forced tool use → small JSON,
// low max_tokens, prompt caching on the stable system prefix.

import Anthropic from "@anthropic-ai/sdk";

// Mirrors the client/src DetectedStyle (api/ can't import from src). All fields
// optional — the caller merges only what comes back over the firm's defaults.
export interface DetectedStyle {
  accentColor?: string;
  textColor?: string;
  font?: "classic-serif" | "modern-sans" | "editorial" | "minimal";
  layout?: "list" | "grid" | "spotlight";
  showPrice?: boolean;
  showSku?: boolean;
  showDimensions?: boolean;
  coverTitle?: string;
  footerText?: string;
}

const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 400;

const SYSTEM_PROMPT =
  "You analyze a sample of an interior-design firm's existing tear sheet / spec " +
  "sheet so we can replicate its visual style in future exports. Look at the " +
  "overall design and call the record_style tool. Return colors as hex strings " +
  "(e.g. #6d6047): accentColor = the dominant heading/rule/brand color, " +
  "textColor = the body text color. Pick the closest font category and the " +
  "closest layout. Set showPrice/showSku/showDimensions based on whether those " +
  "appear on the sample. Use footerText only if a clear footer tagline is " +
  "visible. Omit any field you cannot determine — never guess.";

const RECORD_TOOL: Anthropic.Tool = {
  name: "record_style",
  description: "Record the visual style detected from the sample tear sheet.",
  input_schema: {
    type: "object",
    properties: {
      accentColor: { type: "string", description: "Dominant heading/brand color, hex" },
      textColor: { type: "string", description: "Body text color, hex" },
      font: {
        type: "string",
        enum: ["classic-serif", "modern-sans", "editorial", "minimal"],
        description: "Closest font category",
      },
      layout: {
        type: "string",
        enum: ["list", "grid", "spotlight"],
        description:
          "list = image left + specs right; grid = cards 2-up; spotlight = one large item per page",
      },
      showPrice: { type: "boolean" },
      showSku: { type: "boolean" },
      showDimensions: { type: "boolean" },
      footerText: { type: "string", description: "Footer tagline, only if clearly visible" },
    },
  },
};

let client: Anthropic | null = null;
function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("AI style detection is not configured on the server.");
  client ??= new Anthropic({ apiKey: key });
  return client;
}

/** True when the server has an Anthropic key configured. */
export function detectStyleAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM_BLOCKS: Anthropic.TextBlockParam[] = [
  { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function blocksToStyle(message: Anthropic.Message): DetectedStyle {
  for (const block of message.content) {
    if (block.type === "tool_use" && block.name === "record_style") {
      const raw = block.input as Record<string, unknown>;
      const out: DetectedStyle = {};
      const hex = (v: unknown) =>
        typeof v === "string" && HEX_RE.test(v.trim()) ? v.trim().toLowerCase() : undefined;
      const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
      // Cut any leaked tool-call / tag markup out of free-text values; footer
      // text never legitimately contains a "<tag" fragment. (See ai-extract.ts.)
      const str = (v: unknown) => {
        if (typeof v !== "string") return undefined;
        const s = v.split(/<\s*\/?\s*[A-Za-z]/)[0].trim();
        return s ? s : undefined;
      };

      out.accentColor = hex(raw.accentColor);
      out.textColor = hex(raw.textColor);
      if (
        raw.font === "classic-serif" ||
        raw.font === "modern-sans" ||
        raw.font === "editorial" ||
        raw.font === "minimal"
      )
        out.font = raw.font;
      if (raw.layout === "list" || raw.layout === "grid" || raw.layout === "spotlight")
        out.layout = raw.layout;
      out.showPrice = bool(raw.showPrice);
      out.showSku = bool(raw.showSku);
      out.showDimensions = bool(raw.showDimensions);
      out.footerText = str(raw.footerText);

      // Drop undefined keys so the merge on the client only applies real hits.
      return Object.fromEntries(
        Object.entries(out).filter(([, v]) => v !== undefined)
      ) as DetectedStyle;
    }
  }
  return {};
}

/** Detect a style from a sample-sheet image (base64, no data: prefix). */
export async function detectStyleFromImage(
  base64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"
): Promise<DetectedStyle> {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_BLOCKS,
    tools: [RECORD_TOOL],
    tool_choice: { type: "tool", name: "record_style" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: "Analyze this sample tear sheet and record its visual style.",
          },
        ],
      },
    ],
  });
  return blocksToStyle(message);
}
