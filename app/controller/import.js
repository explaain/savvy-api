// const request = require('request');
// const Q = require("q");
// const path = require('path')
// const extract = require('pdf-text-extract')
//
// const properties = require('../config/properties.js');
//
// const tracer = require('tracer')
// const logger = tracer.colorConsole({level: 'info'});
// // tracer.setLevel('warn');
//
//
// exports.acceptRequest = function(requestData) {
//   logger.trace();
// 	const d = Q.defer()
//
//   const filePath = path.join(__dirname, 'test/data/multipage.pdf')
//
//   extract(filePath, { splitPages: false }, function (err, text) {
//     if (err) {
//       console.dir(err)
//       d.reject(err)
//       return
//     }
//     console.dir(text)
//     d.resolve(text)
//   })
// 	return d.promise
// }
