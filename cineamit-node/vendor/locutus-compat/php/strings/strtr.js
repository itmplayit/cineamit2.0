'use strict';
const impl = require('locutus-modern/php/strings/strtr');
module.exports = impl.strtr || impl.default || impl;
