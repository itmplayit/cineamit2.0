'use strict';
const impl = require('locutus-modern/php/url/rawurlencode');
module.exports = impl.rawurlencode || impl.default || impl;
