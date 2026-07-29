import { getPricingEngine } from "./lib/pricingEngine.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function handler(req, res) {
  try {
    const dataPath = path.join(__dirname, '..', 'data', 'pricing_master.json');
    let fileExists = false;
    let fileStat = null;
    try {
      fileStat = await fs.stat(dataPath);
      fileExists = true;
    } catch (e) {
      fileExists = false;
    }

    const engine = await getPricingEngine();
    const sample = engine.records.slice(0, 3);

    res.status(200).json({
      loaded: true,
      recordCount: engine.records.length,
      dataPath,
      fileExists,
      fileStat: fileStat ? { size: fileStat.size, mtime: fileStat.mtime } : null,
      sample: sample.map(r => ({ itemNo: r.itemNo, price: r.price })),
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
      stack: err.stack,
      pathInfo: {
        __dirname,
        cwd: process.cwd(),
        env: {
          NODE_ENV: process.env.NODE_ENV,
          VERCEL: process.env.VERCEL,
        },
      },
    });
  }
}