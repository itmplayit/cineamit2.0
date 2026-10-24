'use strict';
const impl = require('locutus-modern/php/strings/sprintf');
module.exports = impl.sprintf || impl.default || impl;
