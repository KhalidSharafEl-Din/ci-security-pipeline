'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/mail/render');

test('renders the welcome email', () => {
  assert.equal(render('welcome', { name: 'Sara', product: 'Acme' }), 'Hi Sara, welcome to Acme.');
});

test('rejects unknown templates', () => {
  assert.throws(() => render('missing', {}), /Unknown template/);
});
