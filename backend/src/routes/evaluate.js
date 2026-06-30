import { Router } from 'express';
import { reviewDocuments } from '../services/medical-necessity.js';

const router = Router();

// POST /api/evaluate/document — read one or more uploaded PDFs and act on the
// user's instruction. Returns either a structured MN evaluation (when asked for
// a Medical Necessity review) or a plain-text answer.
// Body: { pdfs: [{ filename, base64 }], message }
router.post('/document', async (req, res) => {
  const { pdfs, message } = req.body || {};
  if (!Array.isArray(pdfs) || pdfs.length === 0) {
    return res.status(400).json({ error: 'pdfs (array of { filename, base64 }) is required' });
  }
  if (pdfs.some(p => !p || typeof p.base64 !== 'string' || !p.base64)) {
    return res.status(400).json({ error: 'each pdf needs a base64 string' });
  }
  try {
    const result = await reviewDocuments(pdfs, message);
    res.json(result);
  } catch (err) {
    console.error('Doc review error:', err.message);
    res.status(500).json({ error: 'Document review failed: ' + err.message });
  }
});

export default router;
