'use strict';

// Builds the plain-text body of transactional emails from fixed templates.
const templates = {
  welcome: 'Hi {name}, welcome to {product}.',
  reset: 'Hi {name}, use this link to reset your password: {link}',
};

function render(templateName, data) {
  const source = templates[templateName];
  if (!source) {
    throw new Error(`Unknown template: ${templateName}`);
  }
  return source.replace(/\{(\w+)\}/g, (_match, key) => String(data[key] ?? ''));
}

module.exports = { render, templates };
