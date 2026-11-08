'use strict';

const _ = require('lodash');

// Builds the body of transactional emails from fixed templates.
// The template strings are written by us. Only the values in `data` come
// from users, and `<%- %>` HTML-escapes them.
const templates = {
  welcome: 'Hi <%- name %>, welcome to <%- product %>.',
  reset: 'Hi <%- name %>, use this link to reset your password: <%- link %>',
  digest:
    'Hi <%- name %>, you have <%- items.length %> new <%- items.length === 1 ? "update" : "updates" %>.' +
    '<% items.forEach(function (item) { %>\n- <%- item %><% }); %>',
};

const compiled = {};

function render(templateName, data) {
  const source = templates[templateName];
  if (!source) {
    throw new Error(`Unknown template: ${templateName}`);
  }
  if (!compiled[templateName]) {
    compiled[templateName] = _.template(source);
  }
  return compiled[templateName](data);
}

module.exports = { render, templates };
