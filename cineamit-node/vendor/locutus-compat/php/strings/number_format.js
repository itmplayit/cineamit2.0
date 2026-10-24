'use strict';
const impl = require('locutus-modern/php/strings/number_format');
module.exports = impl.number_format || impl.default || impl;
