import assert from 'node:assert/strict';
import test from 'node:test';
import { setupPhotoTapGuard } from '../src/photo-tap-guard.js';

function harness(t) {
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  const handlers = new Map();
  const media = {};
  const root = { scrollingElement: {}, addEventListener: (type, handler) => handlers.set(type, handler) };
  const target = { closest: selector => selector === '[data-card-carousel]' ? media : null };
  const blocked = setupPhotoTapGuard(root);
  return {
    root,
    advance: ms => { now += ms; },
    send: (type, data = {}) => handlers.get(type)({ target, pointerId: 1, isPrimary: true,
      button: 0, pointerType: 'touch', clientX: 100, clientY: 100, ...data }),
    blocked: (event = { detail: 1, pointerType: 'touch' }) => blocked(event, media)
  };
}

test('photo tap intent permits jitter but rejects movement, including an out-and-back gesture', t => {
  const h = harness(t);
  h.send('pointerdown');
  h.send('pointerup', { clientX: 106, clientY: 108 });
  assert.equal(h.blocked(), false);
  h.send('pointerdown');
  h.send('pointermove', { clientY: 114 });
  h.send('pointerup');
  assert.equal(h.blocked(), true);
  h.send('pointerdown');
  h.send('pointerup', { clientY: 114 });
  assert.equal(h.blocked(), true);
});

test('cancelled and multitouch gestures stay blocked until a fresh intentional press', t => {
  const h = harness(t);
  h.send('pointerdown');
  h.send('pointercancel');
  h.advance(1000);
  assert.equal(h.blocked(), true);
  h.send('pointerdown');
  h.send('pointerdown', { pointerId: 2, isPrimary: false });
  h.send('pointerup', { pointerId: 2, isPrimary: false });
  h.send('pointerup');
  assert.equal(h.blocked(), true);
  h.send('pointerdown');
  h.send('pointerup');
  assert.equal(h.blocked(), false);
});

test('page and storefront scrolling reject stop-scrolling taps, but not a settled new tap', t => {
  const h = harness(t);
  for (const target of [h.root, h.root.scrollingElement, { matches: selector => selector === '.screen' }]) {
    h.send('scroll', { target });
    h.send('pointerdown');
    h.send('pointerup');
    assert.equal(h.blocked(), true);
    h.advance(161);
    h.send('pointerdown');
    h.send('pointerup');
    assert.equal(h.blocked(), false);
  }
  h.send('pointerdown');
  h.send('scroll', { target: { matches: () => false } });
  h.send('pointerup');
  assert.equal(h.blocked(), false, 'Carousel scrolling is handled by its own guard');
  h.send('pointerdown');
  h.send('scroll', { target: h.root });
  h.advance(200);
  h.send('pointerup');
  assert.equal(h.blocked(), true, 'Scrolling during a press cannot become a tap');
});

test('long touch holds and context menus cannot open photos; keyboard and fresh mouse clicks still work', t => {
  const h = harness(t);
  h.send('pointerdown');
  h.advance(601);
  h.send('pointerup');
  assert.equal(h.blocked(), true);
  assert.equal(h.blocked({ detail: 0, pointerType: '' }), false);
  h.send('pointerdown', { pointerType: 'mouse' });
  h.advance(700);
  h.send('pointerup', { pointerType: 'mouse' });
  assert.equal(h.blocked(), false);
  h.send('pointerdown');
  h.send('contextmenu');
  h.send('pointerup');
  assert.equal(h.blocked(), true);
});

test('controls outside the photo opener do not create a pending photo tap', t => {
  const h = harness(t);
  h.send('pointerdown', { target: { closest: () => null } });
  assert.equal(h.blocked(), false);
  h.send('pointerdown');
  assert.equal(h.blocked(), true, 'A pointer still held down is not a completed tap');
  h.send('pointerup', { pointerId: 2 });
  assert.equal(h.blocked(), true);
  h.send('pointerup');
  assert.equal(h.blocked(), false);
});
