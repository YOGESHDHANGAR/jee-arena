import { Router } from 'express';
import { ah, notFound, SUBJECTS } from '../lib/util.js';
import { chapterDetail, subjectUnits } from '../lib/chapters.js';

export const chaptersRouter = Router();

/** Standard chapters of one subject, grouped by unit, with counts. */
chaptersRouter.get(
  '/:subject',
  ah(async (req, res) => {
    const { subject } = req.params;
    if (!SUBJECTS.includes(subject)) throw notFound('Unknown subject');
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ subject, ...(await subjectUnits(subject)) });
  }),
);

/** One chapter's landing page data. */
chaptersRouter.get(
  '/:subject/:slug',
  ah(async (req, res) => {
    const d = await chapterDetail(req.params.subject, req.params.slug);
    if (!d || (!d.redirect && !d.total)) throw notFound('Chapter not found');
    res.set('Cache-Control', 'public, max-age=300');
    res.json(d);
  }),
);
