import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docStatus, isNewFor, markQuiz, acceptSegments, mergeSegments, namesMatch, nextCode, draftProblems, appliesTo } from '../src/rules.js';

test('status of a document for a person', () => {
  assert.equal(docStatus({ currentMajor: 2, signedMajor: 2 }), 'done');
  assert.equal(docStatus({ currentMajor: 3, signedMajor: 2, active: true }), 'updated');
  assert.equal(docStatus({ currentMajor: 2, signedMajor: null, active: true }), 'inprogress');
  assert.equal(docStatus({ currentMajor: 2, signedMajor: null, active: false }), 'todo');
});

test('audience', () => {
  assert.ok(appliesTo({ all: true, positions: [] }, 'chef'));
  assert.ok(appliesTo({ all: false, positions: ['chef'] }, 'chef'));
  assert.ok(!appliesTo({ all: false, positions: ['waitron'] }, 'chef'));
});

test('New only after a declaration', () => {
  assert.equal(isNewFor('2026-11-02', null), false);
  assert.equal(isNewFor('2026-11-02', '2026-11-01'), true);
  assert.equal(isNewFor('2026-10-30', '2026-11-01'), false);
});

test('quiz marking and pass mark', () => {
  const qs = [0, 1, 2, 3, 0].map(c => ({ q: 'q', options: ['a', 'b', 'c', 'd'], correct: c }));
  assert.deepEqual(markQuiz(qs, [0, 1, 2, 3, 1], 80), { correct: 4, total: 5, score: 80, passed: true, wrong: [4] });
  assert.equal(markQuiz(qs, [0, 1, 2, 0, 1], 80).passed, false);
});

test('names match ignoring capitals and spaces', () => {
  assert.ok(namesMatch('  thandi   MOKOENA ', 'Thandi Mokoena'));
  assert.ok(!namesMatch('Thandi', 'Thandi Mokoena'));
  assert.ok(!namesMatch('', ''));
});

test('video coverage is limited by real time', () => {
  assert.deepEqual(mergeSegments([[10, 20], [0, 5], [4, 12]]), [[0, 20]]);
  const fake = acceptSegments({ existing: [], reported: [[0, 375]], duration: 375, elapsedSec: 5 });
  assert.ok(fake.watched <= 13);
  const real = acceptSegments({ existing: [[0, 100]], reported: [[100, 110]], duration: 375, elapsedSec: 10 });
  assert.equal(real.watched, 110);
  const capped = acceptSegments({ existing: [], reported: [[0, 500]], duration: 375, elapsedSec: 1000 });
  assert.equal(capped.watched, 375);
});

test('next document code and draft checks', () => {
  assert.equal(nextCode('sop', ['PEL-SOP-001', 'PEL-SOP-012', 'PEL-MAN-005'], 'PEL'), 'PEL-SOP-013');
  assert.equal(nextCode('policy', [], 'PEL'), 'PEL-POL-001');
  assert.equal(nextCode('sop', ['PEL-SOP-001', 'HBR-SOP-004'], 'HBR'), 'HBR-SOP-005', 'each client numbers its own documents');
  const p = draftProblems({ title: 'x', body: 'y', audience: { all: false, positions: [] }, questions: [{ q: 'q', options: ['a', ''], correct: 5 }], passMark: 80 });
  assert.equal(p.length, 3);
});
