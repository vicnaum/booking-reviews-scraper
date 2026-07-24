import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import EvidenceGapBadge from './EvidenceGapBadge.js';

test('evidence gap badge names the missing review layer', () => {
  const html = renderToStaticMarkup(
    <EvidenceGapBadge gaps={['reviews']} />,
  );

  assert.match(html, /Graded without reviews/);
  assert.match(html, /Treat this verdict as partial/);
});

test('evidence gap badge normalizes combined gaps into a stable label', () => {
  const html = renderToStaticMarkup(
    <EvidenceGapBadge gaps={['photos', 'reviews', 'photos']} />,
  );

  assert.match(html, /Graded without reviews \+ photos/);
});

test('evidence gap badge stays hidden for a complete verdict', () => {
  const html = renderToStaticMarkup(
    <EvidenceGapBadge gaps={[]} />,
  );

  assert.equal(html, '');
});
