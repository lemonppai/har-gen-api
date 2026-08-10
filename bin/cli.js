#!/usr/bin/env node

import chalk from 'chalk';
import cfonts from 'cfonts';
import { generate } from '../dist/index.js';

cfonts.say('Har Gen Api', {
  font: 'simple',
  // colors: ['#409EFF']
});

generate();
