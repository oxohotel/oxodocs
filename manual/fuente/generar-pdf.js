// Genera Manual_de_Usuario_OXO_Docs.pdf desde manual.html usando Chrome headless.
// Uso: node generar-pdf.js [rutaSalida.pdf]
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { PDFDocument } = require('pdf-lib');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = 'file:///' + path.resolve(__dirname, 'manual.html').split(path.sep).join('/');
const SALIDA = path.resolve(process.argv[2] || path.join(__dirname, 'Manual_de_Usuario_OXO_Docs.pdf'));

const FOOTER = `
  <div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#7a847f;padding:0 16mm;display:flex;justify-content:space-between;">
    <span>OXO Docs · Manual de usuario</span>
    <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
  </div>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(HTML, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMediaType('print');

    const base = { format: 'A4', printBackground: true, preferCSSPageSize: true };
    const sinPie = await page.pdf({ ...base, displayHeaderFooter: false });
    const conPie = await page.pdf({ ...base, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: FOOTER });

    // Portada (pág. 1) sin pie + resto con numeración
    const a = await PDFDocument.load(sinPie);
    const b = await PDFDocument.load(conPie);
    const out = await PDFDocument.create();
    const [portada] = await out.copyPages(a, [0]);
    out.addPage(portada);
    const resto = await out.copyPages(b, b.getPageIndices().slice(1));
    resto.forEach(p => out.addPage(p));
    out.setTitle('Manual de Usuario - OXO Docs');
    out.setAuthor('OxoHotel');
    fs.writeFileSync(SALIDA, await out.save());
    console.log('PDF generado:', SALIDA, '| páginas:', out.getPageCount(), '| KB:', Math.round(fs.statSync(SALIDA).size / 1024));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
