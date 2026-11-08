'use strict';

const { exec } = require('child_process');

function a(req) {
  exec('ls ' + req.query.a); // nosemx
}

function b(req) {
  exec('ls ' + req.query.b); // NOSEMANTIC
}

module.exports = { a, b };
