'use strict';
const impl = require('locutus-modern/php/strings/strip_tags');
module.exports = impl.strip_tags || impl.default || impl;
