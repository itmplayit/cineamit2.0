'use strict';
const impl = require('locutus-modern/php/url/http_build_query');
module.exports = impl.http_build_query || impl.default || impl;
