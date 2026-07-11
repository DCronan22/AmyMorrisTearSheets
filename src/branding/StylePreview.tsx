import type { CSSProperties } from "react";
import type { FirmStyle } from "../types";
import { FONT_STACKS } from "../types";
import { safeLogoUrl } from "../util";

/**
 * A small live sample of an exported tear-sheet page in this style — a mini
 * version of the real one-product-per-page layout (TearSheetPrint), so what
 * the editor shows is what printing / PowerPoint actually produces.
 */
export default function StylePreview({
  style,
  firmName,
}: {
  style: FirmStyle;
  firmName: string;
}) {
  const fonts = FONT_STACKS[style.font];
  const logo = safeLogoUrl(style.logoUrl);
  const vars = {
    "--ts-accent": style.accentColor,
    "--ts-text": style.textColor,
    "--ts-head": fonts.head,
    "--ts-body": fonts.body,
  } as CSSProperties;

  return (
    <div className="tsp" style={vars}>
      {logo ? (
        <img className="tsp-logo" src={logo} alt="" />
      ) : (
        <div className="tsp-wordmark">{style.coverTitle.trim() || firmName}</div>
      )}
      <div className="tsp-room">Living Room</div>
      <div className="tsp-img" />
      <div className="tsp-details">
        <div>Lawson Sofa</div>
        {style.showSku && <div>SKU: LS-204</div>}
        {style.showDimensions && <div>Dimensions: 84"W × 38"D × 31"H</div>}
        {style.showPrice && <div>Price: $3,200</div>}
        <div>Lead Time: 8–10 weeks</div>
      </div>
      {style.footerText.trim() && (
        <div className="tsp-foot">{style.footerText.trim()}</div>
      )}
    </div>
  );
}
