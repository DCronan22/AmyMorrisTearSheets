import { strToU8, zipSync } from "fflate";
import type { FirmStyle, InventoryItem } from "./types";
import { safeLogoUrl } from "./util";
import { triggerDownload } from "./storage";
// The form's wording and value formatting are shared with the print/PDF and
// PowerPoint renderings of the same form, so all three stay identical.
import { FORM_LABELS, FORM_TITLE, formDate, formPrice, oneLine } from "./inventoryForm";

// Word inventory-form export — one "INVENTORY DETAIL FORM" page per stock
// entry, reproducing the firm's existing paperwork (the Word document Amy
// Morris's office fills in by hand for every piece they buy) rather than
// inventing a layout: US Letter, 0.5in margins, letterhead in the header,
// Georgia throughout, an 18pt bold centered title, double-spaced bold-label /
// regular-value lines, and the product photo inside a hairline-bordered box.
//
// A .docx is a ZIP of XML parts, so we build it the same way src/pptx.ts reads
// one — with fflate, entirely in the browser, no server and no new dependency.
// The boilerplate parts (styles, theme, settings, font table, footnotes) are
// the ones Word itself emitted in the reference document, embedded verbatim
// below: that is what makes the file both visually identical and one Word
// opens without a repair prompt. Only the form body, the header/footer and the
// images are generated.
//
// Multi-tenancy: the reference header/footer are Amy Morris's letterhead
// images, so those two are rebuilt per firm — the firm's own logo at the
// reference geometry (or its name as a wordmark, like the .pptx export does),
// and its footer tagline as centered Georgia text. Everything else is the
// reference, identical for every firm.

// ── Geometry, measured from the reference document ────────────────────────

const PAGE_W_TW = 12240; // w:pgSz — US Letter 8.5in x 11in, in twips
const PAGE_H_TW = 15840;
const MARGIN_TW = 720; // w:pgMar top/right/bottom/left — 0.5in
const HEADER_TW = 720; // header band
const FOOTER_TW = 390; // footer band

// The reference letterhead is 4173855 x 871220 EMU. A firm's own logo is
// fitted to that HEIGHT with its natural aspect ratio preserved — its width
// follows from the image, so nobody's mark comes out stretched.
const LOGO_H_EMU = 871220;

const BOX_W_EMU = 3305175; // the bordered photo box (3.615in x 3.344in)
const BOX_H_EMU = 3057525;
const BORDER_EMU = 9525; // a:ln w — 0.75pt black rectangle
const PHOTO_W_EMU = 2286000; // photo width inside the box (2.5in); the height
// follows the photo's real aspect ratio, exactly as the reference's does.
const PHOTO_OFFSET_EMU = 6350; // wp:positionV posOffset

const TITLE_SZ = 36; // half-points — 18pt
const WORDMARK_SZ = 84; // 42pt, the no-logo firm wordmark (matches pptxExport)
const FOOTER_SZ = 22; // 11pt footer tagline

// ── The template: XML Word wrote, embedded verbatim ───────────────────────

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

// The namespace + mc:Ignorable attribute lists off the reference parts. Every
// part in the package uses one of these three, character for character.
const NS_MAIN = "xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\" xmlns:cx=\"http://schemas.microsoft.com/office/drawing/2014/chartex\" xmlns:cx1=\"http://schemas.microsoft.com/office/drawing/2015/9/8/chartex\" xmlns:cx2=\"http://schemas.microsoft.com/office/drawing/2015/10/21/chartex\" xmlns:cx3=\"http://schemas.microsoft.com/office/drawing/2016/5/9/chartex\" xmlns:cx4=\"http://schemas.microsoft.com/office/drawing/2016/5/10/chartex\" xmlns:cx5=\"http://schemas.microsoft.com/office/drawing/2016/5/11/chartex\" xmlns:cx6=\"http://schemas.microsoft.com/office/drawing/2016/5/12/chartex\" xmlns:cx7=\"http://schemas.microsoft.com/office/drawing/2016/5/13/chartex\" xmlns:cx8=\"http://schemas.microsoft.com/office/drawing/2016/5/14/chartex\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" xmlns:aink=\"http://schemas.microsoft.com/office/drawing/2016/ink\" xmlns:am3d=\"http://schemas.microsoft.com/office/drawing/2017/model3d\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:oel=\"http://schemas.microsoft.com/office/2019/extlst\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:wp14=\"http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:w10=\"urn:schemas-microsoft-com:office:word\" xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" xmlns:w15=\"http://schemas.microsoft.com/office/word/2012/wordml\" xmlns:w16cex=\"http://schemas.microsoft.com/office/word/2018/wordml/cex\" xmlns:w16cid=\"http://schemas.microsoft.com/office/word/2016/wordml/cid\" xmlns:w16=\"http://schemas.microsoft.com/office/word/2018/wordml\" xmlns:w16du=\"http://schemas.microsoft.com/office/word/2023/wordml/word16du\" xmlns:w16sdtdh=\"http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash\" xmlns:w16sdtfl=\"http://schemas.microsoft.com/office/word/2024/wordml/sdtformatlock\" xmlns:w16se=\"http://schemas.microsoft.com/office/word/2015/wordml/symex\" xmlns:wpg=\"http://schemas.microsoft.com/office/word/2010/wordprocessingGroup\" xmlns:wpi=\"http://schemas.microsoft.com/office/word/2010/wordprocessingInk\" xmlns:wne=\"http://schemas.microsoft.com/office/word/2006/wordml\" xmlns:wps=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\" mc:Ignorable=\"w14 w15 w16se w16cid w16 w16cex w16sdtdh w16sdtfl w16du wp14\"";
const NS_CORE = "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" xmlns:w15=\"http://schemas.microsoft.com/office/word/2012/wordml\" xmlns:w16cex=\"http://schemas.microsoft.com/office/word/2018/wordml/cex\" xmlns:w16cid=\"http://schemas.microsoft.com/office/word/2016/wordml/cid\" xmlns:w16=\"http://schemas.microsoft.com/office/word/2018/wordml\" xmlns:w16du=\"http://schemas.microsoft.com/office/word/2023/wordml/word16du\" xmlns:w16sdtdh=\"http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash\" xmlns:w16sdtfl=\"http://schemas.microsoft.com/office/word/2024/wordml/sdtformatlock\" xmlns:w16se=\"http://schemas.microsoft.com/office/word/2015/wordml/symex\" mc:Ignorable=\"w14 w15 w16se w16cid w16 w16cex w16sdtdh w16sdtfl w16du\"";
const NS_SETTINGS = "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:w10=\"urn:schemas-microsoft-com:office:word\" xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" xmlns:w15=\"http://schemas.microsoft.com/office/word/2012/wordml\" xmlns:w16cex=\"http://schemas.microsoft.com/office/word/2018/wordml/cex\" xmlns:w16cid=\"http://schemas.microsoft.com/office/word/2016/wordml/cid\" xmlns:w16=\"http://schemas.microsoft.com/office/word/2018/wordml\" xmlns:w16du=\"http://schemas.microsoft.com/office/word/2023/wordml/word16du\" xmlns:w16sdtdh=\"http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash\" xmlns:w16sdtfl=\"http://schemas.microsoft.com/office/word/2024/wordml/sdtformatlock\" xmlns:w16se=\"http://schemas.microsoft.com/office/word/2015/wordml/symex\" xmlns:sl=\"http://schemas.openxmlformats.org/schemaLibrary/2006/main\" mc:Ignorable=\"w14 w15 w16se w16cid w16 w16cex w16sdtdh w16sdtfl w16du\"";

