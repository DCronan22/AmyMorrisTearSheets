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

import type Anthropic from "@anthropic-ai/sdk";
import type { ExtractedFields } from "./extract-core.js";
import { MODEL, getClient, cleanText, systemBlocks } from "./anthropic.js";
import type { ImageMediaType } from "./anthropic.js";

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

function blocksToFields(message: Anthropic.Message): ExtractedFields {
  for (const block of message.content) {
    if (block.type === "tool_use" && block.name === "record_product") {
      const raw = block.input as Record<string, unknown>;
      const price =
        typeof raw.price === "number" && Number.isFinite(raw.price)
          ? raw.price
          : null;
      return {
        name: cleanText(raw.name),
        vendor: cleanText(raw.vendor),
        collection: cleanText(raw.collection),
        category: cleanText(raw.category),
        sku: cleanText(raw.sku),
        price,
        dimensions: cleanText(raw.dimensions),
        material: cleanText(raw.material),
        color: cleanText(raw.color),
      };
    }
  }
  return {};
}

const SYSTEM_BLOCKS = systemBlocks(SYSTEM_PROMPT);

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
  mediaType: ImageMediaType
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
