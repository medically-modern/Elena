import { Router } from 'express';
import { evaluateDocument } from '../services/medical-necessity.js';

const router = Router();

// POST /api/evaluate/mn — evaluate an uploaded clinical PDF for Medical Necessity.
// Body: { pdfBase64, filename?, coveragePath?, product? }
router.post('/mn', async (req, res) => {
  const { pdfBase64, filename, coveragePath, product } = req.body || {};
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return res.status(400).json({ error: 'pdfBase64 (base64-encoded PDF) is required' });
  }
  try {
    const result = await evaluateDocument(pdfBase64, { filename, coveragePath, product });
    res.json({ filename: filename || null, ...result });
  } catch (err) {
    console.error('MN evaluate error:', err.message);
    res.status(500).json({ error: 'Evaluation failed: ' + err.message });
  }
});

export default router;
