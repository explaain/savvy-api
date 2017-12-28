var properties = require('../config/properties.js');

const googleMapsClient = require('@google/maps').createClient({
  key: properties.google_maps_api
});

module.exports = googleMapsClient;
