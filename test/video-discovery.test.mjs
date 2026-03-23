import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import vm from 'vm';
import { Window } from 'happy-dom';

const code = fs.readFileSync(new URL('../utils/video-discovery.js', import.meta.url), 'utf8');

function loadDiscovery(window) {
  vm.createContext(window);
  vm.runInContext(code, window);
}

test('finds <video> inside an open shadow root (YouTube-style)', () => {
  const window = new Window({ url: 'https://www.youtube.com/watch?v=test' });
  loadDiscovery(window);
  const doc = window.document;
  const host = doc.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const video = doc.createElement('video');
  shadow.appendChild(video);
  doc.body.appendChild(host);
  const videos = window.__ltGetAllVideoElements(doc.documentElement);
  assert.strictEqual(videos.length, 1);
  assert.strictEqual(videos[0].nodeName, 'VIDEO');
});

test('finds nested shadow roots', () => {
  const window = new Window({ url: 'https://example.com/' });
  loadDiscovery(window);
  const doc = window.document;
  const outer = doc.createElement('div');
  const s1 = outer.attachShadow({ mode: 'open' });
  const inner = doc.createElement('div');
  s1.appendChild(inner);
  const s2 = inner.attachShadow({ mode: 'open' });
  const video = doc.createElement('video');
  s2.appendChild(video);
  doc.body.appendChild(outer);
  const videos = window.__ltGetAllVideoElements(doc.documentElement);
  assert.strictEqual(videos.length, 1);
});

test('pickPrimaryVideo prefers the playing video', () => {
  const window = new Window();
  loadDiscovery(window);
  const doc = window.document;
  const a = doc.createElement('video');
  const b = doc.createElement('video');
  Object.defineProperty(a, 'paused', { value: true, configurable: true });
  Object.defineProperty(b, 'paused', { value: false, configurable: true });
  Object.defineProperty(b, 'ended', { value: false, configurable: true });
  doc.body.appendChild(a);
  doc.body.appendChild(b);
  const picked = window.__ltPickPrimaryVideo([a, b]);
  assert.strictEqual(picked, b);
});

test('pickPrimaryVideo picks largest when none are playing', () => {
  const window = new Window();
  loadDiscovery(window);
  const doc = window.document;
  const big = doc.createElement('video');
  const small = doc.createElement('video');
  Object.defineProperty(big, 'paused', { value: true, configurable: true });
  Object.defineProperty(small, 'paused', { value: true, configurable: true });
  Object.defineProperty(big, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(big, 'clientHeight', { value: 450, configurable: true });
  Object.defineProperty(small, 'clientWidth', { value: 2, configurable: true });
  Object.defineProperty(small, 'clientHeight', { value: 2, configurable: true });
  doc.body.appendChild(small);
  doc.body.appendChild(big);
  const picked = window.__ltPickPrimaryVideo([big, small]);
  assert.strictEqual(picked, big);
});
