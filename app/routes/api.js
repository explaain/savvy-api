// refactored webhook code
const apiController = require('../controller/api');
const importController = require('../controller/import');

var express = require('express');
var router = express.Router();

// router.get('/', apiController.tokenVerification);
router.post('/memories', function(req, res) {
  const data = req.body;
  data.allInOne = true
  if (!data.intent) data.intent = 'storeMemory'
  apiController.acceptRequest(data)
  .then(function(results) {
		res.status(200).send(results);
	}).catch(function(e) {
    console.log(req.body);
    console.error(e)
		res.status(e.code).send(data)
	});
});
router.delete('/memories', function(req, res) {
	const sender = req.query.sender;
	const organisationID = req.query.organisationID;
	const objectID = req.query.objectID;
	apiController.deleteMemories(sender, organisationID, objectID)
	.then(function(result) {
		res.status(200).send(result);
	}).catch(function(e) {
    console.error(e)
		res.sendStatus(400);
	})
});
router.get('/memories', function(req, res) {
  res.status(200).send('Hi there')
});

router.post('/import', function(req, res) {
  const data = req.body;
  importController.acceptRequest(data)
  .then(function(results) {
		res.status(200).send(results);
	}).catch(function(e) {
    console.error(e)
		res.status(e.code).send(data)
	});
});

router.post('/user', function(req, res) {
  const data = req.body;
  apiController.getUserData(data)
  .then(function(results) {
		res.status(200).send(results);
	}).catch(function(e) {
    console.error(e)
		res.status(e.code).send(data)
	});
});

router.post('/user/add', function(req, res) {
  const data = req.body;
  apiController.addUserToOrganisation(data)
  .then(function(results) {
		res.status(200).send(results);
	}).catch(function(e) {
    console.error(e)
		res.status(e.code).send(data)
	});
});

router.post('/user/getTeams', function(req, res) {
  const data = req.body;
  apiController.getUserTeamDetails(data)
  .then(function(results) {
		res.status(200).send(results);
	}).catch(function(e) {
    console.error(e)
		res.status(e.code).send(data)
	});
});

module.exports = router;