// styles.xml — docDefaults (11pt body) plus the ten real styles, including the
// Normal / Header / Footer definitions the form's paragraphs inherit from.
// Word's 27 KB <w:latentStyles> block is dropped: it only populates the style
// gallery in Word's UI and nothing in this document renders from it.
const STYLES_BODY = "<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme=\"minorHAnsi\" w:eastAsiaTheme=\"minorHAnsi\" w:hAnsiTheme=\"minorHAnsi\" w:cstheme=\"minorBidi\"/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/><w:lang w:val=\"en-US\" w:eastAsia=\"en-US\" w:bidi=\"ar-SA\"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after=\"200\" w:line=\"276\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/><w:rsid w:val=\"006F2589\"/><w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/></w:pPr><w:rPr><w:rFonts w:ascii=\"Times New Roman\" w:eastAsia=\"Times New Roman\" w:hAnsi=\"Times New Roman\" w:cs=\"Times New Roman\"/><w:sz w:val=\"24\"/><w:szCs w:val=\"24\"/></w:rPr></w:style><w:style w:type=\"character\" w:default=\"1\" w:styleId=\"DefaultParagraphFont\"><w:name w:val=\"Default Paragraph Font\"/><w:uiPriority w:val=\"1\"/><w:semiHidden/><w:unhideWhenUsed/></w:style><w:style w:type=\"table\" w:default=\"1\" w:styleId=\"TableNormal\"><w:name w:val=\"Normal Table\"/><w:uiPriority w:val=\"99\"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w=\"0\" w:type=\"dxa\"/><w:tblCellMar><w:top w:w=\"0\" w:type=\"dxa\"/><w:left w:w=\"108\" w:type=\"dxa\"/><w:bottom w:w=\"0\" w:type=\"dxa\"/><w:right w:w=\"108\" w:type=\"dxa\"/></w:tblCellMar></w:tblPr></w:style><w:style w:type=\"numbering\" w:default=\"1\" w:styleId=\"NoList\"><w:name w:val=\"No List\"/><w:uiPriority w:val=\"99\"/><w:semiHidden/><w:unhideWhenUsed/></w:style><w:style w:type=\"paragraph\" w:styleId=\"ListParagraph\"><w:name w:val=\"List Paragraph\"/><w:basedOn w:val=\"Normal\"/><w:uiPriority w:val=\"34\"/><w:qFormat/><w:rsid w:val=\"00751E15\"/><w:pPr><w:spacing w:after=\"200\" w:line=\"276\" w:lineRule=\"auto\"/><w:ind w:left=\"720\"/><w:contextualSpacing/></w:pPr><w:rPr><w:rFonts w:asciiTheme=\"minorHAnsi\" w:eastAsiaTheme=\"minorHAnsi\" w:hAnsiTheme=\"minorHAnsi\" w:cstheme=\"minorBidi\"/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/></w:rPr></w:style><w:style w:type=\"paragraph\" w:styleId=\"BalloonText\"><w:name w:val=\"Balloon Text\"/><w:basedOn w:val=\"Normal\"/><w:link w:val=\"BalloonTextChar\"/><w:uiPriority w:val=\"99\"/><w:semiHidden/><w:unhideWhenUsed/><w:rsid w:val=\"00751E15\"/><w:rPr><w:rFonts w:ascii=\"Tahoma\" w:eastAsiaTheme=\"minorHAnsi\" w:hAnsi=\"Tahoma\" w:cs=\"Tahoma\"/><w:sz w:val=\"16\"/><w:szCs w:val=\"16\"/></w:rPr></w:style><w:style w:type=\"character\" w:customStyle=\"1\" w:styleId=\"BalloonTextChar\"><w:name w:val=\"Balloon Text Char\"/><w:basedOn w:val=\"DefaultParagraphFont\"/><w:link w:val=\"BalloonText\"/><w:uiPriority w:val=\"99\"/><w:semiHidden/><w:rsid w:val=\"00751E15\"/><w:rPr><w:rFonts w:ascii=\"Tahoma\" w:hAnsi=\"Tahoma\" w:cs=\"Tahoma\"/><w:sz w:val=\"16\"/><w:szCs w:val=\"16\"/></w:rPr></w:style><w:style w:type=\"paragraph\" w:styleId=\"Header\"><w:name w:val=\"header\"/><w:basedOn w:val=\"Normal\"/><w:link w:val=\"HeaderChar\"/><w:uiPriority w:val=\"99\"/><w:semiHidden/><w:unhideWhenUsed/><w:rsid w:val=\"00E33D28\"/><w:pPr><w:tabs><w:tab w:val=\"center\" w:pos=\"4680\"/><w:tab w:val=\"right\" w:pos=\"9360\"/></w:tabs></w:pPr><w:rPr><w:rFonts w:asciiTheme=\"minorHAnsi\" w:eastAsiaTheme=\"minorHAnsi\" w:hAnsiTheme=\"minorHAnsi\" w:cstheme=\"minorBidi\"/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/></w:rPr></w:style><w:style w:type=\"character\" w:customStyle=\"1\" w:styleId=\"HeaderChar\"><w:name w:val=\"Header Char\"/><w:basedOn w:val=\"DefaultParagraphFont\"/><w:link w:val=\"Header\"/><w:uiPriority w:val=\"99\"/><w:semiHidden/><w:rsid w:val=\"00E33D28\"/></w:style><w:style w:type=\"paragraph\" w:styleId=\"Footer\"><w:name w:val=\"footer\"/><w:basedOn w:val=\"Normal\"/><w:link w:val=\"FooterChar\"/><w:uiPriority w:val=\"99\"/><w:semiHidden/><w:unhideWhenUsed/><w:rsid w:val=\"00E33D28\"/><w:pPr><w:tabs><w:tab w:val=\"center\" w:pos=\"4680\"/><w:tab w:val=\"right\" w:pos=\"9360\"/></w:tabs></w:pPr><w:rPr><w:rFonts w:asciiTheme=\"minorHAnsi\" w:eastAsiaTheme=\"minorHAnsi\" w:hAnsiTheme=\"minorHAnsi\" w:cstheme=\"minorBidi\"/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/></w:rPr></w:style><w:style w:type=\"character\" w:customStyle=\"1\" w:styleId=\"FooterChar\"><w:name w:val=\"Footer Char\"/><w:basedOn w:val=\"DefaultParagraphFont\"/><w:link w:val=\"Footer\"/><w:uiPriority w:val=\"99\"/><w:semiHidden/><w:rsid w:val=\"00E33D28\"/></w:style>";

