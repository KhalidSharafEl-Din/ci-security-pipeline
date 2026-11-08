'use strict';

const { exec } = require('child_process');
const express = require('express');

const app = express();

// Planted SAST finding: user input flows into a shell command.
app.get('/list', (req, res) => {
  exec('ls ' + req.query.dir, (err, stdout) => res.send(stdout));
});

// Planted suppression without a reason: the gate must reject it.
app.get('/eval', (req, res) => {
  res.send(String(eval(req.query.code))); // nosemgrep
});

module.exports = app;
