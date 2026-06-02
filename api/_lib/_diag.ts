import { extractFromUrl } from "./extract-core";

const urls = process.argv.slice(2);
if (urls.length === 0) {
  urls.push(
    "https://www.westelm.com/products/harmony-sofa-h1756/",
    "https://www2.hm.com/en_us/productpage.html"
  );
}
for (const u of urls) {
  try {
    const r = await extractFromUrl(u);
    console.log(`\nOK  ${u}\n`, JSON.stringify(r.fields));
  } catch (e) {
    console.log(`\nERR ${u}`);
    console.log(e instanceof Error ? e.stack : e);
  }
}