// settings.xml — compat level, default tab stop (720 twips, which the form's
// tab-separated fields depend on), math and shape defaults. The reference
// author's <w:rsids> revision history is dropped.
const SETTINGS_BODY = "<w:zoom w:percent=\"100\"/><w:doNotDisplayPageBoundaries/><w:defaultTabStop w:val=\"720\"/><w:drawingGridHorizontalSpacing w:val=\"120\"/><w:displayHorizontalDrawingGridEvery w:val=\"2\"/><w:characterSpacingControl w:val=\"doNotCompress\"/><w:footnotePr><w:footnote w:id=\"-1\"/><w:footnote w:id=\"0\"/></w:footnotePr><w:endnotePr><w:endnote w:id=\"-1\"/><w:endnote w:id=\"0\"/></w:endnotePr><w:compat><w:compatSetting w:name=\"compatibilityMode\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"15\"/><w:compatSetting w:name=\"overrideTableStyleFontSizeAndJustification\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"1\"/><w:compatSetting w:name=\"enableOpenTypeFeatures\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"1\"/><w:compatSetting w:name=\"doNotFlipMirrorIndents\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"1\"/><w:compatSetting w:name=\"differentiateMultirowTableHeaders\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"1\"/><w:compatSetting w:name=\"useWord2013TrackBottomHyphenation\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"0\"/></w:compat><m:mathPr><m:mathFont m:val=\"Cambria Math\"/><m:brkBin m:val=\"before\"/><m:brkBinSub m:val=\"--\"/><m:smallFrac m:val=\"0\"/><m:dispDef/><m:lMargin m:val=\"0\"/><m:rMargin m:val=\"0\"/><m:defJc m:val=\"centerGroup\"/><m:wrapIndent m:val=\"1440\"/><m:intLim m:val=\"subSup\"/><m:naryLim m:val=\"undOvr\"/></m:mathPr><w:themeFontLang w:val=\"en-US\"/><w:clrSchemeMapping w:bg1=\"light1\" w:t1=\"dark1\" w:bg2=\"light2\" w:t2=\"dark2\" w:accent1=\"accent1\" w:accent2=\"accent2\" w:accent3=\"accent3\" w:accent4=\"accent4\" w:accent5=\"accent5\" w:accent6=\"accent6\" w:hyperlink=\"hyperlink\" w:followedHyperlink=\"followedHyperlink\"/><w:shapeDefaults><o:shapedefaults v:ext=\"edit\" spidmax=\"1026\"/><o:shapelayout v:ext=\"edit\"><o:idmap v:ext=\"edit\" data=\"1\"/></o:shapelayout></w:shapeDefaults><w:decimalSymbol w:val=\".\"/><w:listSeparator w:val=\",\"/><w14:docId w14:val=\"7988075B\"/><w15:docId w15:val=\"{D4A35089-FC2A-4F5B-B04F-BD95215E8605}\"/>";

const FONT_TABLE_BODY = "<w:font w:name=\"Symbol\"><w:panose1 w:val=\"05050102010706020507\"/><w:charset w:val=\"02\"/><w:family w:val=\"roman\"/><w:pitch w:val=\"variable\"/><w:sig w:usb0=\"00000000\" w:usb1=\"10000000\" w:usb2=\"00000000\" w:usb3=\"00000000\" w:csb0=\"80000000\" w:csb1=\"00000000\"/></w:font><w:font w:name=\"Times New Roman\"><w:panose1 w:val=\"02020603050405020304\"/><w:charset w:val=\"00\"/><w:family w:val=\"roman\"/><w:pitch w:val=\"variable\"/><w:sig w:usb0=\"E0002EFF\" w:usb1=\"C000785B\" w:usb2=\"00000009\" w:usb3=\"00000000\" w:csb0=\"000001FF\" w:csb1=\"00000000\"/></w:font><w:font w:name=\"Wingdings\"><w:panose1 w:val=\"05000000000000000000\"/><w:charset w:val=\"02\"/><w:family w:val=\"auto\"/><w:pitch w:val=\"variable\"/><w:sig w:usb0=\"00000000\" w:usb1=\"10000000\" w:usb2=\"00000000\" w:usb3=\"00000000\" w:csb0=\"80000000\" w:csb1=\"00000000\"/></w:font><w:font w:name=\"Courier New\"><w:panose1 w:val=\"02070309020205020404\"/><w:charset w:val=\"00\"/><w:family w:val=\"modern\"/><w:pitch w:val=\"fixed\"/><w:sig w:usb0=\"E0002AFF\" w:usb1=\"C0007843\" w:usb2=\"00000009\" w:usb3=\"00000000\" w:csb0=\"000001FF\" w:csb1=\"00000000\"/></w:font><w:font w:name=\"Calibri\"><w:panose1 w:val=\"020F0502020204030204\"/><w:charset w:val=\"00\"/><w:family w:val=\"swiss\"/><w:pitch w:val=\"variable\"/><w:sig w:usb0=\"E4002EFF\" w:usb1=\"C200247B\" w:usb2=\"00000009\" w:usb3=\"00000000\" w:csb0=\"000001FF\" w:csb1=\"00000000\"/></w:font><w:font w:name=\"Tahoma\"><w:panose1 w:val=\"020B0604030504040204\"/><w:charset w:val=\"00\"/><w:family w:val=\"swiss\"/><w:notTrueType/><w:pitch w:val=\"variable\"/><w:sig w:usb0=\"00000003\" w:usb1=\"00000000\" w:usb2=\"00000000\" w:usb3=\"00000000\" w:csb0=\"00000001\" w:csb1=\"00000000\"/></w:font><w:font w:name=\"Georgia\"><w:panose1 w:val=\"02040502050405020303\"/><w:charset w:val=\"00\"/><w:family w:val=\"roman\"/><w:pitch w:val=\"variable\"/><w:sig w:usb0=\"00000287\" w:usb1=\"00000000\" w:usb2=\"00000000\" w:usb3=\"00000000\" w:csb0=\"0000009F\" w:csb1=\"00000000\"/></w:font><w:font w:name=\"Cambria\"><w:panose1 w:val=\"02040503050406030204\"/><w:charset w:val=\"00\"/><w:family w:val=\"roman\"/><w:pitch w:val=\"variable\"/><w:sig w:usb0=\"E00006FF\" w:usb1=\"420024FF\" w:usb2=\"02000000\" w:usb3=\"00000000\" w:csb0=\"0000019F\" w:csb1=\"00000000\"/></w:font>";
const WEB_SETTINGS_BODY = "<w:optimizeForBrowser/><w:allowPNG/>";
const FOOTNOTES_BODY = "<w:footnote w:type=\"separator\" w:id=\"-1\"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type=\"continuationSeparator\" w:id=\"0\"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>";
const ENDNOTES_BODY = "<w:endnote w:type=\"separator\" w:id=\"-1\"><w:p><w:r><w:separator/></w:r></w:p></w:endnote><w:endnote w:type=\"continuationSeparator\" w:id=\"0\"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>";

