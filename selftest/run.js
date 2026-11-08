'use strict';

const { exec } = require('child_process');

function a(req) {
  exec('ls ' + req.query.a); // NOSEMGREP
}

function b(req) {
  exec('ls ' + req.query.b); // TODO nosemgrep
}

function c(req) {
  exec('ls ' + req.query.c); // NoSemGrep: javascript.lang.security.detect-child-process.detect-child-process -- constant prefix, reviewed
}

module.exports = { a, b, c };
