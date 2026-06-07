import { Router } from 'express';
import { createRule, getAllActiveRules, updateRule, deactivateRule, deleteRule, isRulesReady } from '../services/rules.js';

const router = Router();

// GET /api/rules — list all active rules
router.get('/', async (req, res) => {
  try {
    if (!isRulesReady()) return res.json({ rules: [], message: 'Rules not available — no DATABASE_URL' });
    const rules = await getAllActiveRules();
    res.json({ rules, count: rules.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rules — create a new rule
router.post('/', async (req, res) => {
  try {
    if (!isRulesReady()) return res.status(503).json({ error: 'Rules not available' });
    const { rule, category, metadata } = req.body;
    if (!rule) return res.status(400).json({ error: 'rule text is required' });
    const created = await createRule(rule, category || 'general', metadata || {});
    res.status(201).json({ success: true, rule: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rules/:id — update a rule
router.put('/:id', async (req, res) => {
  try {
    if (!isRulesReady()) return res.status(503).json({ error: 'Rules not available' });
    const { rule, category } = req.body;
    if (!rule) return res.status(400).json({ error: 'rule text is required' });
    const updated = await updateRule(parseInt(req.params.id), rule, category);
    if (!updated) return res.status(404).json({ error: 'Rule not found' });
    res.json({ success: true, rule: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/rules/:id — deactivate (soft delete) a rule
router.delete('/:id', async (req, res) => {
  try {
    if (!isRulesReady()) return res.status(503).json({ error: 'Rules not available' });
    const hard = req.query.hard === 'true';
    const result = hard
      ? await deleteRule(parseInt(req.params.id))
      : await deactivateRule(parseInt(req.params.id));
    if (!result) return res.status(404).json({ error: 'Rule not found' });
    res.json({ success: true, deleted: hard ? 'permanently' : 'deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