// theme1.xml — the Office theme styles.xml's docDefaults resolve their
// minorHAnsi font against. Embedded whole.
const THEME_XML = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"Office Theme\"><a:themeElements><a:clrScheme name=\"Office\"><a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1><a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1><a:dk2><a:srgbClr val=\"1F497D\"/></a:dk2><a:lt2><a:srgbClr val=\"EEECE1\"/></a:lt2><a:accent1><a:srgbClr val=\"4F81BD\"/></a:accent1><a:accent2><a:srgbClr val=\"C0504D\"/></a:accent2><a:accent3><a:srgbClr val=\"9BBB59\"/></a:accent3><a:accent4><a:srgbClr val=\"8064A2\"/></a:accent4><a:accent5><a:srgbClr val=\"4BACC6\"/></a:accent5><a:accent6><a:srgbClr val=\"F79646\"/></a:accent6><a:hlink><a:srgbClr val=\"0000FF\"/></a:hlink><a:folHlink><a:srgbClr val=\"800080\"/></a:folHlink></a:clrScheme><a:fontScheme name=\"Office\"><a:majorFont><a:latin typeface=\"Cambria\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/><a:font script=\"Jpan\" typeface=\"ＭＳ ゴシック\"/><a:font script=\"Hang\" typeface=\"맑은 고딕\"/><a:font script=\"Hans\" typeface=\"宋体\"/><a:font script=\"Hant\" typeface=\"新細明體\"/><a:font script=\"Arab\" typeface=\"Times New Roman\"/><a:font script=\"Hebr\" typeface=\"Times New Roman\"/><a:font script=\"Thai\" typeface=\"Angsana New\"/><a:font script=\"Ethi\" typeface=\"Nyala\"/><a:font script=\"Beng\" typeface=\"Vrinda\"/><a:font script=\"Gujr\" typeface=\"Shruti\"/><a:font script=\"Khmr\" typeface=\"MoolBoran\"/><a:font script=\"Knda\" typeface=\"Tunga\"/><a:font script=\"Guru\" typeface=\"Raavi\"/><a:font script=\"Cans\" typeface=\"Euphemia\"/><a:font script=\"Cher\" typeface=\"Plantagenet Cherokee\"/><a:font script=\"Yiii\" typeface=\"Microsoft Yi Baiti\"/><a:font script=\"Tibt\" typeface=\"Microsoft Himalaya\"/><a:font script=\"Thaa\" typeface=\"MV Boli\"/><a:font script=\"Deva\" typeface=\"Mangal\"/><a:font script=\"Telu\" typeface=\"Gautami\"/><a:font script=\"Taml\" typeface=\"Latha\"/><a:font script=\"Syrc\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Orya\" typeface=\"Kalinga\"/><a:font script=\"Mlym\" typeface=\"Kartika\"/><a:font script=\"Laoo\" typeface=\"DokChampa\"/><a:font script=\"Sinh\" typeface=\"Iskoola Pota\"/><a:font script=\"Mong\" typeface=\"Mongolian Baiti\"/><a:font script=\"Viet\" typeface=\"Times New Roman\"/><a:font script=\"Uigh\" typeface=\"Microsoft Uighur\"/><a:font script=\"Geor\" typeface=\"Sylfaen\"/></a:majorFont><a:minorFont><a:latin typeface=\"Calibri\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/><a:font script=\"Jpan\" typeface=\"ＭＳ 明朝\"/><a:font script=\"Hang\" typeface=\"맑은 고딕\"/><a:font script=\"Hans\" typeface=\"宋体\"/><a:font script=\"Hant\" typeface=\"新細明體\"/><a:font script=\"Arab\" typeface=\"Arial\"/><a:font script=\"Hebr\" typeface=\"Arial\"/><a:font script=\"Thai\" typeface=\"Cordia New\"/><a:font script=\"Ethi\" typeface=\"Nyala\"/><a:font script=\"Beng\" typeface=\"Vrinda\"/><a:font script=\"Gujr\" typeface=\"Shruti\"/><a:font script=\"Khmr\" typeface=\"DaunPenh\"/><a:font script=\"Knda\" typeface=\"Tunga\"/><a:font script=\"Guru\" typeface=\"Raavi\"/><a:font script=\"Cans\" typeface=\"Euphemia\"/><a:font script=\"Cher\" typeface=\"Plantagenet Cherokee\"/><a:font script=\"Yiii\" typeface=\"Microsoft Yi Baiti\"/><a:font script=\"Tibt\" typeface=\"Microsoft Himalaya\"/><a:font script=\"Thaa\" typeface=\"MV Boli\"/><a:font script=\"Deva\" typeface=\"Mangal\"/><a:font script=\"Telu\" typeface=\"Gautami\"/><a:font script=\"Taml\" typeface=\"Latha\"/><a:font script=\"Syrc\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Orya\" typeface=\"Kalinga\"/><a:font script=\"Mlym\" typeface=\"Kartika\"/><a:font script=\"Laoo\" typeface=\"DokChampa\"/><a:font script=\"Sinh\" typeface=\"Iskoola Pota\"/><a:font script=\"Mong\" typeface=\"Mongolian Baiti\"/><a:font script=\"Viet\" typeface=\"Arial\"/><a:font script=\"Uigh\" typeface=\"Microsoft Uighur\"/><a:font script=\"Geor\" typeface=\"Sylfaen\"/></a:minorFont></a:fontScheme><a:fmtScheme name=\"Office\"><a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"50000\"/><a:satMod val=\"300000\"/></a:schemeClr></a:gs><a:gs pos=\"35000\"><a:schemeClr val=\"phClr\"><a:tint val=\"37000\"/><a:satMod val=\"300000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:tint val=\"15000\"/><a:satMod val=\"350000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"16200000\" scaled=\"1\"/></a:gradFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:shade val=\"51000\"/><a:satMod val=\"130000\"/></a:schemeClr></a:gs><a:gs pos=\"80000\"><a:schemeClr val=\"phClr\"><a:shade val=\"93000\"/><a:satMod val=\"130000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"94000\"/><a:satMod val=\"135000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"16200000\" scaled=\"0\"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w=\"9525\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"><a:shade val=\"95000\"/><a:satMod val=\"105000\"/></a:schemeClr></a:solidFill><a:prstDash val=\"solid\"/></a:ln><a:ln w=\"25400\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/></a:ln><a:ln w=\"38100\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst><a:outerShdw blurRad=\"40000\" dist=\"20000\" dir=\"5400000\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"38000\"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad=\"40000\" dist=\"23000\" dir=\"5400000\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"35000\"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad=\"40000\" dist=\"23000\" dir=\"5400000\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"35000\"/></a:srgbClr></a:outerShdw></a:effectLst><a:scene3d><a:camera prst=\"orthographicFront\"><a:rot lat=\"0\" lon=\"0\" rev=\"0\"/></a:camera><a:lightRig rig=\"threePt\" dir=\"t\"><a:rot lat=\"0\" lon=\"0\" rev=\"1200000\"/></a:lightRig></a:scene3d><a:sp3d><a:bevelT w=\"63500\" h=\"25400\"/></a:sp3d></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"40000\"/><a:satMod val=\"350000\"/></a:schemeClr></a:gs><a:gs pos=\"40000\"><a:schemeClr val=\"phClr\"><a:tint val=\"45000\"/><a:shade val=\"99000\"/><a:satMod val=\"350000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"20000\"/><a:satMod val=\"255000\"/></a:schemeClr></a:gs></a:gsLst><a:path path=\"circle\"><a:fillToRect l=\"50000\" t=\"-80000\" r=\"50000\" b=\"180000\"/></a:path></a:gradFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"80000\"/><a:satMod val=\"300000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"30000\"/><a:satMod val=\"200000\"/></a:schemeClr></a:gs></a:gsLst><a:path path=\"circle\"><a:fillToRect l=\"50000\" t=\"50000\" r=\"50000\" b=\"50000\"/></a:path></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>";

