// refactored webhook code
const apiController = require('../controller/api');

var express = require('express');
var router = express.Router();

// router.get('/', apiController.tokenVerification);
router.post('/fetch', function(req, res) {
  const data = req.body
  apiController.fetchMixpanelData(data)
  .then(function(results) {
    console.log('results');
    console.log(results);
		res.status(200).send(results);
	}).catch(function(e) {
    console.log(req.body);
    console.error(e)
		res.status(e.code).send(data)
	})
})

module.exports = router;
