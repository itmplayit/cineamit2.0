'use strict';
const impl = require('locutus-modern/php/math/mt_rand');
module.exports = impl.mt_rand || impl.default || impl;