const STYLES_XML = `${XML_DECL}<w:styles ${NS_CORE}>${STYLES_BODY}</w:styles>`;
const SETTINGS_XML = `${XML_DECL}<w:settings ${NS_SETTINGS}>${SETTINGS_BODY}</w:settings>`;
const FONT_TABLE_XML = `${XML_DECL}<w:fonts ${NS_CORE}>${FONT_TABLE_BODY}</w:fonts>`;
const WEB_SETTINGS_XML = `${XML_DECL}<w:webSettings ${NS_CORE}>${WEB_SETTINGS_BODY}</w:webSettings>`;
const FOOTNOTES_XML = `${XML_DECL}<w:footnotes ${NS_MAIN}>${FOOTNOTES_BODY}</w:footnotes>`;
const ENDNOTES_XML = `${XML_DECL}<w:endnotes ${NS_MAIN}>${ENDNOTES_BODY}</w:endnotes>`;

const PKG_RELS = `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const WPS_NS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";

// ── Run / paragraph building blocks ───────────────────────────────────────

/** Georgia on every single run — the reference sets it run by run, never via
 *  a paragraph style, so a firm that restyles Normal can't disturb the form. */
const GEORGIA = '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>';
/** Field labels are bold. */
const RPR_LABEL = `${GEORGIA}<w:b/>`;
/** Values carry <w:bCs/> (complex-script bold only), i.e. they render at
 *  regular weight — that is literally how the firm's document is marked up. */
const RPR_VALUE = `${GEORGIA}<w:bCs/>`;
/** The bold + underlined runs the form uses as fill-in-by-hand rules. */
const RPR_RULE = `${GEORGIA}<w:b/><w:u w:val="single"/>`;

function esc(s: string): string {
  return s
    // Control characters XML 1.0 simply cannot carry; they'd make Word report
    // the package as corrupt, so they're dropped rather than escaped. (Values
    // have already been through oneLine(), so no real whitespace is lost.)
    .replace(/\p{Cc}/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


function run(rPr: string, content: string): string {
  return `<w:r><w:rPr>${rPr}</w:rPr>${content}</w:r>`;
}

function text(s: string): string {
  return `<w:t xml:space="preserve">${esc(s)}</w:t>`;
}

function tabs(n: number): string {
  return "<w:tab/>".repeat(n);
}

const label = (t: string) => run(RPR_LABEL, text(t));
const value = (t: string) => run(RPR_VALUE, text(t));
/** A value run, or nothing at all when the field is blank — the label line
 *  still prints, because this is a form. */
const valueOrBlank = (t: string) => (t ? value(t) : "");
const rule = (t: string) => run(RPR_RULE, text(t));

/** One double-spaced field line. `mark` is the paragraph mark's own run
 *  properties, which Word records per paragraph and which we keep so the
 *  cursor picks up the same formatting mid-form as in the original. */
function fieldPara(mark: string, ...runs: string[]): string {
  return `<w:p><w:pPr><w:spacing w:line="480" w:lineRule="auto"/><w:rPr>${mark}</w:rPr></w:pPr>${runs.join("")}</w:p>`;
}

/** An empty paragraph carrying only its mark formatting. */
function emptyPara(mark: string, pPrExtra = ""): string {
  return `<w:p><w:pPr>${pPrExtra}<w:rPr>${mark}</w:rPr></w:pPr></w:p>`;
}

// ── Value formatting, matched to the sample literally ─────────────────────



/** "#abc" / "#aabbcc" / "#aabbccdd" → the 6-digit hex OOXML wants. */
function toDocxColor(c: string, fallback: string): string {
  const hex = c.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3,4}$/.test(hex)) {
    return hex
      .slice(0, 3)
      .split("")
      .map((ch) => ch + ch)
      .join("")
      .toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) {
    return hex.slice(0, 6).toUpperCase();
  }
  return fallback;
}

// ── Images ────────────────────────────────────────────────────────────────

/** A decoded image ready to become a media part: bytes + extension + size. */
interface EmbeddableImage {
  bytes: Uint8Array;
  /** "png" | "jpeg" | "gif" — the part's extension and its content type. */
  ext: string;
  w: number;
  h: number;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read image data."));
    r.readAsDataURL(blob);
  });
}

function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      img.naturalWidth > 0
        ? resolve(img)
        : reject(new Error("Image decoded to zero size."));
    img.onerror = () => reject(new Error("Image could not be decoded."));
    img.src = dataUrl;
  });
}

// Word reliably renders JPEG/PNG/GIF; anything else (webp/avif/svg off a vendor
// CDN) is re-encoded to PNG via canvas, like the .pptx export does. The pixels
// came from our own fetch or data URL, so the canvas is never tainted.
const DOCX_SAFE_MIME = new Set(["image/jpeg", "image/png", "image/gif"]);

function reencodeToPng(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}

const B64 = ";base64,";

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const i = dataUrl.indexOf(B64);
  if (i < 0) return null;
  const bin = atob(dataUrl.slice(i + B64.length));
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return bytes;
}

/**
 * Resolve an item image (stored data URL or remote product photo) into an
 * embeddable image. Remote fetches are best-effort: vendor CDNs that send no
 * CORS headers fail here and the form prints with an empty photo box (and the
 * item is counted into `missingImages`), exactly like the .pptx export's
 * placeholder path. Returns null on failure.
 */
async function loadImage(src: string): Promise<EmbeddableImage | null> {
  try {
    let dataUrl: string;
    if (src.startsWith("data:image/")) {
      dataUrl = src;
    } else {
      const url = new URL(src, window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      const res = await fetch(url.href, { mode: "cors" });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) return null;
      dataUrl = await blobToDataUrl(blob);
    }
    const img = await decodeImage(dataUrl);
    let mime = dataUrl.slice(5, dataUrl.indexOf(";"));
    let bytes = DOCX_SAFE_MIME.has(mime) ? dataUrlToBytes(dataUrl) : null;
    if (!bytes) {
      // Unsupported format, or a data URL that isn't base64 (an inline SVG):
      // repaint it to PNG.
      dataUrl = reencodeToPng(img);
      mime = "image/png";
      bytes = dataUrlToBytes(dataUrl);
    }
    if (!bytes) return null;
    return {
      bytes,
      ext: mime.slice("image/".length),
      w: img.naturalWidth,
      h: img.naturalHeight,
    };
  } catch {
    return null;
  }
}

// ── Drawings ──────────────────────────────────────────────────────────────

/** An inline picture: `cx` wide, its height following the real aspect ratio. */
function inlinePicture(
  relId: string,
  id: number,
  cx: number,
  cy: number
): string {
  return (
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="Picture ${id}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A_NS}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${A_NS}"><a:graphicData uri="${PIC_NS}">` +
    `<pic:pic xmlns:pic="${PIC_NS}">` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
  );
}

