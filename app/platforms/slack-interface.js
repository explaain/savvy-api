const request = require('request')
const SlackBot = require('slackbots')
const RtmClient = require('@slack/client').RtmClient
const { WebClient } = require('@slack/client');
const web = new WebClient(process.env.SLACK_OAUTH_ACCESS_TOKEN) // Currently this only works for the one team!

const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'trace'})

const slack = require('../platforms/slack')

var slackKeychain

const tempTeamID = 'T04NVHJBK'

exports.oauth = function(req, res) {
	// When a user authorizes an app, a code query parameter is passed on the oAuth endpoint. If that code is not there, we respond with an error message
  if (!req.query.code) {
      res.status(500);
      res.send({"Error": "Looks like we're not getting code."});
      console.log("Looks like we're not getting code.");
  } else {
    // If it's there...

    // We'll do a GET call to Slack's `oauth.access` endpoint, passing our app's client ID, client secret, and the code we just got as query parameters.
    request({
      url: 'https://slack.com/api/oauth.access', //URL to hit
      qs: {code: req.query.code, client_id: properties.slack_client_id, client_secret: properties.slack_client_secret}, //Query string data
      method: 'GET', //Specify the method
    }, function (error, response, body) {
      if (error) {
        console.log(error);
      } else {
				slackKeychain = JSON.parse(body)
				console.log("🤓 Bot was authorised", slackKeychain)
        res.json(slackKeychain);

				// TODO: Store this token in an encrypted DB so we can bootstrap bots after server restart
				initateSlackBot(slackKeychain.bot)
      }
    })
  }
}



const initateSlackBot = function(thisBotKeychain) {
	logger.trace(initateSlackBot);

  slackKeychain = thisBotKeychain

	// create a bot
	bot = new SlackBot({
	   token: thisBotKeychain.bot_access_token
	});
	rtm = new RtmClient(thisBotKeychain.bot_access_token);
	rtm.start();

	logger.log('New Slackbot connecting.')

	bot.on('open', () => logger.log("Slackbot opened websocket."))
	bot.on('errror', () => logger.log("Slackbot 👺 ERR'D OUT while connecting."))
	bot.on('close', () => logger.log("Slackbot 👺 CLOSED a websocket."))

	bot.on('start', () => {
		logger.log('Slackbot has 🙏 connected.')

		// // TODO: Remove after debug
    // bot.postMessageToChannel('bot-testing', `*I'm your personal mind-palace. Invite me to this channel and ask me to remember things :)*`, {
    //     icon_emoji: ':sparkles:'
    // });
	});

	bot.on('message', (message) => {
		logger.trace('Slack event:', message)

		// Should send data to Chatbot and return messages for emitting
		// TODO: Support postEphemeral(id, user, text, params) for slash commands
    const teamInfo = {
      teamID: tempTeamID,
      botUserID: thisBotKeychain.bot_user_id
    }
		slack.handleMessage(teamInfo, message)
	})
}


exports.quickreply = function(req, res) {
	logger.trace(exports.quickreply)

	var reaction = JSON.parse(req.body.payload)

  return slack.quickreply(reaction)
}


exports.events = function(req, res) {
	logger.trace('exports.events', req.body)

  res.send({challenge: req.body.challenge})
}

// Dev bootstrap
initateSlackBot({
	bot_access_token: process.env.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN,
	bot_user_id: process.env.SLACK_BOT_USER_ID
})

const handleActionsFromSlackController = response => {
  logger.trace('acceptClientMessageFunction', response)
  switch (response.action) {
    case 'sendMessage':
      return sendMessage(response.data)
      break;
    case 'getMessageData':
      return getMessageData(response.data)
      break;
    case 'setTyping':
      return setTyping(response.data.team, response.data.channel, response.data.on)
      break;
  }
}

slack.acceptClientMessageFunction(handleActionsFromSlackController)

const setTyping = (team, channel, on) => {
  rtm.sendTyping(channel)
}

const sendMessage = messageData => new Promise(function(resolve, reject) {
  bot.postMessage(
		// reaction.channel.id.charAt(0) === 'D' ? reaction.user.id : reaction.channel.id, // Identify by user OR by group
		// Actually, previous line should be resolved by callback_id specified in the initial message
		messageData.recipient,
		messageData.text,
    messageData.params
	).then(res => {
    resolve(res)
  }).catch(e => {
    logger.error(e)
    reject(e)
  })
})

/**
 * Takes message id-related data and returns message data (docs: https://api.slack.com/methods/channels.history)
 *
 * @param  {Object} messageSpecs
 * @param  {String} messageSpecs.ts
 * @param  {String} messageSpecs.channel
 * @return {Object}
 */
const getMessageData = messageSpecs => new Promise(function(resolve, reject) {
  web.channels.history(messageSpecs.channel, { latest: messageSpecs.ts, count: messageSpecs.count || 1, inclusive: true })
  .then(res => {
    if (res.ok && res.messages && res.messages.length) {
      const messageData = res.messages
      messageData.forEach(m => m.channel = messageSpecs.channel)
      logger.trace(messageData)
      resolve(messageData)
    } else {
      logger.error(res.error)
    }
  })
})
