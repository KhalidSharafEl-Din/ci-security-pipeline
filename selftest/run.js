'use strict';

const { exec } = require('child_process');

// Planted SAST finding: user input flows into a shell command.
function list(req, res) {
  exec('ls ' + req.query.dir, (err, stdout) => res.send(stdout));
}

// Planted short-form suppression without a reason: the gate must reject it.
function run(req) {
  return eval(req.query.code); // nosem
}

// Valid suppression with two rule IDs and a reason: must be accepted.
function fixed(cb) {
  exec('ls /tmp', cb); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process, some.other.rule -- constant command
}

module.exports = { list, run, fixed };