/**
 * The photo box: a white, hairline-bordered text box anchored centered on the
 * margin, with the product photo inline inside it. The reference wraps this in
 * an <mc:AlternateContent> whose fallback is a VML copy for Word 2007; we emit
 * the modern branch only (every Word since 2010, and LibreOffice, read it).
 */
function photoBox(shapeId: number, inner: string): string {
  return (
    run(
      `${GEORGIA}<w:noProof/>`,
      `<w:drawing><wp:anchor distT="45720" distB="45720" distL="114300" distR="114300" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
        `<wp:simplePos x="0" y="0"/>` +
        `<wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>` +
        `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${PHOTO_OFFSET_EMU}</wp:posOffset></wp:positionV>` +
        `<wp:extent cx="${BOX_W_EMU}" cy="${BOX_H_EMU}"/>` +
        `<wp:effectExtent l="0" t="0" r="9525" b="15875"/>` +
        `<wp:wrapSquare wrapText="bothSides"/>` +
        `<wp:docPr id="${shapeId}" name="Text Box ${shapeId}"/>` +
        `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A_NS}"/></wp:cNvGraphicFramePr>` +
        `<a:graphic xmlns:a="${A_NS}"><a:graphicData uri="${WPS_NS}">` +
        `<wps:wsp><wps:cNvSpPr txBox="1"><a:spLocks noChangeArrowheads="1"/></wps:cNvSpPr>` +
        `<wps:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="${BOX_W_EMU}" cy="${BOX_H_EMU}"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
        `<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>` +
        `<a:ln w="${BORDER_EMU}"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:miter lim="800000"/><a:headEnd/><a:tailEnd/></a:ln>` +
        `</wps:spPr>` +
        `<wps:txbx><w:txbxContent>` +
        `<w:p><w:pPr><w:ind w:firstLine="720"/><w:rPr>${RPR_LABEL}</w:rPr></w:pPr>${inner}</w:p>` +
        `</w:txbxContent></wps:txbx>` +
        `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr>` +
        `</wps:wsp></a:graphicData></a:graphic>` +
        `<wp14:sizeRelH relativeFrom="margin"><wp14:pctWidth>0</wp14:pctWidth></wp14:sizeRelH>` +
        `<wp14:sizeRelV relativeFrom="margin"><wp14:pctHeight>0</wp14:pctHeight></wp14:sizeRelV>` +
        `</wp:anchor></w:drawing>`
    )
  );
}

// ── The form ──────────────────────────────────────────────────────────────

/** The labels, exactly as the firm's form prints them (see inventoryForm.ts). */
const LABELS = FORM_LABELS;

/**
 * One filled-in form. Every paragraph, separator and trailing spacer run is
 * the reference document's — with an item's values dropped into the value
 * runs. `photo` is the inline picture XML for the box (empty when the item has
 * no usable photo: the bordered box still prints, like a blank form).
 */
function formParagraphs(
  item: InventoryItem,
  shapeId: number,
  photo: string,
  pageBreak: boolean
): string {
  const p: string[] = [];

  // Two blank lines, the title, and two more blanks — the run-up that drops
  // the title clear of the letterhead.
  p.push(emptyPara(GEORGIA, pageBreak ? "<w:pageBreakBefore/>" : ""));
  p.push(emptyPara(GEORGIA));
  const titleRpr = `${GEORGIA}<w:b/><w:sz w:val="${TITLE_SZ}"/>`;
  p.push(
    `<w:p><w:pPr><w:jc w:val="center"/><w:rPr>${titleRpr}</w:rPr></w:pPr>` +
      `${run(titleRpr, text(FORM_TITLE))}</w:p>`
  );
  p.push(`<w:p><w:pPr><w:jc w:val="center"/><w:rPr>${titleRpr}</w:rPr></w:pPr></w:p>`);
  p.push(emptyPara(RPR_LABEL));

  // Item Description — value, then the tab run out to the hand-written rule.
  p.push(
    fieldPara(
      RPR_RULE,
      label(LABELS.description),
      run(RPR_VALUE, tabs(1)),
      valueOrBlank(oneLine(item.name)),
      run(RPR_VALUE, tabs(7)),
      rule(" ".repeat(33))
    )
  );

  // Date + Quantity share a line.
  p.push(
    fieldPara(
      RPR_VALUE,
      label(LABELS.date),
      run(RPR_VALUE, tabs(1)),
      valueOrBlank(formDate(item.acquiredDate)),
      run(RPR_VALUE, tabs(2)),
      label(LABELS.quantity),
      value(" "),
      value(String(item.quantity)),
      value("  "),
      label(" ")
    )
  );

  p.push(
    fieldPara(RPR_VALUE, label(LABELS.vendor), value(" "), valueOrBlank(oneLine(item.vendor)))
  );

  // Net + Retail share a line. Retail is the client-facing number `price`
  // mirrors (see syncStockPricing), so fall back to it for entries saved
  // before the net/retail split.
  p.push(
    fieldPara(
      RPR_VALUE,
      label(LABELS.netPrice),
      value(" "),
      valueOrBlank(formPrice(item.netPrice)),
      run(RPR_VALUE, tabs(2)),
      label(LABELS.retailPrice),
      value(" "),
      valueOrBlank(formPrice(item.retailPrice ?? item.price)),
      value("   "),
      rule("   ")
    )
  );

  p.push(
    fieldPara(
      RPR_VALUE,
      label(LABELS.sidemark),
      run(RPR_RULE, tabs(1)),
      valueOrBlank(oneLine(item.sidemark)),
      value("    ")
    )
  );

  p.push(
    fieldPara(
      RPR_VALUE,
      label(LABELS.notes),
      label("    "),
      valueOrBlank(oneLine(item.notes)),
      value("     ")
    )
  );

  p.push(
    fieldPara(
      `${RPR_VALUE}<w:u w:val="single"/>`,
      label(LABELS.inventoryNumber),
      value("   "),
      valueOrBlank(oneLine(item.inventoryNumber)),
      value("      ")
    )
  );

  p.push(
    fieldPara(
      RPR_VALUE,
      label(LABELS.poNumber),
      label("  "),
      valueOrBlank(oneLine(item.poNumber))
    )
  );

  // A double-spaced blank, then the paragraph the photo box is anchored to.
  p.push(fieldPara(RPR_LABEL));
  p.push(`<w:p><w:pPr><w:rPr>${RPR_LABEL}</w:rPr></w:pPr>${photoBox(shapeId, photo)}</w:p>`);

  // The blank paragraphs the form ends with. They print nothing — they wrap
  // beside the photo box — but they are what the firm's own file contains, so
  // an exported form behaves like their original when someone edits it.
  for (let i = 0; i < 8; i++) p.push(emptyPara(RPR_LABEL));
  for (let i = 0; i < 3; i++) p.push(emptyPara(GEORGIA));
  p.push(
    `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="7800"/></w:tabs><w:rPr>${GEORGIA}</w:rPr></w:pPr>` +
      `${run(GEORGIA, `${tabs(1)}${text(" ")}`)}</w:p>`
  );
  p.push(
    `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="7695"/></w:tabs><w:rPr>${GEORGIA}</w:rPr></w:pPr></w:p>`
  );

  return p.join("");
}

// ── Header / footer (the per-firm parts) ──────────────────────────────────

/** The firm's logo at the letterhead's geometry — fitted to the reference
 *  HEIGHT with its own aspect ratio, never stretched to the reference width. */
function headerXml(logo: EmbeddableImage | null, wordmark: string, color: string): string {
  const body = logo
    ? `<w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="center"/></w:pPr>` +
      `${run(
        "<w:noProof/>",
        inlinePicture(
          "rId1",
          1,
          Math.round((LOGO_H_EMU * logo.w) / logo.h),
          LOGO_H_EMU
        )
      )}</w:p>`
    : // No logo: the firm name as a wordmark, sized and letter-spaced like the
      // .pptx export's no-logo case (42pt, 0.08em).
      (() => {
        const rPr = `${GEORGIA}<w:b/><w:color w:val="${color}"/><w:spacing w:val="${Math.round(
          WORDMARK_SZ * 0.5 * 0.08 * 20
        )}"/><w:sz w:val="${WORDMARK_SZ}"/>`;
        return (
          `<w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="center"/><w:rPr>${rPr}</w:rPr></w:pPr>` +
          `${run(rPr, text(wordmark))}</w:p>`
        );
      })();
  return `${XML_DECL}<w:hdr ${NS_MAIN}>${body}</w:hdr>`;
}

