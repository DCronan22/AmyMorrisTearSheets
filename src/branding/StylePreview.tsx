import type { CSSProperties } from "react";
import type { FirmStyle } from "../types";
import { FONT_STACKS } from "../types";
import { safeLogoUrl } from "../util";

/** A small, self-contained sample of how a tear sheet will look in this style. */
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
    <div className={`tsp tsp-${style.layout}`} style={vars}>
      <div className="tsp-cover">
        {logo && <img className="tsp-logo" src={logo} alt="" />}
        <div className="tsp-firm">{style.coverTitle.trim() || firmName}</div>
        <div className="tsp-project">Smith Residence</div>
      </div>
      <div className="tsp-room">Living Room</div>
      <div className="tsp-items">
        {[0, 1].map((i) => (
          <div className="tsp-item" key={i}>
            <div className="tsp-img" />
            <div className="tsp-info">
              <div className="tsp-name">Lawson Sofa</div>
              <div className="tsp-vendor">Vendor · Collection</div>
              {style.showSku && <div className="tsp-spec">SKU · LS-204</div>}
              {style.showDimensions && (
                <div className="tsp-spec">84"W × 38"D × 31"H</div>
              )}
            </div>
            {style.showPrice && <div className="tsp-price">$3,200</div>}
          </div>
        ))}
      </div>
      <div className="tsp-foot">
        {style.footerText.trim() || `${firmName} Tear Sheets`}
      </div>
    </div>
  );
}
