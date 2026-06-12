// Tier 2 (AI) extraction — used only as a fallback when free structured-data
// extraction (extract-core.ts) comes up empty, or for image/screenshot uploads.
// SERVER-SIDE ONLY: reads ANTHROPIC_API_KEY from process.env, never the client.
//
// Cost controls (the cost auditor's requirements):
//   - Haiku (cheapest adequate model)
//   - strict tool use → small, well-formed JSON; max_tokens kept low
//   - input is truncated before it ever reaches the model
//   - prompt caching on the stable system + tool prefix
//   - NEVER send firm/client PII — inputs here are vendor product pages/images only

import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedFields } from "./extract-core.js";

// Haiku is the deliberate, cost-driven choice for field extraction.
const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 600; // output is a small JSON object
const MAX_TEXT_CHARS = 8000; // hard cap on page text sent to the model

const SYSTEM_PROMPT =
  "You extract interior-design product specifications from a vendor's product " +
  "page text or product image. Return ONLY the fields you are confident about " +
  "by calling the record_product tool. Leave a field as an empty string (or " +
  "null for price) when it is not clearly present — never invent a value, " +
  "especially price. Infer a sensible category (e.g. Seating, Lighting, Rug, " +
  "Table, Case Goods, Textile, Art, Accessory) and the vendor's product " +
  "line/collection only when they are reasonably evident. Prices are unit " +
  "prices as a number with no currency symbol.";

// Strict tool = guaranteed JSON shape. Every property is listed in `required`
// (strict requirement); unknown values come back as "" / null.
const RECORD_TOOL: Anthropic.Tool = {
  name: "record_product",
  description: "Record the extracted product specification fields.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", description: "Product name" },
      vendor: { type: "string", description: "Manufacturer / brand" },
      collection: { type: "string", description: "Product line / collection" },
      category: { type: "string", description: "Category, e.g. Seating, Lighting" },
      sku: { type: "string", description: "SKU / model number" },
      price: { type: ["number", "null"], description: "Unit price, number only" },
      dimensions: { type: "string", description: "Dimensions, e.g. 90\"W x 40\"D x 33\"H" },
      material: { type: "string", description: "Material / finish" },
      color: { type: "string", description: "Color / colorway" },
    },
    required: [
      "name",
      "vendor",
      "collection",
      "category",
      "sku",
      "price",
      "dimensions",
      "material",
      "color",
    ],
  },
};

let client: Anthropic | null = null;
function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("AI extraction is not configured on the server.");
  client ??= new Anthropic({ apiKey: key });
  return client;
}

/** True when the server has an Anthropic key configured. */
export function aiExtractAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// A model can occasionally leak its own tool-call delimiters (e.g.
// "<parameter name=...>", "</antml...parameter>") as literal text inside a
// string value. Strict tool use guarantees JSON shape, not clean string
// contents. Legitimate product specs never contain tag markup, so cut the
// value at the first tag-like fragment ("<" + optional "/" + a letter) and trim.
function cleanText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.split(/<\s*\/?\s*[A-Za-z]/)[0].trim();
  return s ? s : undefined;
}

function blocksToFields(message: Anthropic.Message): ExtractedFields {
  for (const block of message.content) {
    if (block.type === "tool_use" && block.name === "record_product") {
      const raw = block.input as Record<string, unknown>;
      const str = cleanText;
      const price =
        typeof raw.price === "number" && Number.isFinite(raw.price)
          ? raw.price
          : null;
      return {
        name: str(raw.name),
        vendor: str(raw.vendor),
        collection: str(raw.collection),
        category: str(raw.category),
        sku: str(raw.sku),
        price,
        dimensions: str(raw.dimensions),
        material: str(raw.material),
        color: str(raw.color),
      };
    }
  }
  return {};
}

// Stable system block carries a cache breakpoint; the tool list is deterministic.
// (Prefix may be below Haiku's 4K cache minimum, in which case caching is a no-op
//  — harmless, and it kicks in for free if the prompt grows.)
const SYSTEM_BLOCKS: Anthropic.TextBlockParam[] = [
  { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
];

/** Extract fields from raw product-page text (fallback path). */
export async function aiExtractFromText(text: string): Promise<ExtractedFields> {
  const trimmed = text.slice(0, MAX_TEXT_CHARS);
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_BLOCKS,
    tools: [RECORD_TOOL],
    tool_choice: { type: "tool", name: "record_product" },
    messages: [
      {
        role: "user",
        content: `Extract the product details from this page text:\n\n${trimmed}`,
      },
    ],
  });
  return blocksToFields(message);
}

/** Extract fields from a product image / screenshot (base64, no data: prefix). */
export async function aiExtractFromImage(
  base64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"
): Promise<ExtractedFields> {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_BLOCKS,
    tools: [RECORD_TOOL],
    tool_choice: { type: "tool", name: "record_product" },
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
            text: "Extract the interior-design product details shown in this image.",
          },
        ],
      },
    ],
  });
  return blocksToFields(message);
}