/** The firm's tagline, centered Georgia 11pt. */
function footerXml(footerText: string): string {
  const rPr = `${GEORGIA}<w:sz w:val="${FOOTER_SZ}"/>`;
  return (
    `${XML_DECL}<w:ftr ${NS_MAIN}>` +
    `<w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/><w:rPr>${rPr}</w:rPr></w:pPr>` +
    `${run(rPr, text(footerText))}</w:p></w:ftr>`
  );
}

// ── Package assembly ──────────────────────────────────────────────────────

interface Rel {
  id: string;
  type: string;
  target: string;
}

function relsXml(rels: Rel[]): string {
  return (
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rels
      .map(
        (r) =>
          `<Relationship Id="${r.id}" Type="${REL_NS}/${r.type}" Target="${r.target}"/>`
      )
      .join("") +
    `</Relationships>`
  );
}

function contentTypesXml(imageExts: Set<string>, hasFooter: boolean): string {
  const wml = "application/vnd.openxmlformats-officedocument.wordprocessingml";
  const overrides = [
    ["/word/document.xml", `${wml}.document.main+xml`],
    ["/word/styles.xml", `${wml}.styles+xml`],
    ["/word/settings.xml", `${wml}.settings+xml`],
    ["/word/webSettings.xml", `${wml}.webSettings+xml`],
    ["/word/footnotes.xml", `${wml}.footnotes+xml`],
    ["/word/endnotes.xml", `${wml}.endnotes+xml`],
    ["/word/header1.xml", `${wml}.header+xml`],
    ...(hasFooter ? [["/word/footer1.xml", `${wml}.footer+xml`]] : []),
    ["/word/fontTable.xml", `${wml}.fontTable+xml`],
    [
      "/word/theme/theme1.xml",
      "application/vnd.openxmlformats-officedocument.theme+xml",
    ],
  ];
  return (
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    [...imageExts]
      .sort()
      .map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`)
      .join("") +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    overrides
      .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
      .join("") +
    `</Types>`
  );
}

/** How many photos couldn't be embedded — the same signal exportItemsToPptx
 *  reports, so the caller can flash "3 images couldn't be included". */
export interface DocxExportResult {
  missingImages: number;
}

/**
 * Build and download a .docx holding one INVENTORY DETAIL FORM per entry, each
 * starting on a fresh page.
 */
export async function exportInventoryToDocx(
  items: InventoryItem[],
  fileName: string,
  opts: { style: FirmStyle; firmName: string }
): Promise<DocxExportResult> {
  if (items.length === 0) return { missingImages: 0 };

  const { style, firmName } = opts;
  const wordmark = style.coverTitle.trim() || firmName;
  const footerText = oneLine(style.footerText);
  const accent = toDocxColor(style.accentColor, "907C67");

  // Fetch the logo and every distinct item photo up front, in parallel.
  const cache = new Map<string, Promise<EmbeddableImage | null>>();
  const getImage = (u: string) => {
    let p = cache.get(u);
    if (!p) {
      p = loadImage(u);
      cache.set(u, p);
    }
    return p;
  };
  const logoUrl = safeLogoUrl(style.logoUrl);
  const [logo, ...photos] = await Promise.all([
    logoUrl ? getImage(logoUrl) : Promise.resolve(null),
    ...items.map((it) => {
      const u = it.imageUrl.trim();
      return u ? getImage(u) : Promise.resolve(null);
    }),
  ]);

  const parts: Record<string, Uint8Array> = {};
  const imageExts = new Set<string>();
  const docRels: Rel[] = [
    { id: "rId1", type: "styles", target: "styles.xml" },
    { id: "rId2", type: "settings", target: "settings.xml" },
    { id: "rId3", type: "webSettings", target: "webSettings.xml" },
    { id: "rId4", type: "footnotes", target: "footnotes.xml" },
    { id: "rId5", type: "endnotes", target: "endnotes.xml" },
    { id: "rId6", type: "fontTable", target: "fontTable.xml" },
    { id: "rId7", type: "theme", target: "theme/theme1.xml" },
    { id: "rId8", type: "header", target: "header1.xml" },
  ];
  let nextRel = docRels.length + 1;
  const headerRel = "rId8";
  let footerRel = "";
  if (footerText) {
    footerRel = `rId${nextRel++}`;
    docRels.push({ id: footerRel, type: "footer", target: "footer1.xml" });
  }

  let mediaSeq = 0;
  const addMedia = (img: EmbeddableImage): string => {
    const name = `media/image${++mediaSeq}.${img.ext}`;
    parts[`word/${name}`] = img.bytes;
    imageExts.add(img.ext);
    return name;
  };
  /** Add a photo as a media part and return the relationship that embeds it.
   *  Two entries photographed with the same shot share both. */
  const photoRels = new Map<EmbeddableImage, string>();
  const embedPhoto = (img: EmbeddableImage): string => {
    let id = photoRels.get(img);
    if (!id) {
      id = `rId${nextRel++}`;
      photoRels.set(img, id);
      docRels.push({ id, type: "image", target: addMedia(img) });
    }
    return id;
  };

  let missingImages = 0;
  let drawingId = 100; // unique per drawing within document.xml
  const body = items
    .map((it, i) => {
      const img = photos[i];
      let picture = "";
      if (img) {
        picture = run(
          `${RPR_LABEL}<w:noProof/>`,
          inlinePicture(
            embedPhoto(img),
            ++drawingId,
            PHOTO_W_EMU,
            Math.round((PHOTO_W_EMU * img.h) / img.w)
          )
        );
      } else if (it.imageUrl.trim()) {
        missingImages++;
      }
      return formParagraphs(it, ++drawingId, picture, i > 0);
    })
    .join("");

  const sectPr =
    `<w:sectPr><w:headerReference w:type="default" r:id="${headerRel}"/>` +
    (footerRel ? `<w:footerReference w:type="default" r:id="${footerRel}"/>` : "") +
    `<w:pgSz w:w="${PAGE_W_TW}" w:h="${PAGE_H_TW}"/>` +
    `<w:pgMar w:top="${MARGIN_TW}" w:right="${MARGIN_TW}" w:bottom="${MARGIN_TW}" w:left="${MARGIN_TW}" w:header="${HEADER_TW}" w:footer="${FOOTER_TW}" w:gutter="0"/>` +
    `<w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>`;

  parts["word/document.xml"] = strToU8(
    `${XML_DECL}<w:document ${NS_MAIN}><w:body>${body}${sectPr}</w:body></w:document>`
  );

  // The header carries the firm's logo as a media part of its own, related
  // from header1.xml.rels rather than the document's.
  const headerRels: Rel[] = [];
  if (logo) {
    headerRels.push({ id: "rId1", type: "image", target: addMedia(logo) });
  }
  parts["word/header1.xml"] = strToU8(headerXml(logo, wordmark, accent));
  parts["word/_rels/header1.xml.rels"] = strToU8(relsXml(headerRels));
  if (footerText) parts["word/footer1.xml"] = strToU8(footerXml(footerText));

  parts["word/styles.xml"] = strToU8(STYLES_XML);
  parts["word/settings.xml"] = strToU8(SETTINGS_XML);
  parts["word/webSettings.xml"] = strToU8(WEB_SETTINGS_XML);
  parts["word/footnotes.xml"] = strToU8(FOOTNOTES_XML);
  parts["word/endnotes.xml"] = strToU8(ENDNOTES_XML);
  parts["word/fontTable.xml"] = strToU8(FONT_TABLE_XML);
  parts["word/theme/theme1.xml"] = strToU8(THEME_XML);
  parts["word/_rels/document.xml.rels"] = strToU8(relsXml(docRels));
  parts["_rels/.rels"] = strToU8(PKG_RELS);
  // Content types first in the archive, the order Word writes them in.
  const zipped = zipSync(
    { "[Content_Types].xml": strToU8(contentTypesXml(imageExts, !!footerText)), ...parts },
    { level: 6 }
  );

  const base =
    fileName.replace(/\.docx$/i, "").replace(/[^\w-]+/g, "-") || "inventory-forms";
  triggerDownload(
    new Blob([zipped], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    `${base}.docx`
  );
  return { missingImages };
}
