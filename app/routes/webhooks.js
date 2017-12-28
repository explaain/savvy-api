// refactored webhook code
var messengerController = require('../platforms/messenger');
var slackController = require('../platforms/slack');

var express = require('express');
var request = require('request');
var router = express.Router();

// NB: Should rename these routes '/facebook' or something.
router.get('/', messengerController.tokenVerification);
//router.post('/', apiController.createGetStarted); -- this method is no longer needed (i think)
router.post('/', messengerController.handleMessage);

router.get('/slack/oauth', slackController.oauth);
router.post('/slack/quickreply', slackController.quickreply);

module.exports = router;
