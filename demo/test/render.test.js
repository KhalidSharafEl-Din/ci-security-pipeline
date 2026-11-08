'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/mail/render');

test('renders the welcome email', () => {
  assert.equal(render('welcome', { name: 'Sara', product: 'Acme' }), 'Hi Sara, welcome to Acme.');
});

test('escapes user input', () => {
  assert.equal(render('welcome', { name: '<b>Sara</b>', product: 'Acme' }), 'Hi &lt;b&gt;Sara&lt;/b&gt;, welcome to Acme.');
});

test('renders a list of updates', () => {
  assert.equal(render('digest', { name: 'Sara', items: ['a', 'b'] }), 'Hi Sara, you have 2 new updates.\n- a\n- b');
});

test('rejects unknown templates', () => {
  assert.throws(() => render('missing', {}), /Unknown template/);
});
