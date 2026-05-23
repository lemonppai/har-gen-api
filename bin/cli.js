#!/usr/bin/env node

import chalk from 'chalk';
import cfonts from 'cfonts';
import { generate } from '../index.js';

cfonts.say('Har To Api', {
  font: 'simple',
  // colors: ['#409EFF']
});

generate();
